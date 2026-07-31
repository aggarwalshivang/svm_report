-- Stores per-submission feedback (handwriting + assignment/answer feedback)
-- imported from historical worksheet feedback exports
-- (SVM_Homework_Feedback_Report.csv). Written by
-- scripts/import-worksheet-feedback.mjs using the service-role key.
--
-- handwriting_feedback / assignment_feedback are each prefixed with
-- "[Assignment Name, Class N, Subject]" context so a row reads standalone
-- without needing a join back to assignments.
--
-- Run this once in the Supabase Dashboard -> SQL Editor.

create table if not exists public.worksheet_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id bigint,
  student_name text not null,
  class integer not null,
  subject text not null,
  assignment_name text not null,
  handwriting_feedback text,
  assignment_feedback text,
  submitted_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Same (name, class, assignment, timestamp) submission re-imported should
-- overwrite rather than duplicate; the source CSV also contains a handful of
-- exact duplicate rows this naturally collapses.
create unique index if not exists worksheet_feedback_one_per_submission
  on public.worksheet_feedback (student_name, class, assignment_name, submitted_at);

create index if not exists worksheet_feedback_student_id_idx
  on public.worksheet_feedback (student_id);

create index if not exists worksheet_feedback_assignment_name_idx
  on public.worksheet_feedback (assignment_name);

alter table public.worksheet_feedback enable row level security;

-- Reads happen from both dashboards; writes only happen via the import
-- script using the service-role key (bypasses RLS).
create policy "Authenticated can select worksheet feedback"
  on public.worksheet_feedback for select
  to authenticated
  using (true);
