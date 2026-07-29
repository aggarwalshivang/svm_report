-- Generic one-time codes used to confirm sensitive teacher actions (e.g.
-- deleting a student) via email, kept separate from password_reset_otps so
-- verifying one never has the side effect of changing a user's password.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create table if not exists public.action_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.action_otps enable row level security;
-- No policies: only the service-role key (used inside Edge Functions) can access this table.
