-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Extends backfill-zero-submission-assignments.sql: that script only topped
-- up worksheets with ZERO submissions. This one tops up worksheets that
-- aren't already at 100%, but ONLY if they currently have 10 or fewer real
-- submissions -- for every (worksheet, student) pair with no existing
-- assignment_submissions row, insert one. Real submissions (student- or
-- teacher-recorded) are never touched or overwritten -- the `not exists`
-- check is per student per worksheet, not per worksheet, so a worksheet
-- that already has 5 real submissions out of 62 just gets the other 57
-- filled in around them.
--
-- Worksheets that already have MORE than 10 real submissions are left
-- completely alone -- their actual submAission count/rate is kept as-is,
-- not topped up. That threshold is checked against the count as it stands
-- BEFORE this script runs (a subquery against assignment_submissions,
-- evaluated once per worksheet), so a worksheet just under the line still
-- gets fully topped up, not partially.
--
-- Be aware of what this means for everything under the threshold: after
-- running this, every student will show as "Completed" for those
-- worksheets, whether they actually turned it in or not. This is a
-- deliberate, requested bulk action, not a correction of missing data -- it
-- erases the "who actually submitted" signal for every worksheet it touches.
--

-- submitted_at is backdated to each worksheet's own deadline, same as
-- backfill-zero-submission-assignments.sql, so nothing shows as late.
--
-- The worksheet_report table (create-worksheet-report-table.sql) and the
-- Teacher Dashboard's "Worksheet Analysis" percentages will both update on
-- their own once this runs -- no separate refresh step needed.

insert into public.assignment_submissions (assignment_id, student_id, student_name, submitted_at)
select a.id, se.student_id, se.student_name, a.deadline
from public.assignments a
join public.student_emails se
  on cast(se.class as text) = a.class
where not exists (
  select 1 from public.assignment_submissions s
  where s.assignment_id = a.id and s.student_id = se.student_id
)
and (
  select count(*) from public.assignment_submissions s2 where s2.assignment_id = a.id
) <= 10
on conflict (assignment_id, student_id) do nothing;

-- Sanity check: every worksheet's submission count vs its class roster size
-- after the top-up (should all match, i.e. show 0 in the "missing" column).
select a.id, a.title, a.class,
  (select count(distinct student_id) from public.student_emails se where cast(se.class as text) = a.class) as roster_size,
  (select count(*) from public.assignment_submissions s where s.assignment_id = a.id) as submission_count
from public.assignments a
order by (
  (select count(distinct student_id) from public.student_emails se where cast(se.class as text) = a.class)
  - (select count(*) from public.assignment_submissions s where s.assignment_id = a.id)
) desc, a.class, a.title;
