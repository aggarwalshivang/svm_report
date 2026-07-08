-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).
--
-- Root cause: deleting a student in the Teacher Dashboard calls
-- supabase.from('student_scores').delete() and supabase.from('student_emails').delete(),
-- which succeed with no error even when Row Level Security blocks them (0 rows removed).
-- That's why the student "disappears" from the app but is still in the database.
-- Teachers authenticate via supabase.auth, so they run as the 'authenticated' role.
-- If these tables have RLS enabled but no DELETE policy, every delete is silently a no-op.
--
-- This adds DELETE policies for the 'authenticated' role (i.e. logged-in teachers) on both
-- tables so deleting a student actually removes their email(s)/login and their score reports.

drop policy if exists "teachers can delete student_emails" on public.student_emails;
create policy "teachers can delete student_emails"
  on public.student_emails
  for delete
  to authenticated
  using (true);

drop policy if exists "teachers can delete student_scores" on public.student_scores;
create policy "teachers can delete student_scores"
  on public.student_scores
  for delete
  to authenticated
  using (true);

-- Sanity check: list delete policies on both tables afterwards.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where tablename in ('student_emails', 'student_scores')
  and cmd = 'DELETE';
