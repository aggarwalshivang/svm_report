-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).
--
-- Adds "report_start_date" to student_emails. When set, the Teacher and Student
-- dashboards only count/display student_scores rows dated on or after this date
-- for that student — used so a mid-year student added via "Add Student" doesn't
-- show/count any test that happened before they actually joined.
--
-- Left NULL for all existing students (no cutoff — their full history still
-- shows, since it's genuinely theirs). The "Add Student" flow sets it to the
-- date the student's account is created going forward.

alter table public.student_emails
  add column if not exists report_start_date date;

-- Anvi Katoch (student_id 172) was added on 2026-07-27, before this column
-- existed, so backfill her cutoff to that date — otherwise she'd show/count
-- tests from before she ever joined.
update public.student_emails
set report_start_date = '2026-07-27'
where student_id = 172;
