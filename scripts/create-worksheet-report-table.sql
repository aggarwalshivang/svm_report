-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Replaces create-worksheet-report-view.sql (a virtual view) with an actual
-- stored table: one row per worksheet, holding all of assignments' own
-- columns plus computed submission stats (roster size, submitted count,
-- missing count, % submitted, feedback count). Browsable directly in
-- Table Editor like any other table.
--
-- Since it's a real table, it needs to be kept in sync by hand -- that's
-- what the triggers below do: any insert/update/delete on assignments,
-- assignment_submissions, worksheet_feedback, or student_emails (roster
-- changes affect every worksheet's total_students) recomputes just the
-- affected row(s) automatically. You never need to run a "refresh" step.
--
-- Safe to re-run: drops and recreates the table, function and triggers,
-- then backfills every current worksheet from scratch.

drop view if exists public.worksheet_report cascade;
drop table if exists public.worksheet_report cascade;

-- 1. The table --------------------------------------------------------------

create table public.worksheet_report (
  id uuid primary key references public.assignments(id) on delete cascade,
  title text not null,
  subject text not null,
  class text not null,
  portion text,
  link text,
  drive_folder_id text,
  notes text,
  deadline timestamptz not null,
  completed boolean not null default false,
  submissions_closed boolean not null default false,
  created_at timestamptz not null default now(),
  total_students integer not null default 0,
  submitted_count integer not null default 0,
  missing_count integer not null default 0,
  submitted_pct numeric not null default 0,
  feedback_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.worksheet_report enable row level security;

-- Same access as public.assignments itself: teachers see every worksheet,
-- students see only worksheets for their own class.
create policy "teachers can select all, students their own class"
  on public.worksheet_report
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
    or exists (
      select 1 from public.student_emails se
      where se.student_id = (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint
        and cast(se.class as text) = worksheet_report.class
    )
  );

-- 2. Recompute one worksheet's row -------------------------------------------
-- security definer + fixed search_path so it can write to worksheet_report
-- (owned by the table creator) regardless of which role's action triggered
-- it -- a teacher's browser session, a student's, or an edge function
-- running as service_role.

create or replace function public.recompute_worksheet_report(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_total integer;
  v_submitted integer;
  v_feedback integer;
begin
  select * into a from public.assignments where id = p_assignment_id;
  if not found then
    delete from public.worksheet_report where id = p_assignment_id;
    return;
  end if;

  select count(distinct student_id) into v_total
  from public.student_emails
  where cast(class as text) = a.class;

  select count(*) into v_submitted
  from public.assignment_submissions
  where assignment_id = a.id;

  select count(*) into v_feedback
  from public.worksheet_feedback
  where assignment_id = a.id;

  insert into public.worksheet_report (
    id, title, subject, class, portion, link, drive_folder_id, notes,
    deadline, completed, submissions_closed, created_at,
    total_students, submitted_count, missing_count, submitted_pct, feedback_count, updated_at
  ) values (
    a.id, a.title, a.subject, a.class, a.portion, a.link, a.drive_folder_id, a.notes,
    a.deadline, a.completed, a.submissions_closed, a.created_at,
    coalesce(v_total, 0), coalesce(v_submitted, 0),
    greatest(coalesce(v_total, 0) - coalesce(v_submitted, 0), 0),
    case when coalesce(v_total, 0) = 0 then 0 else round(100.0 * coalesce(v_submitted, 0) / v_total, 1) end,
    coalesce(v_feedback, 0), now()
  )
  on conflict (id) do update set
    title              = excluded.title,
    subject            = excluded.subject,
    class              = excluded.class,
    portion            = excluded.portion,
    link               = excluded.link,
    drive_folder_id    = excluded.drive_folder_id,
    notes              = excluded.notes,
    deadline           = excluded.deadline,
    completed          = excluded.completed,
    submissions_closed = excluded.submissions_closed,
    total_students     = excluded.total_students,
    submitted_count    = excluded.submitted_count,
    missing_count      = excluded.missing_count,
    submitted_pct      = excluded.submitted_pct,
    feedback_count     = excluded.feedback_count,
    updated_at         = now();
end;
$$;

-- 3. Triggers that keep it in sync -------------------------------------------

-- assignments: insert/update recomputes that row. Delete is handled by the
-- foreign key's `on delete cascade` above, so no delete trigger is needed here.
create or replace function public.trg_worksheet_report_from_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_worksheet_report(new.id);
  return new;
end;
$$;

create trigger worksheet_report_sync_assignments
after insert or update on public.assignments
for each row execute function public.trg_worksheet_report_from_assignments();

-- assignment_submissions: any change to a worksheet's submissions recomputes
-- that worksheet's counts.
create or replace function public.trg_worksheet_report_from_submissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    perform public.recompute_worksheet_report(old.assignment_id);
    return old;
  end if;
  perform public.recompute_worksheet_report(new.assignment_id);
  return new;
end;
$$;

create trigger worksheet_report_sync_submissions
after insert or update or delete on public.assignment_submissions
for each row execute function public.trg_worksheet_report_from_submissions();

-- worksheet_feedback: only rows tagged with a real assignment_id affect a
-- worksheet_report row (legacy CSV-import rows with assignment_id null don't).
create or replace function public.trg_worksheet_report_from_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if old.assignment_id is not null then perform public.recompute_worksheet_report(old.assignment_id); end if;
    return old;
  end if;
  if new.assignment_id is not null then perform public.recompute_worksheet_report(new.assignment_id); end if;
  return new;
end;
$$;

create trigger worksheet_report_sync_feedback
after insert or update or delete on public.worksheet_feedback
for each row execute function public.trg_worksheet_report_from_feedback();

-- student_emails: adding/removing/reclassing a student changes total_students
-- for every worksheet in the class(es) involved.
create or replace function public.trg_worksheet_report_from_student_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if TG_OP in ('DELETE', 'UPDATE') then
    for r in select id from public.assignments where class = cast(old.class as text) loop
      perform public.recompute_worksheet_report(r.id);
    end loop;
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    for r in select id from public.assignments where class = cast(new.class as text) loop
      perform public.recompute_worksheet_report(r.id);
    end loop;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger worksheet_report_sync_student_emails
after insert or update or delete on public.student_emails
for each row execute function public.trg_worksheet_report_from_student_emails();

-- 4. Backfill every existing worksheet ---------------------------------------

do $$
declare
  r record;
begin
  for r in select id from public.assignments loop
    perform public.recompute_worksheet_report(r.id);
  end loop;
end $$;

-- Sanity check
select * from public.worksheet_report order by deadline desc limit 20;
