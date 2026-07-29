-- Lets teachers mark an assignment as completed from the dashboard instead of
-- relying on the deadline having passed ("Overdue").
-- Run this once in the Supabase Dashboard -> SQL Editor.

alter table public.assignments add column if not exists completed boolean not null default false;

create policy "Authenticated can update assignments"
  on public.assignments for update
  to authenticated
  using (true)
  with check (true);
