-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Single-row settings table backing the "Automatic Send Report" control on
-- the Teacher Dashboard's Assignments tab: whether the periodic pre-deadline
-- WhatsApp nudges (see send-worksheet-unsubmitted-whatsapp.sql, and its
-- eventual submitted-list counterpart) are turned on. Read by
-- send_worksheet_unsubmitted_whatsapp() so a teacher can pause/resume it
-- without touching SQL or unscheduling the cron job itself.
--
-- Deliberately separate from worksheet_reminder_settings (the pre-deadline
-- text-only reminder) and has no bearing on
-- send_worksheet_unsubmitted_mail() (the after-deadline email) -- that one
-- is mandatory and always runs, by design, with no toggle.

create table if not exists public.worksheet_auto_send_settings (
  id smallint primary key default 1 check (id = 1), -- singleton: only row id=1 may ever exist
  unsubmitted_enabled boolean not null default true,
  -- Not wired up yet -- send_worksheet_submitted_whatsapp() doesn't exist
  -- until a submitted-list webhook is available. Kept here now so the UI
  -- toggle has somewhere to live once it is.
  submitted_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.worksheet_auto_send_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.worksheet_auto_send_settings enable row level security;

drop policy if exists "teachers can select auto send settings" on public.worksheet_auto_send_settings;
create policy "teachers can select auto send settings"
  on public.worksheet_auto_send_settings
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "teachers can update auto send settings" on public.worksheet_auto_send_settings;
create policy "teachers can update auto send settings"
  on public.worksheet_auto_send_settings
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

-- Sanity check
select * from public.worksheet_auto_send_settings;
