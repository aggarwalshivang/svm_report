-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- One consolidated read-only view over every worksheet: all of assignments'
-- own columns (title, subject, class, deadline, link, portion, folder,
-- notes, completed/closed flags) plus computed submission stats (class
-- roster size, how many submitted, how many are missing, % submitted) and a
-- feedback count. Browsable directly in the Table Editor, or query it like
-- any other table/view from the SQL Editor.
--
-- `security_invoker = true` makes this view enforce RLS using the querying
-- user's own role, not the view owner's -- without it, Postgres views
-- default to running with the owner's privileges, which would silently
-- bypass the per-class/per-student scoping added in
-- fix-student-data-select-rls.sql and let any authenticated student read
-- every class's worksheets through this view. With it, this view inherits
-- exactly the same access as querying public.assignments directly: teachers
-- see every worksheet, students see only worksheets for their own class.

create or replace view public.worksheet_report
with (security_invoker = true)
as
select
  a.id,
  a.title,
  a.subject,
  a.class,
  a.portion,
  a.link,
  a.drive_folder_id,
  a.notes,
  a.deadline,
  a.completed,
  a.submissions_closed,
  a.created_at,
  coalesce(roster.total_students, 0) as total_students,
  coalesce(sub.submitted_count, 0) as submitted_count,
  greatest(coalesce(roster.total_students, 0) - coalesce(sub.submitted_count, 0), 0) as missing_count,
  case when coalesce(roster.total_students, 0) = 0 then 0
       else round(100.0 * coalesce(sub.submitted_count, 0) / roster.total_students, 1)
  end as submitted_pct,
  coalesce(fb.feedback_count, 0) as feedback_count
from public.assignments a
left join (
  select cast(class as text) as class, count(distinct student_id) as total_students
  from public.student_emails
  group by class
) roster on roster.class = a.class
left join (
  select assignment_id, count(*) as submitted_count
  from public.assignment_submissions
  group by assignment_id
) sub on sub.assignment_id = a.id
left join (
  select assignment_id, count(*) as feedback_count
  from public.worksheet_feedback
  where assignment_id is not null
  group by assignment_id
) fb on fb.assignment_id = a.id;

grant select on public.worksheet_report to authenticated;

-- Sanity check
select * from public.worksheet_report order by deadline desc limit 20;
