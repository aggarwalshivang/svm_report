-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).
--
-- Root cause: the Teacher Dashboard's add/remove-student actions call
-- supabase.from('student_scores')/.from('student_emails') insert()/update()/delete(),
-- which succeed with no error even when Row Level Security blocks them (0 rows affected).
-- That's why students silently fail to add, and deleted students "disappear" from the
-- app but are still in the database. Teachers authenticate via supabase.auth, so they
-- run as the 'authenticated' role. If these tables have RLS enabled but are missing
-- INSERT/UPDATE/DELETE policies, those operations are silently no-ops for that role.
--
-- This adds INSERT/UPDATE/DELETE policies for the 'authenticated' role (i.e. logged-in
-- teachers) on both tables so adding, editing, and deleting students actually works.

-- student_emails ---------------------------------------------------------

drop policy if exists "teachers can insert student_emails" on public.student_emails;
create policy "teachers can insert student_emails"
  on public.student_emails
  for insert
  to authenticated
  with check (true);

drop policy if exists "teachers can update student_emails" on public.student_emails;
create policy "teachers can update student_emails"
  on public.student_emails
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "teachers can delete student_emails" on public.student_emails;
create policy "teachers can delete student_emails"
  on public.student_emails
  for delete
  to authenticated
  using (true);

-- student_scores ----------------------------------------------------------

drop policy if exists "teachers can insert student_scores" on public.student_scores;
create policy "teachers can insert student_scores"
  on public.student_scores
  for insert
  to authenticated
  with check (true);

drop policy if exists "teachers can update student_scores" on public.student_scores;
create policy "teachers can update student_scores"
  on public.student_scores
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "teachers can delete student_scores" on public.student_scores;
create policy "teachers can delete student_scores"
  on public.student_scores
  for delete
  to authenticated
  using (true);

-- Sanity check: list all policies on both tables afterwards.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('student_emails', 'student_scores')
order by tablename, cmd;
