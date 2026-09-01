-- Per add-report-start-date-column.sql, report_start_date should be NULL
-- for every pre-existing student ("no cutoff -- their full history still
-- shows, since it's genuinely theirs") and only set for students added
-- mid-year via the "Add Student" flow, which stamps today's date.
--
-- addStudent() (TeacherDashboard.jsx) sets report_start_date to the date
-- the row was created in student_emails, not the date the student actually
-- joined the class. When a pre-existing student's student_emails row got
-- re-created/re-added later (rather than genuinely joining the class late),
-- their cutoff ends up excluding real test history that is genuinely theirs
-- -- e.g. Atharv Aggarwal's cutoff (2026-05-14) hides real scores going
-- back to 2026-04-06, causing his dashboard/leaderboard totals to undercount
-- against the rest of the class (95/106 instead of .../137).
--
-- Scope: of 145 class-9 and 129 class-10 students with a report_start_date
-- set, only these 3 (all class 9) have a real, non-absent score dated
-- before their own cutoff -- direct proof the cutoff is wrong per the
-- app's own logic. Everyone else's cutoff happens to predate their actual
-- activity, so leaving them untouched changes nothing for them.
--
-- Run via: npx supabase db query --linked -f scripts/fix-report-start-date-false-cutoffs.sql

begin;

update student_emails
set report_start_date = null
where student_id in (62, 172, 175); -- Atharv Aggarwal, Anvi Katoch, Aaradhya (class 9)

commit;
