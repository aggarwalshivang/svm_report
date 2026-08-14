-- UpdateReport used to always INSERT on Confirm & Send, so re-confirming the
-- same test (retrying after an error, clicking Confirm Anyway on the
-- duplicate warning, or just uploading the same CSV twice) created a whole
-- new batch of rows for the entire roster instead of updating the existing
-- one. Cleaned up 1,404 pre-existing duplicate rows before adding this
-- (backup: student_scores_dedup_backup_20260815).
--
-- Two rows describe the same test result only if student, class, subject,
-- topic AND date all match -- that's the real identity of a score entry.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create unique index if not exists student_scores_one_per_student_test_date
  on public.student_scores(student_id, class, subject, topic_name, date)
  where student_id is not null;
