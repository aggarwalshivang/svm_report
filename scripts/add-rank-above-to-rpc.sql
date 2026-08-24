-- Run this once in the Supabase Dashboard -> SQL Editor.
--
-- Extends get_my_class_rank() (see create-class-rank-rpc.sql,
-- add-rank-trend-to-rpc.sql) to also report the 2-3 students ranked just
-- above the caller, so StudentDashboard.jsx can show a small "who's ahead of
-- you" panel beside the Class Rank card.
--
-- Stays anonymized on purpose: only rank position + percentage are returned
-- for those classmates, never their student_id or name. The RPC still runs
-- security definer so it can see the whole class despite the caller's
-- RLS-restricted view (fix-student-data-select-rls.sql), and still never
-- leaks other students' identities (see create-class-rank-rpc.sql's comment).

drop function if exists public.get_my_class_rank();

create or replace function public.get_my_class_rank()
returns table(rank integer, class_size integer, prev_rank integer, trend text, above jsonb)
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
  ),
  my_rank as (
    select rnk from ranked where student_id = me
  ),
  above as (
    -- The (up to) 3 students immediately above the caller, anonymized to
    -- just their rank position + percentage.
    select r.rnk, round(r.avg_pct::numeric, 1) as pct
    from ranked r, my_rank mr
    where r.rnk < mr.rnk
    order by r.rnk desc
    limit 3
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
    end,
    (select jsonb_agg(jsonb_build_object('rank', ab.rnk, 'pct', ab.pct) order by ab.rnk asc) from above ab)
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
