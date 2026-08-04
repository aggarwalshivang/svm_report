-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- One-time backfill: for every existing worksheet (public.assignments row)
-- that currently has ZERO rows in assignment_submissions, insert a
-- submission row for every student in that worksheet's class -- the same
-- effect as clicking "Mark All Submitted" on the Teacher Dashboard
-- (TeacherDashboard.jsx's markAllSubmitted) for that worksheet, just applied
-- in bulk to the current backlog in a single run.
--
-- Scope: only touches worksheets with NO submissions recorded at all. Any
-- worksheet with even one real submission (student- or teacher-recorded) is
-- left completely untouched -- this will never overwrite or duplicate an
-- existing submission.
--
-- After this runs, every affected worksheet will show as "Completed" on
-- every enrolled student's dashboard (assignmentStatus in StudentDashboard.jsx
-- treats any assignment_submissions row as proof of completion).
--
-- submitted_at is backdated to each worksheet's own deadline (not "now") so
-- these backfilled rows never show as "Completed (late)" -- most of these
-- deadlines are already in the past, and stamping them with today's
-- timestamp would make every one of them read as a late submission, which
-- isn't true for a historical backfill.

insert into public.assignment_submissions (assignment_id, student_id, student_name, submitted_at)
select a.id, se.student_id, se.student_name, a.deadline
from public.assignments a
join public.student_emails se
  on cast(se.class as text) = a.class
where not exists (
  select 1 from public.assignment_submissions s where s.assignment_id = a.id
)
on conflict (assignment_id, student_id) do nothing;

-- Sanity check: every worksheet's submission count after the backfill.
-- Anything still at 0 has no matching students in student_emails for its
-- class (e.g. class typo, or a class with no registered students).
select a.id, a.title, a.class,
  (select count(*) from public.assignment_submissions s where s.assignment_id = a.id) as submission_count
from public.assignments a
order by submission_count asc, a.class, a.title;
