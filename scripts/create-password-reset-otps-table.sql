-- Run this once in the Supabase Dashboard -> SQL Editor (project: cexbpkbadthoqbruyjdg).
--
-- Backing table for the email-OTP password reset flow (send-password-otp /
-- verify-password-otp Edge Functions). Codes are stored as a SHA-256 hash,
-- never in plaintext. RLS is enabled with no policies, so only the Edge
-- Functions (which use the service-role key) can read or write rows.

create table if not exists public.password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_otps_email_idx
  on public.password_reset_otps (email, created_at desc);

alter table public.password_reset_otps enable row level security;
