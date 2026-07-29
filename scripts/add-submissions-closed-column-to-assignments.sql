-- Lets a teacher stop accepting worksheet submissions for an assignment
-- before its deadline arrives (independent of the "completed" flag, which
-- marks the whole assignment done). Run this once in the Supabase Dashboard
-- -> SQL Editor.

alter table public.assignments add column if not exists submissions_closed boolean not null default false;
