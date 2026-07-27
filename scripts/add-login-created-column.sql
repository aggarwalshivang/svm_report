-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).
--
-- Adds "login_created" to student_emails, tracking whether a Supabase Auth
-- account (default password) exists for that email row. Defaults to true for
-- all existing rows (they already have accounts from the bulk provisioning
-- script), so the "Create Dashboard" button in the Teacher Dashboard's
-- Manage tab only shows up for genuinely new, not-yet-provisioned students.

alter table public.student_emails
  add column if not exists login_created boolean not null default true;

alter table public.student_emails
  alter column login_created set default false;

-- Anvi Katoch (student_id 172) was added since the last bulk-provisioning run
-- and doesn't have a login yet — flip her back to false so "Create Dashboard"
-- shows up for her.
update public.student_emails
set login_created = false
where student_id = 172;

-- Sanity check
select student_id, student_name, login_created
from public.student_emails
where login_created = false
order by student_id;
