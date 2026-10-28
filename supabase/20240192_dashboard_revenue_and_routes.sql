-- Staff dashboard: revenue, and the top route alerts.
--
-- Run AFTER 20240191_dashboard_period_filter.sql. Safe to re-run.
--
-- 1. public.dashboard_stats(p_year, p_month) also returns Nata's revenue:
--    the service fee kept on each transaction (payments.service_fee; the
--    traveler is paid amount - service_fee), in US dollars like the volumes.
--      * transactions.revenue_usd for the period
--      * revenue_usd on every transactions_series point and on every year
--      * revenue_by_country: per country of residence of the sender (who
--        paid), for the period, highest first
--    Same signature and rules as 20240191 (staff only, totals only).
--    US dollars count at 1: nata.exchange_rates holds no USD row (it is the
--    base), which left every USD payment out of the dollar totals before.
--
-- 2. public.top_route_alerts(p_limit default 10): the routes the most members
--    asked to be alerted about, with city and country names, how many
--    members follow each, and how many live trips on it leave today or later.
--    Staff only; counts only, never who saved an alert.

-- -----------------------------------------------------------------------------
-- 1. Revenue in the dashboard figures
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_stats(p_year int default null, p_month int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from         timestamptz;  -- start of the period, null for all time
  v_to           timestamptz;  -- end of the period (exclusive)
  v_unit         text;         -- 'day' or 'month': one chart point per unit
  v_series_from  timestamptz;
  v_series_to    timestamptz;
  result         jsonb;
begin
  perform nata.require_admin();

  if p_month is not null and (p_year is null or p_month not between 1 and 12) then
    raise exception 'nata:bad_period';
  end if;
  if p_year is not null and p_year not between 2000 and 2100 then
    raise exception 'nata:bad_period';
  end if;

  if p_year is not null then
    v_from := make_timestamptz(p_year, coalesce(p_month, 1), 1, 0, 0, 0, 'UTC');
    v_to   := v_from + case when p_month is null then interval '1 year' else interval '1 month' end;
  end if;

  if p_month is not null then
    v_unit := 'day';
    v_series_from := v_from;
    v_series_to   := v_to - interval '1 day';
  elsif p_year is not null then
    v_unit := 'month';
    v_series_from := v_from;
    v_series_to   := v_to - interval '1 month';
  else
    v_unit := 'month';
    v_series_from := date_trunc('month', now(), 'UTC') - interval '23 months';
    v_series_to   := date_trunc('month', now(), 'UTC');
  end if;

  with all_members as (
    select p.verification_status, p.country_of_residence, p.created_at
      from nata.profiles p
     where p.deleted_at is null
  ),
  members as (
    select * from all_members m
     where (v_from is null or m.created_at >= v_from)
       and (v_to is null or m.created_at < v_to)
  ),
  all_tx as (
    select coalesce(pay.completed_at, pay.created_at) as at,
           pay.amount / nullif(coalesce(r.per_usd, case when pay.currency = 'USD' then 1 end), 0) as amount_usd,
           coalesce(pay.service_fee, 0) / nullif(coalesce(r.per_usd, case when pay.currency = 'USD' then 1 end), 0) as fee_usd,
           sp.country_of_residence as sender_country
      from nata.payments pay
      left join nata.exchange_rates r on r.currency = pay.currency
      left join nata.profiles sp on sp.id = pay.sender_id
     where pay.status in ('held', 'released')
       and not pay.needs_refund
  ),
  tx as (
    select * from all_tx t
     where (v_from is null or t.at >= v_from)
       and (v_to is null or t.at < v_to)
  ),
  period_trips as (
    select t.status from nata.trips t
     where (v_from is null or t.created_at >= v_from)
       and (v_to is null or t.created_at < v_to)
  )
  select jsonb_build_object(
    'generated_at', now(),
    'period', jsonb_build_object('year', p_year, 'month', p_month),
    'years_available', (
      select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb)
        from generate_series(
               least(
                 coalesce((select extract(year from min(created_at))::int from all_members), extract(year from now())::int),
                 coalesce((select extract(year from min(at))::int from all_tx), extract(year from now())::int)
               ),
               extract(year from now())::int
             ) as y
    ),
    'users_all_time', (select count(*) from all_members),
    'users', (
      select jsonb_build_object(
        'total',          count(*),
        'verified',       count(*) filter (where verification_status = 'verified'),
        'pending',        count(*) filter (where verification_status = 'pending'),
        'not_verified',   count(*) filter (where verification_status is distinct from 'verified'
                                             and verification_status is distinct from 'pending'),
        'new_this_month', (select count(*) from all_members a
                            where a.created_at >= date_trunc('month', now(), 'UTC'))
      )
      from members
    ),
    'users_by_country', coalesce((
      select jsonb_agg(c order by c.total desc, c.country)
        from (
          select coalesce(m.country_of_residence, '??') as country,
                 count(*) as total,
                 count(*) filter (where m.verification_status = 'verified') as verified
            from members m
           group by 1
        ) c
    ), '[]'::jsonb),
    'trips', (
      select jsonb_build_object(
        'total',     count(*),
        'live',      count(*) filter (where status = 'live'),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled')
      )
      from period_trips
    ),
    'transactions', (
      select jsonb_build_object(
        'total',       count(*),
        'volume_usd',  round(coalesce(sum(amount_usd), 0), 2),
        'revenue_usd', round(coalesce(sum(fee_usd), 0), 2)
      )
      from tx
    ),
    'revenue_by_country', coalesce((
      select jsonb_agg(c order by c.revenue_usd desc, c.country)
        from (
          select coalesce(sender_country, '??') as country,
                 count(*) as count,
                 round(coalesce(sum(fee_usd), 0), 2) as revenue_usd
            from tx
           group by 1
        ) c
    ), '[]'::jsonb),
    'transactions_by_year', coalesce((
      select jsonb_agg(y order by y.year)
        from (
          select extract(year from at)::int as year,
                 count(*) as count,
                 round(coalesce(sum(amount_usd), 0), 2) as volume_usd,
                 round(coalesce(sum(fee_usd), 0), 2) as revenue_usd
            from all_tx
           group by 1
        ) y
    ), '[]'::jsonb),
    -- Every day or month of the range, including those with nothing.
    'transactions_series', jsonb_build_object(
      'unit', v_unit,
      'points', (
        select jsonb_agg(
                 jsonb_build_object(
                   'date',       to_char(s.bucket, case v_unit when 'day' then 'YYYY-MM-DD' else 'YYYY-MM' end),
                   'count',       coalesce(agg.count, 0),
                   'volume_usd',  coalesce(agg.volume_usd, 0),
                   'revenue_usd', coalesce(agg.revenue_usd, 0)
                 ) order by s.bucket)
          from generate_series(v_series_from, v_series_to,
                               case v_unit when 'day' then interval '1 day' else interval '1 month' end) as s(bucket)
          left join (
            select date_trunc(v_unit, at, 'UTC') as bucket,
                   count(*) as count,
                   round(coalesce(sum(amount_usd), 0), 2) as volume_usd,
                   round(coalesce(sum(fee_usd), 0), 2) as revenue_usd
              from all_tx
             where at >= v_series_from
               and at < v_series_to + case v_unit when 'day' then interval '1 day' else interval '1 month' end
             group by 1
          ) agg on agg.bucket = s.bucket
      )
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.dashboard_stats(int, int) from public, anon;
grant execute on function public.dashboard_stats(int, int) to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Top route alerts
-- -----------------------------------------------------------------------------
create or replace function public.top_route_alerts(p_limit int default 10)
returns table (
  from_city     text,
  from_country  char(2),
  to_city       text,
  to_country    char(2),
  members       bigint,
  live_trips    bigint,
  first_saved   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform nata.require_admin();
  return query
    select fc.name, fc.country_code, tc.name, tc.country_code,
           count(*) as members,
           (select count(*) from nata.trips t
             where t.departure_city_id = a.from_city_id
               and t.arrival_city_id = a.to_city_id
               and t.status = 'live'
               and t.departure_date >= current_date) as live_trips,
           min(a.created_at) as first_saved
      from nata.route_alerts a
      join nata.cities fc on fc.id = a.from_city_id
      join nata.cities tc on tc.id = a.to_city_id
     group by a.from_city_id, a.to_city_id, fc.name, fc.country_code, tc.name, tc.country_code
     order by members desc, first_saved asc
     limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

revoke all on function public.top_route_alerts(int) from public, anon;
grant execute on function public.top_route_alerts(int) to authenticated;
