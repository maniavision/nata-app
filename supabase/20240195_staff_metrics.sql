-- Staff dashboard: business health, funnel, supply & demand, payments,
-- trust & safety, growth & retention.
--
-- Run AFTER 20240194_staff_phone_check.sql. Safe to re-run.
--
-- 1. Exchange rates by day. nata.exchange_rates only holds today's rate, so
--    nata.exchange_rate_history keeps one rate per currency per day (filled by
--    a trigger whenever a rate is saved, and seeded with today's).
--    nata.to_usd(amount, currency, at) converts with the rate of that day, or
--    the nearest known one (the latest before it, else the earliest after it).
--    USD (and a missing currency, which only old USD-priced requests have)
--    count at 1.
--
-- 2. public.dashboard_stats(p_year, p_month) is rebuilt on those daily rates,
--    with revenue defined as Nata keeps it:
--      * GMV ("volume"): what senders paid, for payments that went through
--        (held, released or later refunded; not a duplicate awaiting refund),
--        using the USD price fixed at acceptance (payments.base_amount) when
--        there is one.
--      * Revenue: the platform fee on delivered requests (at delivery) plus
--        cancellation fees kept on cancelled requests (at cancellation).
--    Revenue per country is by the sender's country of residence.
--
-- 3. public.staff_metrics(p_year, p_month): the rest of the dashboard as one
--    JSON object. Current-state figures (escrow, payouts owed, open reports,
--    waiting checks, locked deliveries, unmatched alerts, active people) ignore
--    the period; flows (funnel, payment attempts, refunds, reports, reviews)
--    follow it; weekly series always cover the last 12 weeks.
--
-- Staff only (nata.admins); counts and sums, never a member's details.

-- -----------------------------------------------------------------------------
-- 1. Daily exchange rates
-- -----------------------------------------------------------------------------
create table if not exists nata.exchange_rate_history (
  currency   char(3)        not null,
  rate_date  date           not null,
  per_usd    numeric(18, 8) not null check (per_usd > 0),
  primary key (currency, rate_date)
);
alter table nata.exchange_rate_history enable row level security;
revoke all on nata.exchange_rate_history from public, anon, authenticated;

create or replace function nata.keep_exchange_rate_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into nata.exchange_rate_history (currency, rate_date, per_usd)
  values (new.currency, (coalesce(new.updated_at, now()) at time zone 'UTC')::date, new.per_usd)
  on conflict (currency, rate_date) do update set per_usd = excluded.per_usd;
  return new;
end;
$$;
revoke all on function nata.keep_exchange_rate_history() from public, anon, authenticated;

drop trigger if exists keep_exchange_rate_history on nata.exchange_rates;
create trigger keep_exchange_rate_history
  after insert or update of per_usd, updated_at on nata.exchange_rates
  for each row execute function nata.keep_exchange_rate_history();

insert into nata.exchange_rate_history (currency, rate_date, per_usd)
select currency, (updated_at at time zone 'UTC')::date, per_usd from nata.exchange_rates
on conflict (currency, rate_date) do nothing;

create or replace function nata.to_usd(p_amount numeric, p_currency text, p_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_amount is null then null
    when p_currency is null or upper(p_currency) = 'USD' then p_amount
    else p_amount / nullif(coalesce(
      (select h.per_usd from nata.exchange_rate_history h
        where h.currency = upper(p_currency) and h.rate_date <= (p_at at time zone 'UTC')::date
        order by h.rate_date desc limit 1),
      (select h.per_usd from nata.exchange_rate_history h
        where h.currency = upper(p_currency)
        order by h.rate_date asc limit 1),
      (select r.per_usd from nata.exchange_rates r where r.currency = upper(p_currency))
    ), 0)
  end;
$$;
revoke all on function nata.to_usd(numeric, text, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. dashboard_stats on daily rates, with Nata's revenue
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_stats(p_year int default null, p_month int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from         timestamptz;
  v_to           timestamptz;
  v_unit         text;
  v_series_from  timestamptz;
  v_series_to    timestamptz;
  v_step         interval;
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
    v_unit := 'day';   v_series_from := v_from; v_series_to := v_to - interval '1 day';
  elsif p_year is not null then
    v_unit := 'month'; v_series_from := v_from; v_series_to := v_to - interval '1 month';
  else
    v_unit := 'month';
    v_series_from := date_trunc('month', now(), 'UTC') - interval '23 months';
    v_series_to   := date_trunc('month', now(), 'UTC');
  end if;
  v_step := case v_unit when 'day' then interval '1 day' else interval '1 month' end;

  with all_members as (
    select p.verification_status, p.country_of_residence, p.created_at
      from nata.profiles p
     where p.deleted_at is null
  ),
  members as (
    select * from all_members m
     where (v_from is null or m.created_at >= v_from) and (v_to is null or m.created_at < v_to)
  ),
  -- GMV: payments that went through, at the day they completed.
  all_tx as (
    select coalesce(pay.completed_at, pay.created_at) as at,
           case when pay.base_amount is not null
                then nata.to_usd(pay.base_amount, pay.base_currency, coalesce(pay.completed_at, pay.created_at))
                else nata.to_usd(pay.amount, pay.currency, coalesce(pay.completed_at, pay.created_at)) end as amount_usd
      from nata.payments pay
     where pay.status in ('held', 'released', 'refunded') and not pay.needs_refund
  ),
  tx as (
    select * from all_tx t where (v_from is null or t.at >= v_from) and (v_to is null or t.at < v_to)
  ),
  -- Revenue: platform fee when delivered, cancellation fee kept when cancelled.
  all_rev as (
    select coalesce(r.delivered_at, r.updated_at) as at,
           nata.to_usd(r.platform_fee, r.currency, coalesce(r.delivered_at, r.updated_at)) as usd,
           sp.country_of_residence as sender_country
      from nata.delivery_requests r
      left join nata.profiles sp on sp.id = r.sender_id
     where r.status = 'delivered' and coalesce(r.platform_fee, 0) > 0
    union all
    select coalesce(r.cancelled_at, r.updated_at),
           nata.to_usd(r.cancellation_fee, r.currency, coalesce(r.cancelled_at, r.updated_at)),
           sp.country_of_residence
      from nata.delivery_requests r
      left join nata.profiles sp on sp.id = r.sender_id
     where r.status = 'cancelled' and coalesce(r.cancellation_fee, 0) > 0
  ),
  rev as (
    select * from all_rev v where (v_from is null or v.at >= v_from) and (v_to is null or v.at < v_to)
  ),
  period_trips as (
    select t.status from nata.trips t
     where (v_from is null or t.created_at >= v_from) and (v_to is null or t.created_at < v_to)
  )
  select jsonb_build_object(
    'generated_at', now(),
    'period', jsonb_build_object('year', p_year, 'month', p_month),
    'years_available', (
      select coalesce(jsonb_agg(y order by y desc), '[]'::jsonb)
        from generate_series(
               least(coalesce((select extract(year from min(created_at))::int from all_members), extract(year from now())::int),
                     coalesce((select extract(year from min(at))::int from all_tx), extract(year from now())::int)),
               extract(year from now())::int) as y
    ),
    'users_all_time', (select count(*) from all_members),
    'users', (
      select jsonb_build_object(
        'total',          count(*),
        'verified',       count(*) filter (where verification_status = 'verified'),
        'pending',        count(*) filter (where verification_status = 'pending'),
        'not_verified',   count(*) filter (where verification_status is distinct from 'verified'
                                             and verification_status is distinct from 'pending'),
        'new_this_month', (select count(*) from all_members a where a.created_at >= date_trunc('month', now(), 'UTC'))
      )
      from members
    ),
    'users_by_country', coalesce((
      select jsonb_agg(c order by c.total desc, c.country)
        from (select coalesce(m.country_of_residence, '??') as country, count(*) as total,
                     count(*) filter (where m.verification_status = 'verified') as verified
                from members m group by 1) c
    ), '[]'::jsonb),
    'trips', (
      select jsonb_build_object(
        'total', count(*),
        'live', count(*) filter (where status = 'live'),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'))
      from period_trips
    ),
    'transactions', jsonb_build_object(
      'total',       (select count(*) from tx),
      'volume_usd',  (select round(coalesce(sum(amount_usd), 0), 2) from tx),
      'revenue_usd', (select round(coalesce(sum(usd), 0), 2) from rev)
    ),
    'revenue_by_country', coalesce((
      select jsonb_agg(c order by c.revenue_usd desc, c.country)
        from (select coalesce(sender_country, '??') as country, count(*) as count,
                     round(coalesce(sum(usd), 0), 2) as revenue_usd
                from rev group by 1) c
    ), '[]'::jsonb),
    'transactions_by_year', coalesce((
      select jsonb_agg(y order by y.year)
        from (select yr as year,
                     coalesce((select count(*) from all_tx t where extract(year from t.at)::int = yr), 0) as count,
                     coalesce((select round(sum(amount_usd), 2) from all_tx t where extract(year from t.at)::int = yr), 0) as volume_usd,
                     coalesce((select round(sum(usd), 2) from all_rev v where extract(year from v.at)::int = yr), 0) as revenue_usd
                from (select distinct extract(year from at)::int as yr from all_tx
                      union select distinct extract(year from at)::int from all_rev) ys) y
    ), '[]'::jsonb),
    'transactions_series', jsonb_build_object(
      'unit', v_unit,
      'points', (
        select jsonb_agg(
                 jsonb_build_object(
                   'date',        to_char(s.bucket, case v_unit when 'day' then 'YYYY-MM-DD' else 'YYYY-MM' end),
                   'count',       coalesce((select count(*) from all_tx t
                                             where t.at >= s.bucket and t.at < s.bucket + v_step), 0),
                   'volume_usd',  coalesce((select round(sum(amount_usd), 2) from all_tx t
                                             where t.at >= s.bucket and t.at < s.bucket + v_step), 0),
                   'revenue_usd', coalesce((select round(sum(usd), 2) from all_rev v
                                             where v.at >= s.bucket and v.at < s.bucket + v_step), 0)
                 ) order by s.bucket)
          from generate_series(v_series_from, v_series_to, v_step) as s(bucket)
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
-- 3. staff_metrics
-- -----------------------------------------------------------------------------
create or replace function public.staff_metrics(p_year int default null, p_month int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_week timestamptz := date_trunc('week', now(), 'UTC');
  result jsonb;
begin
  perform nata.require_admin();

  if p_month is not null and (p_year is null or p_month not between 1 and 12) then
    raise exception 'nata:bad_period';
  end if;
  if p_year is not null then
    if p_year not between 2000 and 2100 then raise exception 'nata:bad_period'; end if;
    v_from := make_timestamptz(p_year, coalesce(p_month, 1), 1, 0, 0, 0, 'UTC');
    v_to   := v_from + case when p_month is null then interval '1 year' else interval '1 month' end;
  end if;

  with
  ev as (
    select e.request_id, e.status, min(e.created_at) as at
      from nata.request_events e group by 1, 2
  ),
  -- One row per request with the time it reached each step.
  req as (
    select r.id, r.status, r.sender_id, r.trip_id, r.created_at,
           coalesce(r.price_fixed_at, a.at,
                    case when r.status in ('accepted', 'paid', 'handed_off', 'delivered') then r.responded_at end) as accepted_at,
           coalesce(r.paid_at, p.at) as paid_at,
           coalesce(r.picked_up_at, h.at) as picked_up_at,
           coalesce(r.delivered_at, d.at) as delivered_at,
           coalesce(r.cancelled_at, c.at) as cancelled_at,
           coalesce(x.at, r.expires_at) as expired_at,
           r.platform_fee, r.cancellation_fee, r.currency, r.delivery_code_attempts
      from nata.delivery_requests r
      left join ev a on a.request_id = r.id and a.status = 'accepted'
      left join ev p on p.request_id = r.id and p.status = 'paid'
      left join ev h on h.request_id = r.id and h.status = 'handed_off'
      left join ev d on d.request_id = r.id and d.status = 'delivered'
      left join ev c on c.request_id = r.id and c.status = 'cancelled'
      left join ev x on x.request_id = r.id and x.status = 'expired'
  ),
  req_p as (
    select * from req q where (v_from is null or q.created_at >= v_from) and (v_to is null or q.created_at < v_to)
  ),
  route as (
    select q.id as request_id, t.departure_city_id as from_id, t.arrival_city_id as to_id
      from req_p q join nata.trips t on t.id = q.trip_id
  ),
  live_trips as (
    select t.departure_city_id as from_id, t.arrival_city_id as to_id, count(*) as n
      from nata.trips t
     where t.status = 'live' and t.departure_date >= current_date
     group by 1, 2
  ),
  pay as (
    select pay.*, coalesce(pay.completed_at, pay.created_at) as at,
           pay.status in ('held', 'released', 'refunded') as ok
      from nata.payments pay
  ),
  pay_p as (
    select * from pay where (v_from is null or pay.created_at >= v_from) and (v_to is null or pay.created_at < v_to)
  ),
  owed as (
    select po.*, coalesce(po.payout_currency, po.currency) as cur,
           coalesce(po.payout_amount, po.amount) as cur_amount
      from nata.payouts po
     where po.status not in ('paid', 'cancelled')
  ),
  escrow as (
    select pay.* from pay
      join nata.delivery_requests r on r.id = pay.request_id
     where pay.status = 'held' and not pay.needs_refund and r.status in ('paid', 'handed_off')
  ),
  members as (
    select pr.id, pr.created_at, pr.verification_status from nata.profiles pr where pr.deleted_at is null
  ),
  delivered_by_sender as (
    select q.sender_id as who, q.delivered_at as at from req q where q.delivered_at is not null
  ),
  delivered_by_traveler as (
    select t.traveler_id as who, q.delivered_at as at
      from req q join nata.trips t on t.id = q.trip_id where q.delivered_at is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'period', jsonb_build_object('year', p_year, 'month', p_month),

    -- 1. Business health ------------------------------------------------------
    'health', jsonb_build_object(
      'deliveries_by_week', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(w, 'YYYY-MM-DD'),
                 'count', (select count(*) from req q where q.delivered_at >= w and q.delivered_at < w + interval '1 week'))
               order by w)
          from generate_series(v_week - interval '11 weeks', v_week, interval '1 week') as w
      ),
      'escrow_usd', (select round(coalesce(sum(
                       case when e.base_amount is not null then nata.to_usd(e.base_amount, e.base_currency, e.at)
                            else nata.to_usd(e.amount, e.currency, e.at) end), 0), 2) from escrow e),
      'escrow_count', (select count(*) from escrow),
      'owed_usd', (select round(coalesce(sum(nata.to_usd(o.amount, o.currency, o.created_at)), 0), 2) from owed o),
      'owed_count', (select count(*) from owed)
    ),

    -- 2. Funnel ----------------------------------------------------------------
    'funnel', (
      select jsonb_build_object(
        'requested',  count(*),
        'accepted',   count(*) filter (where accepted_at is not null),
        'paid',       count(*) filter (where paid_at is not null),
        'picked_up',  count(*) filter (where picked_up_at is not null),
        'delivered',  count(*) filter (where delivered_at is not null),
        'declined',   count(*) filter (where status = 'declined'),
        'expired_unanswered', count(*) filter (where status = 'expired' and accepted_at is null),
        'expired_unpaid',     count(*) filter (where status = 'expired' and accepted_at is not null and paid_at is null),
        'cancelled_before_payment', count(*) filter (where status = 'cancelled' and paid_at is null),
        'cancelled_after_payment',  count(*) filter (where status = 'cancelled' and paid_at is not null),
        'open', count(*) filter (where status in ('pending', 'accepted', 'paid', 'handed_off')),
        'median_hours', jsonb_build_object(
          'to_accept', round((percentile_cont(0.5) within group (order by extract(epoch from accepted_at - created_at) / 3600)
                              filter (where accepted_at is not null))::numeric, 1),
          'to_pay',    round((percentile_cont(0.5) within group (order by extract(epoch from paid_at - accepted_at) / 3600)
                              filter (where paid_at is not null and accepted_at is not null))::numeric, 1),
          'to_pickup', round((percentile_cont(0.5) within group (order by extract(epoch from picked_up_at - paid_at) / 3600)
                              filter (where picked_up_at is not null and paid_at is not null))::numeric, 1),
          'to_deliver', round((percentile_cont(0.5) within group (order by extract(epoch from delivered_at - picked_up_at) / 3600)
                              filter (where delivered_at is not null and picked_up_at is not null))::numeric, 1)
        )
      )
      from req_p
    ),

    -- 3. Supply and demand by route -------------------------------------------
    'routes', jsonb_build_object(
      'by_requests', coalesce((
        select jsonb_agg(x order by x.requests desc, x.from_city) from (
          select fc.name as from_city, fc.country_code as from_country, tc.name as to_city, tc.country_code as to_country,
                 count(*) as requests,
                 count(*) filter (where q.delivered_at is not null) as delivered,
                 coalesce(max(lt.n), 0) as live_trips
            from route rt
            join req_p q on q.id = rt.request_id
            join nata.cities fc on fc.id = rt.from_id
            join nata.cities tc on tc.id = rt.to_id
            left join live_trips lt on lt.from_id = rt.from_id and lt.to_id = rt.to_id
           group by rt.from_id, rt.to_id, fc.name, fc.country_code, tc.name, tc.country_code
           order by count(*) desc limit 10) x
      ), '[]'::jsonb),
      'by_trips', coalesce((
        select jsonb_agg(x order by x.trips desc, x.from_city) from (
          select fc.name as from_city, fc.country_code as from_country, tc.name as to_city, tc.country_code as to_country,
                 count(*) as trips,
                 (select count(*) from nata.delivery_requests r2 join nata.trips t2 on t2.id = r2.trip_id
                   where t2.departure_city_id = t.departure_city_id and t2.arrival_city_id = t.arrival_city_id
                     and (v_from is null or r2.created_at >= v_from) and (v_to is null or r2.created_at < v_to)) as requests
            from nata.trips t
            join nata.cities fc on fc.id = t.departure_city_id
            join nata.cities tc on tc.id = t.arrival_city_id
           where (v_from is null or t.created_at >= v_from) and (v_to is null or t.created_at < v_to)
           group by t.departure_city_id, t.arrival_city_id, fc.name, fc.country_code, tc.name, tc.country_code
           order by count(*) desc limit 10) x
      ), '[]'::jsonb),
      'alerts_total', (select count(*) from nata.route_alerts),
      'alerts_unmatched', (select count(*) from nata.route_alerts a
                            where not exists (select 1 from live_trips lt
                                               where lt.from_id = a.from_city_id and lt.to_id = a.to_city_id)),
      'active_travelers_30d', (select count(distinct t.traveler_id) from nata.trips t where t.created_at >= now() - interval '30 days'),
      'active_senders_30d', (select count(distinct r.sender_id) from nata.delivery_requests r where r.created_at >= now() - interval '30 days')
    ),

    -- 4. Payments and payouts ---------------------------------------------------
    'payments', jsonb_build_object(
      'by_method', coalesce((
        select jsonb_agg(x order by x.attempts desc) from (
          select method, provider, count(*) as attempts,
                 count(*) filter (where ok) as succeeded,
                 count(*) filter (where status = 'failed') as failed,
                 count(*) filter (where status = 'pending') as pending
            from pay_p group by method, provider) x
      ), '[]'::jsonb),
      'mobile_money', coalesce((
        select jsonb_agg(x order by x.attempts desc) from (
          select coalesce(country_code, '??') as country, coalesce(provider_payment_type, '?') as network, provider,
                 count(*) as attempts,
                 count(*) filter (where ok) as succeeded,
                 count(*) filter (where status = 'failed') as failed
            from pay_p where method = 'mobile_money' group by 1, 2, 3) x
      ), '[]'::jsonb),
      'payouts_open', coalesce((
        select jsonb_agg(x order by x.count desc) from (
          select o.status, count(*) as count,
                 round(coalesce(sum(nata.to_usd(o.amount, o.currency, o.created_at)), 0), 2) as amount_usd,
                 round(extract(epoch from now() - min(o.created_at)) / 3600)::int as oldest_hours,
                 count(*) filter (where o.created_at < now() - interval '24 hours') as older_than_day
            from owed o group by o.status) x
      ), '[]'::jsonb),
      'payout_failures', coalesce((
        select jsonb_agg(x order by x.count desc) from (
          select coalesce(o.failure_reason, '?') as reason, count(*) as count
            from owed o where o.failure_reason is not null group by 1) x
      ), '[]'::jsonb),
      'refunds', (
        select jsonb_build_object(
          'count',  count(*) filter (where refund_status = 'refunded' or status = 'refunded'),
          'amount_usd', round(coalesce(sum(nata.to_usd(coalesce(refund_amount, amount), currency, coalesce(refunded_at, updated_at)))
                                          filter (where refund_status = 'refunded' or status = 'refunded'), 0), 2),
          'failed', count(*) filter (where refund_status = 'failed'),
          'waiting', count(*) filter (where (needs_refund or refund_status in ('pending', 'sending')) and coalesce(refund_status, '') <> 'refunded'))
          from pay p2
         where (v_from is null or coalesce(p2.refunded_at, p2.updated_at) >= v_from)
           and (v_to is null or coalesce(p2.refunded_at, p2.updated_at) < v_to)
      ),
      'owed_by_currency', coalesce((
        select jsonb_agg(x order by x.currency) from (
          select cur as currency, round(sum(cur_amount), 2) as payouts_owed, count(*) as payouts
            from owed group by cur) x
      ), '[]'::jsonb),
      'escrow_by_currency', coalesce((
        select jsonb_agg(x order by x.currency) from (
          select e.currency, round(sum(e.amount), 2) as held, count(*) as payments
            from escrow e group by e.currency) x
      ), '[]'::jsonb)
    ),

    -- 5. Trust and safety --------------------------------------------------------
    'trust', jsonb_build_object(
      'deliveries', (select count(*) from req q where q.delivered_at is not null
                       and (v_from is null or q.delivered_at >= v_from) and (v_to is null or q.delivered_at < v_to)),
      'reports', (select count(*) from nata.disputes d
                   where (v_from is null or d.created_at >= v_from) and (v_to is null or d.created_at < v_to)),
      'reports_open', (select count(*) from nata.disputes d where d.resolved_at is null),
      'reports_oldest_open_hours', (select round(extract(epoch from now() - min(d.created_at)) / 3600)::int
                                      from nata.disputes d where d.resolved_at is null),
      'traveler_rating', (select round(avg(rv.rating)::numeric, 2) from nata.reviews rv
                           where rv.reviewee_role = 'traveler'
                             and (v_from is null or rv.created_at >= v_from) and (v_to is null or rv.created_at < v_to)),
      'traveler_reviews', (select count(*) from nata.reviews rv where rv.reviewee_role = 'traveler'
                             and (v_from is null or rv.created_at >= v_from) and (v_to is null or rv.created_at < v_to)),
      'delivered_reviewed', (select count(*) from req q
                              where q.delivered_at is not null
                                and (v_from is null or q.delivered_at >= v_from) and (v_to is null or q.delivered_at < v_to)
                                and exists (select 1 from nata.reviews rv where rv.request_id = q.id and rv.reviewee_role = 'traveler')),
      'identity', (
        select jsonb_build_object(
          'passed',   count(*) filter (where iv.status = 'verified'),
          'rejected', count(*) filter (where iv.status = 'rejected'),
          'waiting',  count(*) filter (where iv.status = 'pending'),
          'oldest_waiting_hours', round(extract(epoch from now() - min(iv.created_at) filter (where iv.status = 'pending')) / 3600)::int,
          'median_hours_to_decide', round((percentile_cont(0.5) within group (
              order by extract(epoch from coalesce(iv.verified_at, iv.reviewed_at) - iv.created_at) / 3600)
              filter (where coalesce(iv.verified_at, iv.reviewed_at) is not null))::numeric, 1))
          from nata.identity_verifications iv
      ),
      'locked_deliveries', (select count(*) from req q where coalesce(q.delivery_code_attempts, 0) >= 5 and q.delivered_at is null)
    ),

    -- 6. Growth and retention ----------------------------------------------------
    'growth', jsonb_build_object(
      'signups_by_week', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(w, 'YYYY-MM-DD'),
                 'count', (select count(*) from members m where m.created_at >= w and m.created_at < w + interval '1 week'),
                 'verified', (select count(*) from members m where m.created_at >= w and m.created_at < w + interval '1 week'
                                and m.verification_status = 'verified'),
                 'posted_trip', (select count(*) from members m where m.created_at >= w and m.created_at < w + interval '1 week'
                                and exists (select 1 from nata.trips t where t.traveler_id = m.id)),
                 'sent_request', (select count(*) from members m where m.created_at >= w and m.created_at < w + interval '1 week'
                                and exists (select 1 from nata.delivery_requests r where r.sender_id = m.id)))
               order by w)
          from generate_series(v_week - interval '11 weeks', v_week, interval '1 week') as w
      ),
      'signups', (select count(*) from members m where (v_from is null or m.created_at >= v_from) and (v_to is null or m.created_at < v_to)),
      'signups_verified', (select count(*) from members m where m.verification_status = 'verified'
                             and (v_from is null or m.created_at >= v_from) and (v_to is null or m.created_at < v_to)),
      'signups_posted_trip', (select count(*) from members m
                                where (v_from is null or m.created_at >= v_from) and (v_to is null or m.created_at < v_to)
                                  and exists (select 1 from nata.trips t where t.traveler_id = m.id)),
      'signups_sent_request', (select count(*) from members m
                                 where (v_from is null or m.created_at >= v_from) and (v_to is null or m.created_at < v_to)
                                   and exists (select 1 from nata.delivery_requests r where r.sender_id = m.id)),
      'repeat_senders', (
        select jsonb_build_object(
          'with_delivery', count(*),
          'repeat_60d', count(*) filter (where second_at is not null and second_at <= first_at + interval '60 days'),
          'eligible', count(*) filter (where first_at <= now() - interval '60 days'))
          from (select who, min(at) as first_at,
                       (array_agg(at order by at))[2] as second_at
                  from delivered_by_sender group by who) s
      ),
      'repeat_travelers', (
        select jsonb_build_object(
          'with_delivery', count(*),
          'repeat_60d', count(*) filter (where second_at is not null and second_at <= first_at + interval '60 days'),
          'eligible', count(*) filter (where first_at <= now() - interval '60 days'))
          from (select who, min(at) as first_at,
                       (array_agg(at order by at))[2] as second_at
                  from delivered_by_traveler group by who) s
      )
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.staff_metrics(int, int) from public, anon;
grant execute on function public.staff_metrics(int, int) to authenticated;
