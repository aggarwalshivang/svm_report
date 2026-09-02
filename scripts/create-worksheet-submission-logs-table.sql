-- Logs every worksheet submission attempt that did NOT cleanly succeed:
-- n8n/server errors, unreadable-scan rejections, DB upsert failures, and
-- client-side network failures that never reached submit-worksheet at all.
--
-- Without this, a failed attempt just... vanishes -- no row in
-- assignment_submissions or worksheet_feedback, no trace of why. That's
-- what made the Rimjhim "submitted twice but still Missing" report hard to
-- diagnose: nothing in the DB distinguished "never actually submitted"
-- from "submitted and silently failed". This table exists so the next
-- report like that has a paper trail instead of requiring a manual DB dig.
--
-- Run this once in the Supabase Dashboard -> SQL Editor.

create table if not exists public.worksheet_submission_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  assignment_id uuid references public.assignments(id) on delete set null,
  student_id bigint,
  student_name text,
  class text,
  subject text,
  file_name text,
  attempt_number integer,
  -- 'client': logged by the browser before/without ever getting a response
  --   from submit-worksheet (e.g. the connection died outright).
  -- 'edge_function': logged by submit-worksheet itself, so we know the
  --   upload reached the server and know exactly which step failed.
  source text not null check (source in ('client', 'edge_function')),
  status text not null check (status in (
    'network_failure',      -- client never got a response, retries exhausted
    'server_error',         -- n8n webhook returned non-2xx or was unreachable
    'rejected_unreadable',  -- n8n graded it but returned "no feedback"
    'db_upsert_failed',     -- n8n succeeded but writing the submission row failed
    'timeout_no_response',  -- grading call aborted after N8N_TIMEOUT_MS
    'exception'             -- anything else unexpected
  )),
  error_message text,
  detail jsonb,
  constraint worksheet_submission_logs_attempt_number_check check (attempt_number is null or attempt_number > 0)
);

create index if not exists worksheet_submission_logs_student_id_idx
  on public.worksheet_submission_logs (student_id);

create index if not exists worksheet_submission_logs_assignment_id_idx
  on public.worksheet_submission_logs (assignment_id);

create index if not exists worksheet_submission_logs_created_at_idx
  on public.worksheet_submission_logs (created_at desc);

alter table public.worksheet_submission_logs enable row level security;

-- Any signed-in student can log their own failed attempt (client-side
-- failures are inserted with the student's own session); the edge function
-- writes with the service-role key and bypasses RLS entirely.
create policy "Authenticated can insert submission logs"
  on public.worksheet_submission_logs for insert
  to authenticated
  with check (true);

-- Only teachers get to read the log -- it's diagnostic/support data, not
-- something a student dashboard needs to show.
create policy "Teachers can select submission logs"
  on public.worksheet_submission_logs for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');
