-- assignment-webhook used to always INSERT, so re-sending the same
-- assignment (e.g. after fixing the n8n workflow to also send portion/folder)
-- created a duplicate row instead of updating the original -- the original
-- stayed stuck with portion/drive_folder_id still null.
--
-- Two webhook calls describe the same worksheet only if class, subject,
-- title AND deadline all match -- that's the real identity of an assignment.
-- Anything with a different title or a different deadline is a genuinely
-- distinct worksheet and must still get its own row.
-- Run this once in the Supabase Dashboard -> SQL Editor.

create unique index if not exists assignments_one_per_class_subject_title_deadline
  on public.assignments(class, subject, title, deadline);
