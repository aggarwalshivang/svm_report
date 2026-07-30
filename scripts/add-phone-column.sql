-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Adds a "phone" column to student_emails to hold the student's contact
-- phone number, shown/edited in the Teacher Dashboard roster.

alter table public.student_emails
  add column if not exists phone text;
