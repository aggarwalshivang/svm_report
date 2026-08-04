-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- SECURITY FIX: every SELECT policy on student_emails, student_scores,
-- assignment_submissions, worksheet_feedback and assignments grants read
-- access to the whole 'authenticated' role with `using (true)` (see
-- create-assignment-submissions-table.sql, create-worksheet-feedback-table.sql,
-- create-assignments-table.sql — student_emails/student_scores were created
-- outside this scripts/ folder but fix-teacher-role-security.sql shows the
-- same pattern was never fixed for SELECT, only INSERT/UPDATE/DELETE).
-- Students authenticate via the same 'authenticated' role as teachers, so
-- any logged-in student can currently run e.g.
--   supabase.from('student_scores').select('*')
-- from the browser console and read every other student's scores, emails,
-- phone numbers, worksheet submissions and feedback school-wide. The
-- dashboards only *look* scoped to "my own data" because the frontend adds
-- a `.eq('student_id', session.studentId)` filter — and session.studentId is
-- read straight out of localStorage, which is entirely client-controlled.
--
-- This script drops every existing SELECT policy on the five tables
-- (whatever they're currently named) and replaces each with one that only
-- lets a caller read:
--   - all rows, if they're a teacher (app_metadata.role = 'teacher'), or
--   - their own rows, if they're a student (app_metadata.student_id matches
--     the row's student_id — for assignments, which has no student_id
--     column, "own rows" means assignments for their own class, looked up
--     via their student_emails row).
--
-- app_metadata is admin/service-role-only (set by create-student-account),
-- so a student can't forge either claim from the browser.

-- Drop every existing SELECT policy on these tables, regardless of name -----
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('student_emails', 'student_scores', 'assignment_submissions', 'worksheet_feedback', 'assignments')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- student_emails --------------------------------------------------------------

create policy "teachers can select all, students their own row"
  on public.student_emails
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
    or student_id = (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint
  );

-- student_scores ----------------------------------------------------------

create policy "teachers can select all, students their own scores"
  on public.student_scores
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
    or student_id = (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint
  );

-- assignment_submissions ---------------------------------------------------

create policy "teachers can select all, students their own submissions"
  on public.assignment_submissions
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
    or student_id = (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint
  );

-- worksheet_feedback --------------------------------------------------------

create policy "teachers can select all, students their own feedback"
  on public.worksheet_feedback
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
    or student_id = (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint
  );

-- assignments ---------------------------------------------------------------
-- No student_id column here (assignments are per-class, not per-student) —
-- a student may see an assignment only if it's for their own class.

create policy "teachers can select all, students their own class"
  on public.assignments
  for select
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher'
    or exists (
      select 1
      from public.student_emails se
      where se.student_id = (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint
        and se.class::text = assignments.class
    )
  );

-- Sanity checks ---------------------------------------------------------------

select schemaname, tablename, policyname, cmd, roles, qual
from pg_policies
where tablename in ('student_emails', 'student_scores', 'assignment_submissions', 'worksheet_feedback', 'assignments')
order by tablename, cmd;
