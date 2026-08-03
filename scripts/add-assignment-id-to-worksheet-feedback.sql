-- Live worksheet submissions (via submit-worksheet Edge Function) previously
-- upserted onConflict (student_name, class, assignment_name, submitted_at) --
-- but submitted_at is freshly generated on every call, so that conflict
-- target never matched a prior row: resubmitting the same assignment just
-- inserted a duplicate feedback row instead of replacing the old one.
--
-- assignment_id gives live submissions the same reliable conflict key
-- assignment_submissions already uses. It's nullable because historical
-- rows imported from the old CSV export have no assignment to point at
-- (matched to a card by free-text title instead -- see StudentDashboard.jsx).
-- Run this once in the Supabase Dashboard -> SQL Editor.

alter table public.worksheet_feedback
  add column if not exists assignment_id uuid references public.assignments(id) on delete cascade;

create unique index if not exists worksheet_feedback_one_per_assignment_submission
  on public.worksheet_feedback(assignment_id, student_id)
  where assignment_id is not null;
