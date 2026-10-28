-- Staff dashboard: filter by year and month.
--
-- Replaces public.dashboard_stats() (20240190) with
-- public.dashboard_stats(p_year int default null, p_month int default null).
-- Called with no arguments it covers all time, as before.
--
-- The chosen period (calendar year, or one month of it, in UTC) applies to:
--   * users: members who joined in the period (total, verified, pending, not verified)
--   * users_by_country: those same members
--   * trips: trips posted in the period
--   * transactions: payments made in the period
--   * transactions_series: one point per month of the year, or per day of the
--     month; with no period, the last 24 months
-- transactions_by_year always lists every year so years can be compared, and
-- users_all_time / years_available give the context the filters need.
--
-- Same rules as 20240190: staff only (nata.admins), counts and sums only,
-- deleted accounts left out, a transaction is a payment held or released and
-- not marked for refund, volumes in US dollars via nata.exchange_rates.
--
-- Safe to re-run.

drop function if exists public.dashboard_stats();

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
           pay.amount / nullif(r.per_usd, 0) as amount_usd
      from nata.payments pay
      left join nata.exchange_rates r on r.currency = pay.currency
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
        'total',      count(*),
        'volume_usd', round(coalesce(sum(amount_usd), 0), 2)
      )
      from tx
    ),
    'transactions_by_year', coalesce((
      select jsonb_agg(y order by y.year)
        from (
          select extract(year from at)::int as year,
                 count(*) as count,
                 round(coalesce(sum(amount_usd), 0), 2) as volume_usd
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
                   'count',      coalesce(agg.count, 0),
                   'volume_usd', coalesce(agg.volume_usd, 0)
                 ) order by s.bucket)
          from generate_series(v_series_from, v_series_to,
                               case v_unit when 'day' then interval '1 day' else interval '1 month' end) as s(bucket)
          left join (
            select date_trunc(v_unit, at, 'UTC') as bucket,
                   count(*) as count,
                   round(coalesce(sum(amount_usd), 0), 2) as volume_usd
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
