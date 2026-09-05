-- Sends a WhatsApp message to a class's group chat listing everyone who
-- hasn't submitted YET for their currently-open worksheet (deadline still in
-- the future) -- a periodic "here's where things stand" nudge, not the
-- after-deadline notice handled by send-worksheet-unsubmitted-mail.sql.
--
-- One function, two ways in:
--   1. Automatic -- pg_cron fires it on a fixed daily/weekend schedule
--      (mirrors the n8n "unsubmitted" Schedule Trigger: daily at 3pm IST,
--      plus an extra run at 12pm IST on Saturday/Sunday). Gated by
--      worksheet_auto_send_settings.unsubmitted_enabled, so the "Automatic
--      Send Report" toggle on the Teacher Dashboard can pause it without
--      touching the cron schedule itself.
--   2. Manual -- granted EXECUTE to `authenticated` so the Teacher
--      Dashboard's "Send Unsubmitted List" button can call it directly via
--      supabase.rpc(), guaranteeing the manual and automatic paths always
--      compute the exact same list the exact same way. The manual button
--      always sends regardless of the toggle -- "pause the automatic nudge"
--      shouldn't silently swallow a teacher's explicit manual click.
--
-- Same DISTINCT ON (student_id) roster dedup as
-- send-worksheet-unsubmitted-mail.sql, for the same reason: student_emails
-- has duplicate rows per student.
--
-- Run create-worksheet-auto-send-settings-table.sql BEFORE this script.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- Changing signature (adding respect_toggle) -- drop the original zero-arg
-- version first so a no-arg call can't end up ambiguous between the two.
drop function if exists public.send_worksheet_unsubmitted_whatsapp();

create or replace function public.send_worksheet_unsubmitted_whatsapp(respect_toggle boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  names text;
  chat_id text;
  auto_enabled boolean;
begin
  if respect_toggle then
    select unsubmitted_enabled into auto_enabled
    from public.worksheet_auto_send_settings where id = 1;

    if not coalesce(auto_enabled, true) then
      return; -- paused via the "Automatic Send Report" toggle
    end if;
  end if;

  for r in
    select id, class, portion, title
    from public.assignments
    where completed = false
      and coalesce(submissions_closed, false) = false
      and deadline > now()
  loop
    -- Only Class 9 and Class 10 have a WhatsApp group configured today
    -- (same mapping as send_worksheet_deadline_reminders()).
    chat_id := case r.class
      when '9' then '120363407356139819@g.us'
      when '10' then '120363415866495945@g.us'
      else null
    end;

    if chat_id is null then
      continue;
    end if;

    select string_agg(roster.student_name, E'\n' order by roster.student_name)
    into names
    from (
      select distinct on (se.student_id) se.student_id, se.student_name
      from public.student_emails se
      where se.class = r.class::int
      order by se.student_id
    ) roster
    where not exists (
      select 1 from public.assignment_submissions s
      where s.assignment_id = r.id and s.student_id = roster.student_id
    );

    if names is null or names = '' then
      continue; -- everyone in this class has already submitted -- nothing to nudge about
    end if;

    perform net.http_post(
      url := 'https://n8n.saraswatividyamandir.com/webhook/send%20unsubmitted%20whatsapp%20list',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'chatId', chat_id,
        'class', r.class,
        'assignmentId', r.id,
        'message', 'Students Who havent submitted the worksheet yet' || E'\n'
          || coalesce(r.portion, r.title) || E'\n\n' || names
      )
    );
  end loop;
end;
$$;

-- Lets the Teacher Dashboard call this directly (supabase.rpc(...)) for the
-- manual "Send Unsubmitted List" button, passing respect_toggle: false.
grant execute on function public.send_worksheet_unsubmitted_whatsapp(boolean) to authenticated;

-- Daily at 3:00pm IST = 9:30 UTC (pg_cron runs in UTC).
select cron.schedule(
  'worksheet-unsubmitted-whatsapp-daily',
  '30 9 * * *',
  $$select public.send_worksheet_unsubmitted_whatsapp();$$
);

-- Extra run on Saturday/Sunday at 12:00pm IST = 6:30 UTC.
select cron.schedule(
  'worksheet-unsubmitted-whatsapp-weekend',
  '30 6 * * 0,6',
  $$select public.send_worksheet_unsubmitted_whatsapp();$$
);

-- Sanity check: confirm both jobs were registered.
select jobid, jobname, schedule, active from cron.job
where jobname in ('worksheet-unsubmitted-whatsapp-daily', 'worksheet-unsubmitted-whatsapp-weekend');

-- To test immediately (bypassing the toggle): select public.send_worksheet_unsubmitted_whatsapp(false);

-- To undo later:
-- select cron.unschedule('worksheet-unsubmitted-whatsapp-daily');
-- select cron.unschedule('worksheet-unsubmitted-whatsapp-weekend');
-- drop function public.send_worksheet_unsubmitted_whatsapp(boolean);
