-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Extends get_my_class_rank() (see create-class-rank-rpc.sql) to also report
-- whether the student's rank is stable, improving, or declining, so
-- StudentDashboard.jsx can show a trend indicator next to "Class Rank" — the
-- same stable/improving/declining signal TeacherDashboard.jsx's "Rank Trend"
-- column now shows.
--
-- There's no stored rank history, so "previous rank" is approximated by
-- dropping each student's single most-recent counted test and re-ranking the
-- class on what's left. A student needs at least 2 counted tests for this to
-- mean anything; below that, prev_rank/trend come back null.

drop function if exists public.get_my_class_rank();

create or replace function public.get_my_class_rank()
returns table(rank integer, class_size integer, prev_rank integer, trend text)
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
  scored as (
    select c.student_id, s.score_obtained, s.total_marks,
           row_number() over (
             partition by c.student_id
             order by s.date desc, s.id desc
           ) as rn
    from classmates c
    left join public.student_scores s
      on s.student_id = c.student_id
      and coalesce(s.is_absent, false) = false
      and (c.report_start_date is null or s.date >= c.report_start_date)
  ),
  averages as (
    -- Weighted by marks (sum scored / sum possible), matching the formula
    -- used by StudentDashboard.jsx/TeacherDashboard.jsx's avgPct. prev_avg_pct
    -- drops each student's single most-recent test (rn = 1).
    select student_id,
           coalesce((sum(score_obtained)::numeric / nullif(sum(total_marks), 0)) * 100, 0) as avg_pct,
           (sum(score_obtained) filter (where rn > 1)::numeric
             / nullif(sum(total_marks) filter (where rn > 1), 0)) * 100 as prev_avg_pct,
           count(*) filter (where score_obtained is not null) as n_tests
    from scored
    group by student_id
  ),
  ranked as (
    select student_id, avg_pct,
           row_number() over (order by avg_pct desc) as rnk,
           count(*) over () as cnt
    from averages
  ),
  prev_ranked as (
    -- Students with <2 tests fall back to their current avg so they still
    -- occupy a sensible slot in the "previous" ordering of everyone else.
    select student_id,
           row_number() over (order by coalesce(prev_avg_pct, avg_pct) desc) as prnk
    from averages
  )
  select
    r.rnk::integer,
    r.cnt::integer,
    case when a.n_tests >= 2 then pr.prnk::integer else null end,
    case
      when a.n_tests < 2 then null
      when pr.prnk > r.rnk then 'improving'
      when pr.prnk < r.rnk then 'declining'
      else 'stable'
    end
  from ranked r
  join averages a on a.student_id = r.student_id
  join prev_ranked pr on pr.student_id = r.student_id
  where r.student_id = me;
end;
$$;

grant execute on function public.get_my_class_rank() to authenticated;

-- Sanity check (run as yourself while logged in via the app, or spot-check
-- counts manually):
-- select * from public.get_my_class_rank();
