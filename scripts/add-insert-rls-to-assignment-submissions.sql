-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).
--
-- assignment_submissions only had a SELECT policy for 'authenticated' (see
-- create-assignment-submissions-table.sql) — writes only ever happened via the
-- submit-worksheet Edge Function using the service-role key. The Teacher
-- Dashboard's "Mark All Submitted" button now writes to this table directly
-- as the logged-in teacher (the 'authenticated' role), so it needs its own
-- INSERT/UPDATE policy or the upsert silently affects 0 rows (same RLS
-- footgun described in fix-delete-rls.sql).

drop policy if exists "teachers can insert assignment_submissions" on public.assignment_submissions;
create policy "teachers can insert assignment_submissions"
  on public.assignment_submissions
  for insert
  to authenticated
  with check (true);

drop policy if exists "teachers can update assignment_submissions" on public.assignment_submissions;
create policy "teachers can update assignment_submissions"
  on public.assignment_submissions
  for update
  to authenticated
  using (true)
  with check (true);

-- Sanity check: list all policies on the table afterwards.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename = 'assignment_submissions'
order by cmd;
