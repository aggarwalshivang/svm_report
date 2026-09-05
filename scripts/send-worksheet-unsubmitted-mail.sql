-- Fires the n8n webhook "worksheet unsubmitted mail" once each assignment's
-- deadline actually passes, with the folder link, topic, class, and the
-- comma-separated list of students who haven't submitted. Runs unattended on
-- pg_cron (same pattern as send-worksheet-deadline-reminder.sql), so no one
-- has to trigger it by hand.
--
-- Deliberately reads the roster with DISTINCT ON (student_id): student_emails
-- has duplicate rows per student (discovered 2026-09-05 -- e.g. one student
-- had 4 identical rows), which would otherwise inflate both the roster count
-- and the unsubmitted list with repeated names.
--
-- Run this once in the Supabase Dashboard -> SQL Editor.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- Tracks whether an assignment's unsubmitted-mail has already gone out, so a
-- job that runs every 5 minutes doesn't resend it every time it re-enters the
-- catch window.
alter table public.assignments
  add column if not exists unsubmitted_mail_sent boolean not null default false;

create or replace function public.send_worksheet_unsubmitted_mail()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  names text;
  cnt int;
begin
  for r in
    select id, class, subject, title, portion, drive_folder_id
    from public.assignments
    where unsubmitted_mail_sent = false
      and completed = false
      and coalesce(submissions_closed, false) = false
      and deadline <= now()
  loop
    select string_agg(roster.student_name, ', ' order by roster.student_name), count(*)
    into names, cnt
    from (
      select distinct on (se.student_id) se.student_id, se.student_name
      from public.student_emails se
      where se.class = r.class::int
      order by se.student_id
    ) roster
    where not exists (
      select 1 from public.assignment_submissions s
      where s.assignment_id = r.id and s.student_id = roster.student_id
    );

    perform net.http_post(
      url := 'https://n8n.saraswatividyamandir.com/webhook/worksheet%20unsubmitted%20mail',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'assignmentId', r.id,
        'class', r.class,
        'subject', r.subject,
        'topic', coalesce(r.portion, r.title),
        'folderLink', case when r.drive_folder_id is not null
          then 'https://drive.google.com/drive/folders/' || r.drive_folder_id
          else null end,
        'unsubmittedCount', coalesce(cnt, 0),
        'unsubmittedStudents', coalesce(names, '')
      )
    );

    update public.assignments set unsubmitted_mail_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'worksheet-unsubmitted-mail',
  '*/5 * * * *',
  $$select public.send_worksheet_unsubmitted_mail();$$
);

-- Sanity check: confirm the job was registered.
select jobid, jobname, schedule, active from cron.job where jobname = 'worksheet-unsubmitted-mail';

-- To test immediately against a real assignment without waiting for its
-- deadline:
-- update public.assignments set deadline = now(), unsubmitted_mail_sent = false where id = '<id>';
-- then run: select public.send_worksheet_unsubmitted_mail();

-- To undo later:
-- select cron.unschedule('worksheet-unsubmitted-mail');
-- drop function public.send_worksheet_unsubmitted_mail();
