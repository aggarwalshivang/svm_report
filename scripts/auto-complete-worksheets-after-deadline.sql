-- Automates the "Mark Completed" toggle on the Teacher Dashboard
-- (src/pages/TeacherDashboard.jsx's toggleAssignmentCompleted): instead of a
-- teacher remembering to click it, a worksheet flips to completed = true on
-- its own 2 days after its deadline has passed. Doesn't touch worksheets a
-- teacher has already marked completed manually, and never un-completes one
-- (a teacher's manual "un-complete" click always wins over the schedule).
--
-- Run this once in the Supabase Dashboard -> SQL Editor.

-- pg_cron ships as an available extension on Supabase; this just turns it on
-- for this project if it isn't already.
create extension if not exists pg_cron with schema extensions;

-- Deadlines are IST (see formatIST() in TeacherDashboard.jsx); pg_cron runs
-- on UTC, so 21:00 UTC = 2:30am IST -- comfortably inside the "2 days after"
-- window no matter the deadline's time of day, and off-hours for both.
select cron.schedule(
  'auto-complete-worksheets-after-deadline',
  '0 21 * * *',
  $$
  update public.assignments
  set completed = true
  where completed = false
    and deadline < now() - interval '2 days'
  $$
);

-- Sanity check: confirm the job was registered.
select jobid, jobname, schedule, active from cron.job where jobname = 'auto-complete-worksheets-after-deadline';

-- To undo later: select cron.unschedule('auto-complete-worksheets-after-deadline');
