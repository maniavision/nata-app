-- Staff dashboard on the website (nata-website /dashboard).
--
-- public.dashboard_stats() returns platform totals as one JSON object:
--   * users: total, verified, pending, unverified/rejected, new this month
--   * users per country of residence (with how many are verified)
--   * trips: total and per status
--   * transactions per year and per month (last 24 months): count and volume
--
-- Only staff (nata.admins) can call it: anyone else gets 'nata:not_admin'.
-- It returns counts and sums only, never a single user's data.
--
-- A transaction is a payment that went through: status 'held' (in escrow) or
-- 'released' (paid out), not marked for refund. Volumes are in US dollars,
-- converted with nata.exchange_rates (per_usd = units of the currency per
-- dollar); a currency with no rate is left out of the dollar total but still
-- counted.
--
-- Deleted accounts (profiles.deleted_at set) are not counted as users.
--
-- Safe to re-run.

create or replace function public.dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform nata.require_admin();

  with members as (
    select p.verification_status, p.country_of_residence, p.created_at
      from nata.profiles p
     where p.deleted_at is null
  ),
  tx as (
    select coalesce(pay.completed_at, pay.created_at) as at,
           pay.amount / nullif(r.per_usd, 0) as amount_usd
      from nata.payments pay
      left join nata.exchange_rates r on r.currency = pay.currency
     where pay.status in ('held', 'released')
       and not pay.needs_refund
  )
  select jsonb_build_object(
    'generated_at', now(),
    'users', (
      select jsonb_build_object(
        'total',          count(*),
        'verified',       count(*) filter (where verification_status = 'verified'),
        'pending',        count(*) filter (where verification_status = 'pending'),
        'not_verified',   count(*) filter (where verification_status is distinct from 'verified'
                                             and verification_status is distinct from 'pending'),
        'new_this_month', count(*) filter (where created_at >= date_trunc('month', now()))
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
        'live',      count(*) filter (where t.status = 'live'),
        'completed', count(*) filter (where t.status = 'completed'),
        'cancelled', count(*) filter (where t.status = 'cancelled')
      )
      from nata.trips t
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
            from tx
           group by 1
        ) y
    ), '[]'::jsonb),
    -- Every one of the last 24 months, including months with nothing.
    'transactions_by_month', (
      select jsonb_agg(
               jsonb_build_object(
                 'month',      to_char(m.month, 'YYYY-MM'),
                 'count',      coalesce(agg.count, 0),
                 'volume_usd', coalesce(agg.volume_usd, 0)
               ) order by m.month)
        from generate_series(date_trunc('month', now()) - interval '23 months',
                             date_trunc('month', now()),
                             interval '1 month') as m(month)
        left join (
          select date_trunc('month', at) as month,
                 count(*) as count,
                 round(coalesce(sum(amount_usd), 0), 2) as volume_usd
            from tx
           group by 1
        ) agg on agg.month = m.month
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;
