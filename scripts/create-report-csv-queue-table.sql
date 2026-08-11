-- Holds CSV score exports pushed in from n8n (via the report-csv-webhook
-- edge function) before a teacher reviews/edits them in the Update Report
-- tab. Text, not Storage -- these files are a few KB, same "just a column"
-- approach this app already uses elsewhere (no bucket needed). A row is
-- deleted once its CSV is either uploaded (processed into student_scores)
-- or rejected by the teacher -- this table is a queue, not an archive.
--
-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).

create table if not exists public.report_csv_queue (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  csv_content text not null,
  received_at timestamptz not null default now()
);

alter table public.report_csv_queue enable row level security;

-- Only the report-csv-webhook edge function (service-role key) inserts rows
-- -- no insert/update policy for the anon/authenticated roles.
drop policy if exists "teachers can read csv queue" on public.report_csv_queue;
create policy "teachers can read csv queue"
  on public.report_csv_queue
  for select
  to authenticated
  using (true);

drop policy if exists "teachers can delete csv queue" on public.report_csv_queue;
create policy "teachers can delete csv queue"
  on public.report_csv_queue
  for delete
  to authenticated
  using (true);
