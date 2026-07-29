-- Tracks which student has turned in which assignment. Rows are written by
-- the submit-worksheet Edge Function (service role) after the file has been
-- forwarded to the n8n webhook, so a row existing here means the upload made
-- it to n8n successfully.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id bigint not null,
  student_name text,
  file_name text,
  submitted_at timestamptz not null default now()
);

create unique index if not exists assignment_submissions_one_per_student
  on public.assignment_submissions(assignment_id, student_id);

alter table public.assignment_submissions enable row level security;

-- Reads happen from both dashboards; writes only happen server-side via the
-- submit-worksheet Edge Function using the service-role key.
create policy "Authenticated can select submissions"
  on public.assignment_submissions for select
  to authenticated
  using (true);
