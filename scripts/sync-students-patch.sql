-- ============================================================
-- SVM Roster Patch  (run in Supabase SQL Editor)
-- ============================================================

-- Remove 4 students not in the master roster
DELETE FROM student_emails WHERE student_id IN (123, 124, 148, 163);
-- 123 = Aliya Guglani
-- 124 = Virat Anand
-- 148 = Aaradhya  (was a roster label "Aaradhya Class 8", not a real student)
-- 163 = Vedansh Bajaj  (not in current roster)

-- Fix name spelling: "Partap" → "Pratap"
UPDATE student_emails
SET student_name = 'Fateh Pratap Singh'
WHERE student_id = 154;

-- Add 2 students whose emails were pending
INSERT INTO student_emails (student_id, student_name, class, email) VALUES
(166, 'Naisha',         10, 'niralafighter15may@gmail.com'),
(167, 'Lavitra Dhawan',  9, 'nehalavitra@gmail.com');

-- Verify
SELECT class, COUNT(DISTINCT student_id) AS students
FROM student_emails
GROUP BY class
ORDER BY class;
