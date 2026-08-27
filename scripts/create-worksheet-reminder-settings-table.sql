-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Single-row settings table backing the "Reminder Settings" control on the
-- Teacher Dashboard's Assignments tab: how long before a worksheet deadline
-- the WhatsApp reminder goes out, and the message text itself. Read by
-- send_worksheet_deadline_reminders() (see
-- send-worksheet-deadline-reminder.sql) instead of hardcoding those values,
-- so a teacher can change them without touching SQL.

create table if not exists public.worksheet_reminder_settings (
  id smallint primary key default 1 check (id = 1), -- singleton: only row id=1 may ever exist
  lead_minutes integer not null default 60,
  -- {{time}} is replaced with the reminder's send time (deadline - lead_minutes),
  -- formatted like "3:00 p.m." IST.
  message_template text not null default $tpl$Dear Students ,

Kindly complete and submit your worksheets as early as possible.

The list of students yet to submit will be shared at {{time}} today — try to finish before then.

Thank you.$tpl$,
  updated_at timestamptz not null default now()
);

insert into public.worksheet_reminder_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.worksheet_reminder_settings enable row level security;

drop policy if exists "teachers can select reminder settings" on public.worksheet_reminder_settings;
create policy "teachers can select reminder settings"
  on public.worksheet_reminder_settings
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

drop policy if exists "teachers can update reminder settings" on public.worksheet_reminder_settings;
create policy "teachers can update reminder settings"
  on public.worksheet_reminder_settings
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'teacher');

-- Sanity check
select * from public.worksheet_reminder_settings;
