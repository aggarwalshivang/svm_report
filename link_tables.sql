-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/cexbpkbadthoqbruyjdg/sql/new

-- Step 1: Master students table
CREATE TABLE IF NOT EXISTS students (
    id           BIGSERIAL PRIMARY KEY,
    student_name TEXT    NOT NULL,
    class        INTEGER NOT NULL,
    UNIQUE(student_name, class)
);

-- Step 2: Populate from student_scores (authoritative source)
INSERT INTO students (student_name, class)
SELECT DISTINCT student_name, class
FROM student_scores
ORDER BY class, student_name
ON CONFLICT DO NOTHING;

-- Step 3: Also insert any email-only students not in student_scores
INSERT INTO students (student_name, class)
SELECT DISTINCT se.student_name, se.class
FROM student_emails se
WHERE se.class IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM students s
      WHERE s.student_name = se.student_name AND s.class = se.class
  )
ON CONFLICT DO NOTHING;

-- Step 4: Add student_id FK to student_scores
ALTER TABLE student_scores
ADD COLUMN IF NOT EXISTS student_id BIGINT REFERENCES students(id);

-- Step 5: Wire up student_scores → students
UPDATE student_scores ss
SET student_id = s.id
FROM students s
WHERE ss.student_name = s.student_name
  AND ss.class        = s.class;

-- Step 6: Add student_id FK to student_emails
ALTER TABLE student_emails
ADD COLUMN IF NOT EXISTS student_id BIGINT REFERENCES students(id);

-- Step 7: Wire up student_emails → students
UPDATE student_emails se
SET student_id = s.id
FROM students s
WHERE se.student_name = s.student_name
  AND se.class        = s.class;

-- Step 8: Indexes for fast joins
CREATE INDEX IF NOT EXISTS idx_student_scores_student_id ON student_scores(student_id);
CREATE INDEX IF NOT EXISTS idx_student_emails_student_id ON student_emails(student_id);

-- Verify
SELECT
    s.id,
    s.student_name,
    s.class,
    COUNT(DISTINCT se.email)          AS email_count,
    COUNT(DISTINCT sc.id)             AS test_count
FROM students s
LEFT JOIN student_emails se ON se.student_id = s.id
LEFT JOIN student_scores sc ON sc.student_id = s.id
GROUP BY s.id, s.student_name, s.class
ORDER BY s.class, s.student_name
LIMIT 20;
