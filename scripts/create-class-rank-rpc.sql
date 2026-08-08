-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- BUG: StudentDashboard's "Class Rank" widget always shows "#1 out of 1".
-- computeRank() (src/pages/StudentDashboard.jsx) fetches all classmates from
-- student_emails and all scores from student_scores directly from the
-- browser, then ranks client-side. That worked until
-- fix-student-data-select-rls.sql locked SELECT on both tables down to
-- "teachers see everything, students see only their own row" (a real fix --
-- students could previously read the whole school's data from devtools).
-- Since then, a student's browser only ever gets its own row back from both
-- tables, so classSize and classRank collapse to 1 for every student, in
-- every class -- Class 9/10 are just the classes currently populated with
-- students (see sync-students.sql), so that's where it's visible.
--
-- Fix: compute the rank server-side in a security definer function, so it
-- can see the whole class regardless of the caller's RLS-restricted view,
-- while still only ever returning the caller's own rank + class size (never
-- other students' identities or scores).

create or replace function public.get_my_class_rank()
returns table(rank integer, class_size integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  me bigint := (auth.jwt() -> 'app_metadata' ->> 'student_id')::bigint;
  my_class integer;
begin
  if me is null then
    return;
  end if;

  select se.class into my_class from public.student_emails se where se.student_id = me limit 1;
  if my_class is null then
    return;
  end if;

  return query
  with classmates as (
    select se.student_id, se.report_start_date
    from public.student_emails se
    where se.class = my_class
  ),
  averages as (
    select c.student_id,
           coalesce(avg((s.score_obtained::numeric / nullif(s.total_marks, 0)) * 100), 0) as avg_pct
    from classmates c
    left join public.student_scores s
      on s.student_id = c.student_id
      and coalesce(s.is_absent, false) = false
      and (c.report_start_date is null or s.date >= c.report_start_date)
    group by c.student_id
  ),
  ranked as (
    select student_id, avg_pct,
           row_number() over (order by avg_pct desc) as rnk,
           count(*) over () as cnt
    from averages
  )
  select rnk::integer, cnt::integer
  from ranked
  where student_id = me;
end;
$$;

grant execute on function public.get_my_class_rank() to authenticated;

-- Sanity check (run as yourself while logged in via the app, or spot-check
-- counts manually):
-- select * from public.get_my_class_rank();
