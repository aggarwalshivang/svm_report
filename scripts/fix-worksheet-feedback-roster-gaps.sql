-- Fixes the 7 unmatched-student cases surfaced by
-- scripts/import-worksheet-feedback.mjs's dry run, cross-checked against the
-- master roster in scripts/compare-roster.mjs.
-- Run this once in the Supabase Dashboard -> SQL Editor.

-- ── 1. Re-add students that sync-students.sql specified but never landed ──
-- (confirmed via compare-roster.mjs: both are on the master roster and were
-- already assigned these ids/emails in sync-students.sql)
-- student_emails has no unique constraint on student_id (it allows multiple
-- email rows per student), so ON CONFLICT (student_id) isn't valid here —
-- use NOT EXISTS instead to stay idempotent on re-run.
INSERT INTO student_emails (student_id, student_name, class, email)
SELECT 135, 'Madhav Manan', 10, 'mm2410.gur@kunskapsskolan.edu.in'
WHERE NOT EXISTS (SELECT 1 FROM student_emails WHERE student_id = 135);

INSERT INTO student_emails (student_id, student_name, class, email)
SELECT 144, 'Smarth Yadav', 10, 'nehanehayadav04@gmail.com'
WHERE NOT EXISTS (SELECT 1 FROM student_emails WHERE student_id = 144);

-- ── 2. TODO: fill in real emails, then uncomment and run ──────────────────
-- Both are on the master roster (compare-roster.mjs) but have no email on
-- record anywhere in this repo's history — need real ones before creating
-- login accounts via create-student-auth-accounts.mjs.
-- INSERT INTO student_emails (student_id, student_name, class, email) VALUES
-- (173, 'Daksh Julka',    9,  'REPLACE_ME@example.com'),
-- (174, 'Shaurya Sharma', 10, 'REPLACE_ME@example.com');

-- ── 3. Backfill student_id on the 14 "Tarun" feedback rows ────────────────
-- Same person as "Tarun Pal" (id 82) already in student_emails, just
-- recorded under his first name only in the feedback sheet.
UPDATE worksheet_feedback
SET student_id = 82
WHERE student_id IS NULL
  AND student_name = 'Tarun'
  AND class = 10;

-- ── 4. Backfill the single "Meher Judge" Class-9 row ──────────────────────
-- She's Class 10 (id 89) on the roster; this one row is almost certainly a
-- typo in the source sheet. Links it to her without changing the recorded
-- `class` value (leaves the submission's own class as originally entered —
-- flip the `class = 9` below to `class = 10` too if you'd rather it match
-- her roster class).
UPDATE worksheet_feedback
SET student_id = 89
WHERE student_id IS NULL
  AND student_name = 'Meher Judge'
  AND class = 9;

-- ── 5. Verify remaining unmatched rows ─────────────────────────────────────
SELECT student_name, class, count(*) AS rows
FROM worksheet_feedback
WHERE student_id IS NULL
GROUP BY student_name, class
ORDER BY rows DESC;
-- Expect only: (9, 'Daksh Julka', 12), (9, 'Aliya Guglani', 1),
-- (10, 'Shaurya Sharma', 1) until you confirm the TODOs above.
