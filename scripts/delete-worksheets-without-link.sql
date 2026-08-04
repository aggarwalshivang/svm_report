-- Removes every worksheet that has no link (the "Worksheet" open-in-Drive
-- button on the Teacher Dashboard has nothing to point to for these).
-- assignment_submissions and worksheet_feedback rows for these worksheets
-- cascade-delete automatically (both reference assignments(id) on delete
-- cascade), same as clicking "Remove" in the dashboard would do.
-- Run this once in the Supabase Dashboard -> SQL Editor.

-- Preview first — check this list before running the delete below.
select id, title, class, subject, deadline
from public.assignments
where link is null or trim(link) = ''
order by deadline desc;

-- Then run this to actually delete them.
delete from public.assignments
where link is null or trim(link) = '';
