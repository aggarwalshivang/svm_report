-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Root cause of "No student profile found for this email" on login, after
-- fix-student-data-select-rls.sql: that RLS policy only lets a logged-in
-- student see the public.student_emails row where student_id matches the
-- student_id baked into their own JWT's app_metadata (set once, at account
-- creation, by create-student-account). If a student's roster ID was later
-- reassigned by a sync script (see sync-students.sql, which both removes and
-- re-adds students with new IDs) without also updating their existing login
-- account's app_metadata, the two now disagree -- so the account
-- authenticates fine, but the profile lookup-by-email in Login.jsx returns
-- zero rows and gets reported as "no profile found." Before that RLS fix,
-- this drift was invisible because every authenticated user could read
-- every row regardless of whose account it was.
--
-- Step 1 (read-only) -- see the scope of the problem before touching anything.

-- Accounts whose app_metadata.student_id doesn't match their current
-- student_emails row (or has none at all) -- these are the broken logins.
select
  u.email,
  u.raw_app_meta_data ->> 'role' as jwt_role,
  u.raw_app_meta_data ->> 'student_id' as jwt_student_id,
  se.student_id as current_student_id,
  se.student_name as current_student_name
from auth.users u
join public.student_emails se on lower(u.email) = lower(se.email)
where coalesce(u.raw_app_meta_data ->> 'role', 'student') <> 'teacher'
  and (u.raw_app_meta_data ->> 'student_id') is distinct from se.student_id::text;

-- student_emails rows with no matching auth account at all (never had
-- "Create Dashboard" clicked, or it failed) -- these can't log in yet, but
-- for a different reason (no account exists), not this one.
select se.student_id, se.student_name, se.email
from public.student_emails se
left join auth.users u on lower(u.email) = lower(se.email)
where u.id is null;

-- auth accounts (non-teacher) with no matching student_emails row -- former
-- students removed from the roster whose login was never cleaned up.
select u.email, u.raw_app_meta_data ->> 'student_id' as jwt_student_id
from auth.users u
left join public.student_emails se on lower(u.email) = lower(se.email)
where coalesce(u.raw_app_meta_data ->> 'role', 'student') <> 'teacher'
  and se.email is null;

-- Step 2 -- fix the drift: resync every mismatched account's app_metadata
-- to match its current student_emails row. Only touches accounts already
-- confirmed as non-teacher + mismatched by the query above; never touches
-- teacher accounts or the 'role' claim itself for anyone already tagged
-- 'teacher'.

update auth.users u
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
  'role', 'student',
  'student_id', se.student_id,
  'student_name', se.student_name
)
from public.student_emails se
where lower(u.email) = lower(se.email)
  and coalesce(u.raw_app_meta_data ->> 'role', 'student') <> 'teacher'
  and (u.raw_app_meta_data ->> 'student_id') is distinct from se.student_id::text;

-- Sanity check: should return zero rows.
select
  u.email,
  u.raw_app_meta_data ->> 'student_id' as jwt_student_id,
  se.student_id as current_student_id
from auth.users u
join public.student_emails se on lower(u.email) = lower(se.email)
where coalesce(u.raw_app_meta_data ->> 'role', 'student') <> 'teacher'
  and (u.raw_app_meta_data ->> 'student_id') is distinct from se.student_id::text;
