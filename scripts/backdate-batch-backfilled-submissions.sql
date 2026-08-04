-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Companion to backfill-zero-submission-assignments.sql, for the case where
-- you're not sure whether you ran the `now()` version or the later
-- `a.deadline` (backdated) version of that script.
--
-- Detection: a single INSERT ... SELECT statement evaluates now() exactly
-- once and stamps every inserted row with that identical value, no matter
-- how many different assignments it touched. So if the `now()` version ran,
-- there's one timestamp shared by rows across MULTIPLE different
-- assignments -- something that would essentially never happen by chance
-- with real, individually-submitted student work. That's the batch's
-- fingerprint. If the backdated version ran instead, no such shared
-- cross-assignment timestamp exists (each assignment has its own distinct
-- deadline), so this script is a safe no-op.
--
-- Fix: for exactly the rows matching that fingerprint, set submitted_at back
-- to their own assignment's deadline -- same end state the backdated version
-- of the backfill would have produced directly.

with batch as (
  select submitted_at
  from public.assignment_submissions
  group by submitted_at
  having count(distinct assignment_id) > 1
  order by count(*) desc
  limit 1
)
update public.assignment_submissions s
set submitted_at = a.deadline
from public.assignments a, batch b
where s.assignment_id = a.id
  and s.submitted_at = b.submitted_at
  and s.submitted_at <> a.deadline;

-- Sanity check: for each worksheet, how many of its submissions still don't
-- match its own deadline (should be 0, or only genuine late/early real
-- submissions that predate this whole backfill effort).
select a.id, a.title, a.deadline,
  count(*) filter (where s.submitted_at <> a.deadline) as not_matching_deadline,
  count(*) as total_submissions
from public.assignments a
join public.assignment_submissions s on s.assignment_id = a.id
group by a.id, a.title, a.deadline
order by not_matching_deadline desc, a.title;
