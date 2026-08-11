-- Some students don't bring their own device for a Learnyst test and borrow
-- a classmate's/a shared "temp" device instead — the Learnyst export then
-- shows that device's own registered name/email for the row, not whoever
-- actually took the test. Since who used a shared device varies submission
-- to submission, this is a flat list of known shared-device emails (not a
-- fixed email->student mapping) — the Update Report tab uses it to force a
-- manual "who really took this?" prompt every time one of these emails
-- shows up in an uploaded CSV, instead of silently trusting the row.
--
-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).

create table if not exists public.report_shared_device_emails (
  id bigint generated always as identity primary key,
  email text not null unique,
  label text,
  created_at timestamptz not null default now()
);

alter table public.report_shared_device_emails enable row level security;

drop policy if exists "teachers can read shared device emails" on public.report_shared_device_emails;
create policy "teachers can read shared device emails"
  on public.report_shared_device_emails
  for select
  to authenticated
  using (true);

drop policy if exists "teachers can insert shared device emails" on public.report_shared_device_emails;
create policy "teachers can insert shared device emails"
  on public.report_shared_device_emails
  for insert
  to authenticated
  with check (true);

drop policy if exists "teachers can delete shared device emails" on public.report_shared_device_emails;
create policy "teachers can delete shared device emails"
  on public.report_shared_device_emails
  for delete
  to authenticated
  using (true);

-- Known shared devices as of 2026-08-11 (from real Learnyst submissions).
insert into public.report_shared_device_emails (email, label) values
  ('sharmasiddhi218@gmail.com', 'Siddhi Sharma'),
  ('bhumikaverma810@gmail.com', 'Bhumika Verma'),
  ('poojarora875@gmail.com', 'Pooja Arora'),
  ('svmambala@gmail.com', null)
on conflict (email) do nothing;
