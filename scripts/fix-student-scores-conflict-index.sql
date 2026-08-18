-- student_scores_one_per_student_test_date (add-unique-key-to-student-scores.sql)
-- was created as a PARTIAL unique index ("where student_id is not null").
-- Postgres can only infer a partial index as an ON CONFLICT target when the
-- conflict clause repeats the same WHERE predicate -- insertScoreRows's
-- upsert (onConflict: 'student_id,class,subject,topic_name,date') sends only
-- the column list, so every Confirm & Send failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Fix: make it a plain (non-partial) unique index. NULLs are still treated
-- as distinct from each other in a normal unique index, so the 364 existing
-- rows with student_id IS NULL are unaffected -- any number of them can
-- still coexist -- while matched rows (student_id NOT NULL) now have a
-- valid ON CONFLICT target.
-- Run this once in the Supabase Dashboard -> SQL Editor.

drop index if exists student_scores_one_per_student_test_date;

create unique index if not exists student_scores_one_per_student_test_date
  on public.student_scores(student_id, class, subject, topic_name, date);
