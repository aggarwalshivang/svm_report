-- Cleans up historical duplicate rows in student_scores that accumulated
-- across several import/correction passes because the rows didn't share
-- an exactly-matching (student_id, class, subject, topic_name, date) key
-- with the unique index student_scores_one_per_student_test_date -- so the
-- upsert's ON CONFLICT never caught them and they piled up as separate rows.
--
-- Three distinct causes, confirmed by cross-checking against the master
-- sheet and matching each stale row to its corrected replacement:
--
-- 1. Orphaned null-student_id duplicates: a name-matching mismatch during
--    import left a row unlinked (student_id null) while a properly-linked
--    copy of the exact same test result exists elsewhere. Safe to delete
--    the orphan when every other field (name/date/subject/topic/marks/
--    score/absent) matches a linked row exactly.
--
-- 2. Class 10 subject spelling drift ("Math" vs "Maths"): one import wave
--    wrote "Math", a later correction wave wrote "Maths" for the same
--    student/date/topic. Delete "Math" rows that have a newer "Maths"
--    counterpart; for the remainder (no "Maths" counterpart exists at all)
--    just relabel subject to "Maths" instead of deleting -- it's their only
--    record of that test.
--
-- 3. Class 9 date entry bug: a 2026-08-10 bulk pass inserted "The World of
--    Numbers" (Maths) and "Describing Motion Around  Us" (Science, note
--    double space) dated 2026-07-08, when marks/score match confirms these
--    were actually the 2026-08-07 tests (day/month mixed up). Delete the
--    2026-07-08 rows that have a newer, correctly-dated counterpart; for
--    the few with no counterpart, correct the date instead of deleting.
--
-- Run via: npx supabase db query --linked -f scripts/fix-student-scores-duplicates.sql

begin;

-- 1. Orphaned null-student_id duplicates
delete from student_scores p
where p.student_id is null
  and exists (
    select 1 from student_scores g
    where g.class = p.class
      and g.student_id is not null
      and regexp_replace(lower(trim(g.student_name)), '\s+', ' ', 'g')
        = regexp_replace(lower(trim(p.student_name)), '\s+', ' ', 'g')
      and g.date = p.date
      and (case when lower(trim(g.subject)) = 'math' then 'maths' else lower(trim(g.subject)) end)
        = (case when lower(trim(p.subject)) = 'math' then 'maths' else lower(trim(p.subject)) end)
      and regexp_replace(lower(trim(g.topic_name)), '\s+', ' ', 'g')
        = regexp_replace(lower(trim(p.topic_name)), '\s+', ' ', 'g')
      and g.total_marks = p.total_marks
      and coalesce(g.score_obtained, -1) = coalesce(p.score_obtained, -1)
      and g.is_absent = p.is_absent
  );

-- 2a. Class 10 "Math" rows superseded by a newer "Maths" row
delete from student_scores m
where m.class = 10 and m.subject = 'Math'
  and exists (
    select 1 from student_scores mm
    where mm.class = m.class and mm.student_id = m.student_id
      and mm.subject = 'Maths' and mm.topic_name = m.topic_name and mm.date = m.date
      and mm.created_at > m.created_at
  );

-- 2b. Remaining class 10 "Math" rows (no "Maths" counterpart) -- relabel
update student_scores
set subject = 'Maths'
where class = 10 and subject = 'Math';

-- 3a. Class 9 Jul 08 phantom rows superseded by a newer, correctly-dated row
delete from student_scores p
where p.class = 9 and p.date = '2026-07-08'
  and p.topic_name in ('The World of Numbers', 'Describing Motion Around  Us')
  and exists (
    select 1 from student_scores g
    where g.class = p.class
      and regexp_replace(lower(trim(g.student_name)), '\s+', ' ', 'g')
        = regexp_replace(lower(trim(p.student_name)), '\s+', ' ', 'g')
      and g.subject = p.subject
      and g.date <> p.date
      and regexp_replace(lower(trim(g.topic_name)), '\s+', ' ', 'g')
        = regexp_replace(lower(trim(p.topic_name)), '\s+', ' ', 'g')
      and g.created_at > p.created_at
  );

-- 3b. Remaining class 9 Jul 08 phantom rows (no counterpart) -- fix the date
update student_scores
set date = '2026-08-07'
where class = 9 and date = '2026-07-08'
  and topic_name in ('The World of Numbers', 'Describing Motion Around  Us');

commit;
