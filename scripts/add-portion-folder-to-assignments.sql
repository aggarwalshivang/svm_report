-- Adds the metadata needed to forward a student's worksheet submission to the
-- n8n "student-form-worksheet" webhook: the drive folder to save into, and a
-- short "portion" slug describing what the worksheet covers. `link` (already
-- on the table) doubles as the worksheet file to forward.
-- Run this once in the Supabase Dashboard -> SQL Editor.

alter table public.assignments add column if not exists portion text;
alter table public.assignments add column if not exists drive_folder_id text;
