-- Sends a WhatsApp reminder to a class's group chat some time before each of
-- that class's worksheet deadlines, via the n8n webhook
-- "SVM Report- Reminder Wp Worksheet". Runs unattended on pg_cron so no one
-- has to remember to click anything (same pattern as
-- auto-complete-worksheets-after-deadline.sql).
--
-- How long before the deadline, and the message text, both come from
-- public.worksheet_reminder_settings (see
-- create-worksheet-reminder-settings-table.sql) instead of being hardcoded
-- here, so a teacher can change either from the Teacher Dashboard's
-- Assignments tab -> "Reminder Settings" without touching SQL.
--
-- Run create-worksheet-reminder-settings-table.sql BEFORE this script.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- Tracks whether an assignment's reminder has already gone out, so a job
-- that runs every 5 minutes doesn't resend it every time it re-enters the
-- catch window.
alter table public.assignments
  add column if not exists reminder_sent boolean not null default false;

create or replace function public.send_worksheet_deadline_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  settings record;
  r record;
  group_id text;
  reminder_time timestamptz;
  time_label text;
  message text;
begin
  select lead_minutes, message_template into settings
  from public.worksheet_reminder_settings where id = 1;

  if not found then
    return; -- settings table hasn't been seeded yet
  end if;

  for r in
    select id, class, deadline
    from public.assignments
    where reminder_sent = false
      and completed = false
      and coalesce(submissions_closed, false) = false
      -- Catch window: the job runs every 5 minutes, so this 10-minute-wide
      -- band around "deadline - lead_minutes" guarantees at least one run
      -- lands inside it even with a bit of scheduler jitter.
      and deadline between now() + (greatest(settings.lead_minutes - 5, 0) || ' minutes')::interval
                       and now() + ((settings.lead_minutes + 5) || ' minutes')::interval
  loop
    -- Only Class 9 and Class 10 have a WhatsApp group configured today.
    group_id := case r.class
      when '9' then '120363407356139819@g.us'
      when '10' then '120363415866495945@g.us'
      else null
    end;

    if group_id is null then
      continue;
    end if;

    reminder_time := r.deadline - (settings.lead_minutes || ' minutes')::interval;

    -- IST, formatted like "3:00 p.m." (matches the wording of the reminder
    -- message itself, not the app's own formatIST() which reads "3:00 pm").
    time_label := lower(trim(leading '0' from to_char(reminder_time at time zone 'Asia/Kolkata', 'HH12:MI AM')));
    time_label := replace(replace(time_label, 'am', 'a.m.'), 'pm', 'p.m.');

    message := replace(settings.message_template, '{{time}}', time_label);

    perform net.http_post(
      url := 'https://n8n.saraswatividyamandir.com/webhook/SVM%20Report-%20Reminder%20Wp%20Worksheet',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'message', message,
        'groupId', group_id,
        'class', r.class,
        'assignmentId', r.id
      )
    );

    update public.assignments set reminder_sent = true where id = r.id;
  end loop;
end;
$$;

select cron.schedule(
  'worksheet-deadline-reminder',
  '*/5 * * * *',
  $$select public.send_worksheet_deadline_reminders();$$
);

-- Sanity check: confirm the job was registered.
select jobid, jobname, schedule, active from cron.job where jobname = 'worksheet-deadline-reminder';

-- To test immediately against a real assignment without waiting for the
-- window, temporarily set its deadline to (now + configured lead_minutes):
-- update public.assignments a set deadline = now() + (
--   (select lead_minutes from public.worksheet_reminder_settings where id = 1) || ' minutes'
-- )::interval, reminder_sent = false where id = '<id>';
-- then run: select public.send_worksheet_deadline_reminders();

-- To undo later:
-- select cron.unschedule('worksheet-deadline-reminder');
-- drop function public.send_worksheet_deadline_reminders();
