-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- SECURITY FIX: any logged-in student could reach the Teacher dashboard and,
-- more importantly, could already read/write/delete any student's data
-- directly via the Supabase API. Root cause: RLS policies on student_emails,
-- student_scores, and assignments grant insert/update/delete to the whole
-- 'authenticated' role — which both teachers AND students belong to, since
-- both sign in via supabase.auth.signInWithPassword(). There was no actual
-- teacher/student distinction at the database level.
--
-- This script:
--   1. Tags the real teacher account(s) with app_metadata.role = 'teacher'.
--   2. Tags every other existing login with app_metadata.role = 'student'.
--      (app_metadata, unlike user_metadata, can only be set by an admin/
--      service-role — a student can NOT edit their own app_metadata from the
--      browser, so it's safe to use as an authorization signal.)
--   3. Replaces the "any authenticated user" policies with ones that check
--      that claim, so only teacher accounts can insert/update/delete.
--
-- After running this, teacher(s) must log out and back in once so their
-- browser picks up a fresh JWT containing the new role claim.

-- 1 & 2 ── Tag accounts ------------------------------------------------------

update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'teacher')
where email in ('aggarwal.shivang@gmail.com', 'admin@saraswatividyamandir.com');

update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', 'student')
where email not in ('aggarwal.shivang@gmail.com', 'admin@saraswatividyamandir.com');

-- 3 ── student_emails ---------------------------------------------------------

drop policy if exists "teachers can insert student_emails" on public.student_emails;
create policy "teachers can insert student_emails"
  on public.student_emails
  for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "teachers can update student_emails" on public.student_emails;
create policy "teachers can update student_emails"
  on public.student_emails
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "teachers can delete student_emails" on public.student_emails;
create policy "teachers can delete student_emails"
  on public.student_emails
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

-- student_scores ----------------------------------------------------------

drop policy if exists "teachers can insert student_scores" on public.student_scores;
create policy "teachers can insert student_scores"
  on public.student_scores
  for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "teachers can update student_scores" on public.student_scores;
create policy "teachers can update student_scores"
  on public.student_scores
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "teachers can delete student_scores" on public.student_scores;
create policy "teachers can delete student_scores"
  on public.student_scores
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

-- assignments ---------------------------------------------------------------

drop policy if exists "Authenticated can update assignments" on public.assignments;
create policy "Teachers can update assignments"
  on public.assignments
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "Authenticated can delete assignments" on public.assignments;
create policy "Teachers can delete assignments"
  on public.assignments
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

-- Sanity checks ---------------------------------------------------------------

select email, raw_app_meta_data ->> 'role' as role from auth.users order by role, email;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('student_emails', 'student_scores', 'assignments')
order by tablename, cmd;
