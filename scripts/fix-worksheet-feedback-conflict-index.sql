-- worksheet_feedback_one_per_assignment_submission (add-assignment-id-to-worksheet-feedback.sql)
-- was created as a PARTIAL unique index ("where assignment_id is not null").
-- Postgres can only infer a partial index as an ON CONFLICT target when the
-- conflict clause repeats the same WHERE predicate -- submit-worksheet's
-- upsert (onConflict: 'assignment_id,student_id') sends only the column
-- list, so every live submission failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Fix: make it a plain (non-partial) unique index. NULLs are still treated
-- as distinct from each other in a normal unique index, so legacy
-- CSV-imported rows (assignment_id IS NULL) are unaffected -- any number of
-- them can still coexist -- while live submissions (assignment_id NOT NULL)
-- now have a valid ON CONFLICT target.
-- Run this once in the Supabase Dashboard -> SQL Editor.

drop index if exists worksheet_feedback_one_per_assignment_submission;

create unique index if not exists worksheet_feedback_one_per_assignment_submission
  on public.worksheet_feedback(assignment_id, student_id);
