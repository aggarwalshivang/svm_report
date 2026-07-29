-- Assignments posted by teachers, created via the assignment-webhook Edge
-- Function (typically triggered from an n8n workflow). Shown in the teacher
-- dashboard's "Assignments" tab.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  class text not null,
  subject text not null,
  title text not null,
  deadline timestamptz not null,
  link text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.assignments enable row level security;

-- Teachers (authenticated) can view and remove assignments from the dashboard.
-- Inserts happen only via assignment-webhook, using the service-role key.
create policy "Authenticated can select assignments"
  on public.assignments for select
  to authenticated
  using (true);

create policy "Authenticated can delete assignments"
  on public.assignments for delete
  to authenticated
  using (true);
