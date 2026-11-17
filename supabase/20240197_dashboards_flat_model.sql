-- Staff dashboards follow the app as it is now.
--
-- Run AFTER 20240196_staff_kpis.sql. Safe to re-run.
--
-- Nata no longer holds the delivery money: a sender pays a flat fee for each
-- traveler who accepts, which opens their chat, and pays the traveler
-- directly (app migrations 20240200 to 20240225). There is no escrow, no
-- payout to travelers, no wallet, no deposit, no carrying limit and no
-- delivery code. A paid fee is 'held' while the delivery is under way (a
-- traveler who cancels refunds it in full) and 'released' (Nata's to keep)
-- once it is delivered or the sender cancels after paying (20240219). An
-- item can be sent to several travelers at once (one group_id), posted on the
-- Parcel Market with no traveler yet (a request with no trip, status 'open'
-- then 'closed'), and taken by one traveler only: the item's other requests
-- are cancelled with cancel_reason 'item_found'.
--
-- 1. nata.fee_revenue gains `kept` (the fee is released, so Nata keeps it).
--
-- 2. public.dashboard_stats(p_year, p_month): "transactions" are now the
--    connections paid (flat fees, plus payments on the earlier distance-priced
--    requests), without a sales volume: Nata no longer sees what senders pay
--    travelers. Revenue is unchanged, now split into kept and still
--    refundable.
--
-- 3. public.staff_metrics(p_year, p_month) is rebuilt:
--      health    deliveries by week, fees still refundable, items waiting for
--                a traveler, deliveries not confirmed after arrival
--      funnel    by item (a request sent to several travelers, or a posted
--                parcel, counts once): sent, a traveler accepted, fee paid,
--                picked up, delivered; how items end without a delivery
--      market    the Parcel Market: parcels posted, requests listed, offers,
--                items that found their traveler there
--      routes    items and trips by route, route and parcel alerts
--      payments  connection fees by currency, payment methods, mobile money,
--                refunds (no payouts or escrow)
--      trust     reports (problems and chat reports), ratings, ID checks,
--                tickets waiting for review, delivery confirmations
--      growth    sign-ups and activation, repeat use
--
-- 4. public.staff_kpis(p_year, p_month): revenue kept and still refundable,
--    posted parcels in the match rate and in corridor demand, the funnel by
--    item, parcel alerts, and requests closed because their item found
--    another traveler no longer count as cancellations.
--
-- Staff only (nata.admins); counts and sums, never a member's details.

-- -----------------------------------------------------------------------------
-- 1. Flat fee revenue, kept or still refundable
-- -----------------------------------------------------------------------------
create or replace view nata.fee_revenue
with (security_invoker = true)
as
  select p.id as payment_id,
         p.request_id,
         r.group_id,
         p.provider,
         p.method,
         coalesce(p.completed_at, p.created_at) as at,
         p.amount,
         upper(p.currency) as currency,
         nata.to_usd(p.amount, p.currency, coalesce(p.completed_at, p.created_at)) as usd,
         -- The fee as it was set (in the fee's own currency), for reconciling.
         r.platform_fee as list_fee,
         upper(r.currency) as list_currency,
         nata.to_usd(r.platform_fee, r.currency, coalesce(p.completed_at, p.created_at)) as list_usd,
         t.departure_city_id as from_id,
         t.arrival_city_id as to_id,
         sp.country_of_residence as sender_country,
         p.status = 'released' as kept
    from nata.payments p
    join nata.delivery_requests r on r.id = p.request_id and r.pricing = 'flat'
    join nata.trips t on t.id = r.trip_id
    left join nata.profiles sp on sp.id = r.sender_id
   where coalesce(p.purpose, 'delivery') = 'delivery'
     and p.status in ('held', 'released')
     and not coalesce(p.needs_refund, false)
     and coalesce(p.refund_status, '') <> 'refunded';

revoke all on nata.fee_revenue from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Items: one row per item (a request's group, or a posted parcel)
-- -----------------------------------------------------------------------------
-- When it was sent or posted, when a traveler first accepted, the fee was
-- first paid, it was picked up and delivered, and how it stands. Staff only,
-- through the functions below.
create or replace view nata.staff_items
with (security_invoker = true)
as
  with ev as (
    select e.request_id, e.status, min(e.created_at) as at
      from nata.request_events e group by 1, 2
  ),
  rq as (
    select r.id, coalesce(r.group_id, r.id) as grp, r.status, r.pricing, r.sender_id, r.trip_id,
           t.traveler_id, r.created_at, r.cancel_reason, r.cancelled_by,
           coalesce(r.price_fixed_at, a.at,
                    case when r.status in ('accepted', 'paid', 'handed_off', 'delivered') then r.responded_at end) as accepted_at,
           coalesce(r.paid_at, p.at) as paid_at,
           coalesce(r.picked_up_at, h.at) as picked_up_at,
           coalesce(r.delivered_at, d.at) as delivered_at
      from nata.delivery_requests r
      left join nata.trips t on t.id = r.trip_id
      left join ev a on a.request_id = r.id and a.status = 'accepted'
      left join ev p on p.request_id = r.id and p.status = 'paid'
      left join ev h on h.request_id = r.id and h.status = 'handed_off'
      left join ev d on d.request_id = r.id and d.status = 'delivered'
  )
  select q.grp,
         min(q.sender_id::text)::uuid as sender_id,
         min(q.created_at) as created_at,
         bool_or(q.trip_id is null) as posted,
         exists (select 1 from nata.market_items m where m.group_id = q.grp) as on_market,
         exists (select 1 from nata.market_offers o where o.group_id = q.grp and o.status = 'accepted') as via_market,
         count(*) filter (where q.trip_id is not null and coalesce(q.cancel_reason, '') <> 'item_found'
                            and not exists (select 1 from nata.market_offers o where o.request_id = q.id)) as sent_to,
         count(*) filter (where q.trip_id is not null) as requests,
         count(*) filter (where q.cancel_reason = 'item_found') as item_found,
         min(q.accepted_at) as accepted_at,
         min(q.paid_at) as paid_at,
         min(q.picked_up_at) as picked_up_at,
         min(q.delivered_at) as delivered_at,
         bool_or(q.status in ('pending', 'accepted', 'paid', 'handed_off')
                 or (q.status = 'open' and exists (select 1 from nata.market_items m
                                                     where m.group_id = q.grp and m.closed_at is null
                                                       and m.expires_at > now()))) as open,
         bool_or(q.status = 'cancelled' and q.cancelled_by = q.sender_id
                 and coalesce(q.cancel_reason, '') <> 'item_found') as cancelled_by_sender,
         bool_or(q.status = 'cancelled' and q.cancelled_by = q.traveler_id and q.paid_at is not null) as cancelled_by_traveler,
         bool_or(q.trip_id is null and q.status = 'closed'
                 and exists (select 1 from nata.market_items m where m.group_id = q.grp and m.closed_reason = 'cancelled')) as parcel_cancelled
    from rq q
   group by q.grp;

revoke all on nata.staff_items from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. dashboard_stats: connections paid, revenue kept and still refundable
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
  -- Connections paid: flat fees not refunded, and payments on the earlier
  -- distance-priced requests, at the day they were paid.
  all_tx as (
    select f.at from nata.fee_revenue f
    union all
    select coalesce(pay.completed_at, pay.created_at)
      from nata.payments pay
      join nata.delivery_requests r on r.id = pay.request_id and r.pricing <> 'flat'
     where pay.status in ('held', 'released', 'refunded') and not pay.needs_refund
       and coalesce(pay.purpose, 'delivery') = 'delivery'
  ),
  tx as (
    select * from all_tx t where (v_from is null or t.at >= v_from) and (v_to is null or t.at < v_to)
  ),
  -- Revenue: flat fees when paid; for distance-priced requests, the platform
  -- fee when delivered and the cancellation fee kept when cancelled.
  all_rev as (
    select f.at, f.usd, f.sender_country, f.kept from nata.fee_revenue f
    union all
    select coalesce(r.delivered_at, r.updated_at) as at,
           nata.to_usd(r.platform_fee, r.currency, coalesce(r.delivered_at, r.updated_at)) as usd,
           sp.country_of_residence as sender_country, true as kept
      from nata.delivery_requests r
      left join nata.profiles sp on sp.id = r.sender_id
     where r.pricing <> 'flat' and r.status = 'delivered' and coalesce(r.platform_fee, 0) > 0
    union all
    select coalesce(r.cancelled_at, r.updated_at),
           nata.to_usd(r.cancellation_fee, r.currency, coalesce(r.cancelled_at, r.updated_at)),
           sp.country_of_residence, true
      from nata.delivery_requests r
      left join nata.profiles sp on sp.id = r.sender_id
     where r.pricing <> 'flat' and r.status = 'cancelled' and coalesce(r.cancellation_fee, 0) > 0
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
      'revenue_usd', (select round(coalesce(sum(usd), 0), 2) from rev),
      'kept_usd',    (select round(coalesce(sum(usd) filter (where kept), 0), 2) from rev),
      'refundable_usd', (select round(coalesce(sum(usd) filter (where not kept), 0), 2) from rev)
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
  items as (select * from nata.staff_items),
  items_p as (
    select * from items i where (v_from is null or i.created_at >= v_from) and (v_to is null or i.created_at < v_to)
  ),
  -- Requests to a traveler's trip, with their route.
  req as (
    select r.*, coalesce(r.group_id, r.id) as grp, t.traveler_id,
           t.departure_city_id as from_id, t.arrival_city_id as to_id, t.arrival_date
      from nata.delivery_requests r join nata.trips t on t.id = r.trip_id
  ),
  -- Each item's route: its trip's for a request, each departure city for a
  -- posted parcel.
  item_routes as (
    select distinct q.grp, q.from_id, q.to_id from req q
    union
    select coalesce(r.group_id, r.id), f.city_id, r.parcel_to_city_id
      from nata.delivery_requests r
      cross join lateral unnest(r.parcel_from_city_ids) as f(city_id)
     where r.trip_id is null and r.parcel_to_city_id is not null
  ),
  live_trips as (
    select t.departure_city_id as from_id, t.arrival_city_id as to_id, count(*) as n
      from nata.trips t
     where t.status = 'live' and t.departure_date >= current_date
     group by 1, 2
  ),
  fee as (select * from nata.fee_revenue),
  fee_p as (
    select * from fee f where (v_from is null or f.at >= v_from) and (v_to is null or f.at < v_to)
  ),
  -- Paid fees still refundable: the delivery is under way.
  refundable as (
    select f.* from fee f join nata.delivery_requests r on r.id = f.request_id
     where not f.kept and r.status in ('paid', 'handed_off')
  ),
  pay as (
    select pay.*, pay.status in ('held', 'released', 'refunded') as ok
      from nata.payments pay where coalesce(pay.purpose, 'delivery') = 'delivery'
  ),
  pay_p as (
    select * from pay where (v_from is null or pay.created_at >= v_from) and (v_to is null or pay.created_at < v_to)
  ),
  market_p as (
    select m.*, exists (select 1 from nata.delivery_requests r where r.id = m.group_id and r.trip_id is null) as posted,
           (select min(o.created_at) from nata.market_offers o where o.group_id = m.group_id) as first_offer_at
      from nata.market_items m
     where (v_from is null or m.listed_at >= v_from) and (v_to is null or m.listed_at < v_to)
  ),
  offers_p as (
    select o.* from nata.market_offers o
     where (v_from is null or o.created_at >= v_from) and (v_to is null or o.created_at < v_to)
  ),
  delivered_p as (
    select q.* from req q
     where q.status = 'delivered' and q.delivered_at is not null
       and (v_from is null or q.delivered_at >= v_from) and (v_to is null or q.delivered_at < v_to)
  ),
  -- Paid or picked up, and the trip arrived more than 2 days ago (when the
  -- daily check-ins stop asking).
  unconfirmed as (
    select q.* from req q
     where q.status in ('paid', 'handed_off') and q.arrival_date < current_date - 2
  ),
  members as (
    select pr.id, pr.created_at, pr.verification_status from nata.profiles pr where pr.deleted_at is null
  ),
  delivered_by_sender as (
    select q.sender_id as who, q.delivered_at as at from req q where q.delivered_at is not null
  ),
  delivered_by_traveler as (
    select q.traveler_id as who, q.delivered_at as at from req q where q.delivered_at is not null
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
      'refundable_usd', (select round(coalesce(sum(usd), 0), 2) from refundable),
      'refundable_count', (select count(*) from refundable),
      'waiting_items', (select count(*) from items i where i.open and i.accepted_at is null),
      'waiting_posted', (select count(*) from items i where i.open and i.accepted_at is null and i.posted),
      'under_way', (select count(*) from items i where i.open and i.paid_at is not null and i.delivered_at is null),
      'unconfirmed', (select count(*) from unconfirmed)
    ),

    -- 2. Funnel, by item --------------------------------------------------------
    'funnel', (
      select jsonb_build_object(
        'requested',  count(*),
        'posted',     count(*) filter (where posted),
        'multi_sent', count(*) filter (where sent_to > 1),
        'sent_to',    coalesce(sum(sent_to), 0),
        'accepted',   count(*) filter (where accepted_at is not null),
        'paid',       count(*) filter (where paid_at is not null),
        'picked_up',  count(*) filter (where picked_up_at is not null),
        'delivered',  count(*) filter (where delivered_at is not null),
        'open',       count(*) filter (where open and delivered_at is null),
        'no_traveler', count(*) filter (where not open and accepted_at is null
                                          and not cancelled_by_sender and not parcel_cancelled),
        'unpaid',     count(*) filter (where not open and accepted_at is not null and paid_at is null
                                         and not cancelled_by_sender and not parcel_cancelled),
        'cancelled_by_sender', count(*) filter (where delivered_at is null and not open
                                                  and (cancelled_by_sender or parcel_cancelled)),
        'cancelled_by_traveler', count(*) filter (where cancelled_by_traveler),
        'item_found', coalesce(sum(item_found), 0),
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
      from items_p
    ),

    -- 3. Parcel Market ------------------------------------------------------------
    'market', jsonb_build_object(
      'listed', (select count(*) from market_p),
      'posted', (select count(*) from market_p where posted),
      'requests_listed', (select count(*) from market_p where not posted),
      'with_offer', (select count(*) from market_p where first_offer_at is not null),
      'found', (select count(*) from market_p where closed_reason = 'found'),
      'hours_to_first_offer', (select round((percentile_cont(0.5) within group (
                                  order by extract(epoch from first_offer_at - listed_at) / 3600))::numeric, 1)
                                 from market_p where first_offer_at is not null),
      'offers', (select count(*) from offers_p),
      'offers_accepted', (select count(*) from offers_p where status = 'accepted'),
      'offers_declined', (select count(*) from offers_p where status = 'declined'),
      'offers_withdrawn', (select count(*) from offers_p where status = 'withdrawn'),
      'offers_pending', (select count(*) from offers_p where status = 'pending'),
      'on_market_now', (select count(*) from nata.market_items m where m.closed_at is null and m.expires_at > now()),
      'without_offer_now', (select count(*) from nata.market_items m
                             where m.closed_at is null and m.expires_at > now()
                               and not exists (select 1 from nata.market_offers o
                                                where o.group_id = m.group_id and o.status in ('pending', 'accepted'))),
      'expired', (select count(*) from market_p where closed_at is null and expires_at <= now())
    ),

    -- 4. Supply and demand by route ----------------------------------------------
    'routes', jsonb_build_object(
      'by_requests', coalesce((
        select jsonb_agg(x order by x.requests desc, x.from_city) from (
          select fc.name as from_city, fc.country_code as from_country, tc.name as to_city, tc.country_code as to_country,
                 count(*) as requests,
                 count(*) filter (where i.delivered_at is not null) as delivered,
                 count(*) filter (where i.open and i.accepted_at is null) as waiting,
                 coalesce(max(lt.n), 0) as live_trips
            from item_routes ir
            join items_p i on i.grp = ir.grp
            join nata.cities fc on fc.id = ir.from_id
            join nata.cities tc on tc.id = ir.to_id
            left join live_trips lt on lt.from_id = ir.from_id and lt.to_id = ir.to_id
           group by ir.from_id, ir.to_id, fc.name, fc.country_code, tc.name, tc.country_code
           order by count(*) desc limit 10) x
      ), '[]'::jsonb),
      'by_trips', coalesce((
        select jsonb_agg(x order by x.trips desc, x.from_city) from (
          select fc.name as from_city, fc.country_code as from_country, tc.name as to_city, tc.country_code as to_country,
                 count(*) as trips,
                 (select count(distinct ir.grp) from item_routes ir join items_p i on i.grp = ir.grp
                   where ir.from_id = t.departure_city_id and ir.to_id = t.arrival_city_id) as requests
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
      'parcel_alerts_total', (select count(*) from nata.parcel_alerts),
      'parcel_alerts_matched', (select count(*) from nata.parcel_alerts a
                                 where exists (select 1 from item_routes ir join items i on i.grp = ir.grp
                                                where i.open and i.accepted_at is null
                                                  and ir.from_id = a.from_city_id and ir.to_id = a.to_city_id)),
      'active_travelers_30d', (select count(distinct t.traveler_id) from nata.trips t where t.created_at >= now() - interval '30 days'),
      'active_senders_30d', (select count(distinct r.sender_id) from nata.delivery_requests r where r.created_at >= now() - interval '30 days')
    ),

    -- 5. Connection fees and payments --------------------------------------------
    'payments', jsonb_build_object(
      'fees_paid', (select count(*) from fee_p),
      'fees_usd', (select round(coalesce(sum(usd), 0), 2) from fee_p),
      'fees_kept_usd', (select round(coalesce(sum(usd) filter (where kept), 0), 2) from fee_p),
      'fees_by_currency', coalesce((
        select jsonb_agg(x order by x.usd desc) from (
          select f.currency, count(*) as count, round(sum(f.amount), 2) as amount,
                 round(coalesce(sum(f.amount) filter (where f.kept), 0), 2) as kept,
                 round(coalesce(sum(f.amount) filter (where not f.kept), 0), 2) as refundable,
                 round(coalesce(sum(f.usd), 0), 2) as usd
            from fee_p f group by f.currency) x
      ), '[]'::jsonb),
      'refundable_by_currency', coalesce((
        select jsonb_agg(x order by x.currency) from (
          select f.currency, round(sum(f.amount), 2) as amount, count(*) as count
            from refundable f group by f.currency) x
      ), '[]'::jsonb),
      'attempts', (select count(*) from pay_p),
      'failed', (select count(*) from pay_p where status = 'failed'),
      'stuck', (select count(*) from pay_p where status = 'pending' and created_at < now() - interval '1 hour'),
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
      )
    ),

    -- 6. Trust and safety --------------------------------------------------------
    'trust', jsonb_build_object(
      'deliveries', (select count(*) from delivered_p),
      'problems', (select count(*) from nata.disputes d
                    where (v_from is null or d.created_at >= v_from) and (v_to is null or d.created_at < v_to)),
      'chat_reports', (select count(*) from nata.chat_reports cr
                        where (v_from is null or cr.created_at >= v_from) and (v_to is null or cr.created_at < v_to)),
      'reports_open', (select count(*) from nata.disputes d where d.resolved_at is null and d.status in ('open', 'under_review'))
                      + (select count(*) from nata.chat_reports cr where cr.status = 'open'),
      'reports_oldest_open_hours', (select round(extract(epoch from now() - min(at)) / 3600)::int from (
                                      select d.created_at as at from nata.disputes d where d.resolved_at is null and d.status in ('open', 'under_review')
                                      union all
                                      select cr.created_at from nata.chat_reports cr where cr.status = 'open') o),
      'traveler_rating', (select round(avg(rv.rating)::numeric, 2) from nata.reviews rv
                           where rv.reviewee_role = 'traveler'
                             and (v_from is null or rv.created_at >= v_from) and (v_to is null or rv.created_at < v_to)),
      'traveler_reviews', (select count(*) from nata.reviews rv where rv.reviewee_role = 'traveler'
                             and (v_from is null or rv.created_at >= v_from) and (v_to is null or rv.created_at < v_to)),
      'delivered_reviewed', (select count(*) from delivered_p q
                              where exists (select 1 from nata.reviews rv where rv.request_id = q.id)),
      'identity', (
        select jsonb_build_object(
          'passed',   count(*) filter (where iv.status = 'verified'),
          'rejected', count(*) filter (where iv.status = 'rejected'),
          'waiting',  count(*) filter (where nata.id_waits_for_team(iv)),
          'oldest_waiting_hours', round(extract(epoch from now() - min(iv.updated_at) filter (where nata.id_waits_for_team(iv))) / 3600)::int,
          'median_hours_to_decide', round((percentile_cont(0.5) within group (
              order by extract(epoch from coalesce(iv.verified_at, iv.reviewed_at) - iv.created_at) / 3600)
              filter (where coalesce(iv.verified_at, iv.reviewed_at) is not null))::numeric, 1))
          from nata.identity_verifications iv
      ),
      'tickets', jsonb_build_object(
        'waiting', (select count(*) from nata.trips t where t.status = 'pending_review' and t.ticket_review_reason is not null),
        'oldest_waiting_hours', (select round(extract(epoch from now() - min(coalesce(t.ticket_review_requested_at, t.updated_at))) / 3600)::int
                                   from nata.trips t where t.status = 'pending_review' and t.ticket_review_reason is not null)
      ),
      'confirmations', (
        select jsonb_build_object(
          'delivered', count(*),
          'by_sender', count(*) filter (where q.receipt_confirmed_at is not null),
          'by_traveler_only', count(*) filter (where q.receipt_confirmed_at is null and q.traveler_delivered_at is not null))
          from delivered_p q where q.pricing = 'flat'
      ),
      'unconfirmed', (select count(*) from unconfirmed)
    ),

    -- 7. Growth and retention ----------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 4. staff_kpis
-- -----------------------------------------------------------------------------
create or replace function public.staff_kpis(p_year int default null, p_month int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from  timestamptz;
  v_to    timestamptz;
  v_week  timestamptz := date_trunc('week', now(), 'UTC');
  v_month timestamptz := date_trunc('month', now(), 'UTC');
  result  jsonb;
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
  -- ── Shared ────────────────────────────────────────────────────────────────
  fee as (select * from nata.fee_revenue),
  fee_p as (
    select * from fee f where (v_from is null or f.at >= v_from) and (v_to is null or f.at < v_to)
  ),
  ev as (
    select e.request_id, e.status, min(e.created_at) as at
      from nata.request_events e group by 1, 2
  ),
  -- One row per request with the time it reached each step.
  req as (
    select r.id, coalesce(r.group_id, r.id) as grp, r.status, r.pricing, r.sender_id, r.trip_id,
           t.traveler_id, t.departure_city_id as from_id, t.arrival_city_id as to_id,
           r.created_at,
           coalesce(r.price_fixed_at, a.at,
                    case when r.status in ('accepted', 'paid', 'handed_off', 'delivered') then r.responded_at end) as accepted_at,
           coalesce(r.paid_at, p.at) as paid_at,
           coalesce(r.picked_up_at, h.at) as picked_up_at,
           coalesce(r.delivered_at, d.at) as delivered_at,
           coalesce(r.cancelled_at, c.at) as cancelled_at,
           r.cancelled_by, r.cancel_reason,
           r.pickup_photo_path, r.pickup_photo_paths, r.sender_handover_photo_path
      from nata.delivery_requests r
      join nata.trips t on t.id = r.trip_id
      left join ev a on a.request_id = r.id and a.status = 'accepted'
      left join ev p on p.request_id = r.id and p.status = 'paid'
      left join ev h on h.request_id = r.id and h.status = 'handed_off'
      left join ev d on d.request_id = r.id and d.status = 'delivered'
      left join ev c on c.request_id = r.id and c.status = 'cancelled'
  ),
  req_p as (
    select * from req q where (v_from is null or q.created_at >= v_from) and (v_to is null or q.created_at < v_to)
  ),
  -- An item counts once for the match rate: a request sent to several
  -- travelers, or a parcel posted on the market (with the requests made from
  -- its offers).
  items_p as (
    select i.*, i.open and i.accepted_at is null as waiting
      from nata.staff_items i
     where (v_from is null or i.created_at >= v_from) and (v_to is null or i.created_at < v_to)
  ),
  delivered_p as (
    select * from req q where q.delivered_at is not null
       and (v_from is null or q.delivered_at >= v_from) and (v_to is null or q.delivered_at < v_to)
  ),
  members as (
    select pr.id, pr.created_at, pr.verification_status, pr.country_of_residence
      from nata.profiles pr where pr.deleted_at is null
  ),
  members_p as (
    select m.*,
           exists (select 1 from nata.trips t where t.traveler_id = m.id) as posted_trip,
           exists (select 1 from nata.delivery_requests r where r.sender_id = m.id) as sent_request,
           exists (select 1 from fee f join nata.delivery_requests r on r.id = f.request_id
                    where r.sender_id = m.id) as paid_fee
      from members m
     where (v_from is null or m.created_at >= v_from) and (v_to is null or m.created_at < v_to)
  ),
  live_trips as (
    select t.departure_city_id as from_id, t.arrival_city_id as to_id, count(*) as n
      from nata.trips t
     where t.status = 'live' and t.departure_date >= current_date
     group by 1, 2
  ),
  -- Items still looking for a traveler or under way, by route: a request's
  -- trip, or each departure city of a posted parcel on the market.
  open_reqs as (
    select from_id, to_id, count(distinct grp) as n from (
      select q.from_id, q.to_id, q.grp
        from req q where q.status in ('pending', 'accepted', 'paid', 'handed_off')
      union all
      select f.city_id, r.parcel_to_city_id, r.id
        from nata.delivery_requests r
        join nata.market_items m on m.group_id = r.id and m.closed_at is null and m.expires_at > now()
        cross join lateral unnest(r.parcel_from_city_ids) as f(city_id)
       where r.trip_id is null and r.status = 'open' and r.parcel_to_city_id is not null) o
     group by 1, 2
  ),
  alerts as (
    select a.from_city_id as from_id, a.to_city_id as to_id, count(*) as n
      from nata.route_alerts a group by 1, 2
  ),
  alert_sends as (
    select n.user_id, n.related_id as trip_id, n.created_at,
           (n.payload ->> 'from_city_id')::int as from_id,
           (n.payload ->> 'to_city_id')::int as to_id
      from nata.notifications n
     where n.payload ->> 'event' = 'trip_match'
       and (v_from is null or n.created_at >= v_from) and (v_to is null or n.created_at < v_to)
  ),
  iv as (
    select v.*, nata.id_waits_for_team(v) as waits
      from nata.identity_verifications v
  ),
  pay_p as (
    select pay.*, r.pricing
      from nata.payments pay
      left join nata.delivery_requests r on r.id = pay.request_id
     where (v_from is null or pay.created_at >= v_from) and (v_to is null or pay.created_at < v_to)
  ),
  refunds_p as (
    select pay.* from nata.payments pay
     where (pay.refund_status is not null or pay.needs_refund)
       and (v_from is null or coalesce(pay.refunded_at, pay.updated_at) >= v_from)
       and (v_to is null or coalesce(pay.refunded_at, pay.updated_at) < v_to)
  ),
  disputes_x as (
    select d.*,
           least(d.resolved_at,
                 (select min(sa.created_at) from nata.support_actions sa
                   where sa.request_id = d.request_id and sa.created_at >= d.created_at)) as first_action_at
      from nata.disputes d
  ),
  reviews_p as (
    select rv.* from nata.reviews rv
     where (v_from is null or rv.created_at >= v_from) and (v_to is null or rv.created_at < v_to)
  ),
  cancels_p as (
    select q.*,
           case when q.cancelled_by is null then 'nata'
                when q.cancelled_by = q.sender_id then 'sender'
                when q.cancelled_by = q.traveler_id then 'traveler'
                else 'nata' end as who,
           case when q.picked_up_at is not null then 'picked_up'
                when q.paid_at is not null then 'paid'
                when q.accepted_at is not null then 'accepted'
                else 'pending' end as stage
      from req q
     where q.status = 'cancelled' and coalesce(q.cancel_reason, '') <> 'item_found'
       and (v_from is null or q.cancelled_at >= v_from) and (v_to is null or q.cancelled_at < v_to)
  ),
  first_sends as (
    select q.sender_id as who, q.grp, min(q.created_at) as at from req q group by 1, 2
  ),
  trips_by as (
    select t.traveler_id as who, t.created_at as at from nata.trips t
  )
  select jsonb_build_object(
    'generated_at', now(),
    'period', jsonb_build_object('year', p_year, 'month', p_month),

    -- ── 1. Management ───────────────────────────────────────────────────────
    'management', jsonb_build_object(
      'revenue_usd', (select round(coalesce(sum(usd), 0), 2) from fee_p),
      'revenue_kept_usd', (select round(coalesce(sum(usd) filter (where kept), 0), 2) from fee_p),
      'revenue_refundable_usd', (select round(coalesce(sum(usd) filter (where not kept), 0), 2) from fee_p),
      'connections', (select count(*) from fee_p),
      'list_usd', (select round(coalesce(sum(list_usd), 0), 2) from fee_p),
      'paid_requests', (select count(*) from req q where q.pricing = 'flat' and q.paid_at is not null
                          and (v_from is null or q.paid_at >= v_from) and (v_to is null or q.paid_at < v_to)),
      'refunded_connections', (select count(*) from nata.payments pay
                                 join nata.delivery_requests r on r.id = pay.request_id and r.pricing = 'flat'
                                where coalesce(pay.purpose, 'delivery') = 'delivery'
                                  and (pay.status = 'refunded' or pay.refund_status = 'refunded')
                                  and (v_from is null or coalesce(pay.refunded_at, pay.updated_at) >= v_from)
                                  and (v_to is null or coalesce(pay.refunded_at, pay.updated_at) < v_to)),
      'revenue_by_week', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(w, 'YYYY-MM-DD'),
                 'count', (select count(*) from fee f where f.at >= w and f.at < w + interval '1 week'),
                 'revenue_usd', (select round(coalesce(sum(f.usd), 0), 2) from fee f where f.at >= w and f.at < w + interval '1 week'))
               order by w)
          from generate_series(v_week - interval '11 weeks', v_week, interval '1 week') as w
      ),
      'revenue_by_month', (
        select jsonb_agg(jsonb_build_object(
                 'date', to_char(mo, 'YYYY-MM'),
                 'count', (select count(*) from fee f where f.at >= mo and f.at < mo + interval '1 month'),
                 'revenue_usd', (select round(coalesce(sum(f.usd), 0), 2) from fee f where f.at >= mo and f.at < mo + interval '1 month'))
               order by mo)
          from generate_series(v_month - interval '11 months', v_month, interval '1 month') as mo
      ),
      'revenue_by_currency', coalesce((
        select jsonb_agg(x order by x.usd desc) from (
          select f.currency, count(*) as count, round(sum(f.amount), 2) as amount, round(coalesce(sum(f.usd), 0), 2) as usd
            from fee_p f group by f.currency) x
      ), '[]'::jsonb),
      'revenue_by_corridor', coalesce((
        select jsonb_agg(x order by x.usd desc, x.count desc) from (
          select fc.name as from_city, fc.country_code as from_country, tc.name as to_city, tc.country_code as to_country,
                 count(*) as count, round(coalesce(sum(f.usd), 0), 2) as usd
            from fee_p f
            join nata.cities fc on fc.id = f.from_id
            join nata.cities tc on tc.id = f.to_id
           group by f.from_id, f.to_id, fc.name, fc.country_code, tc.name, tc.country_code
           order by 6 desc, 5 desc limit 10) x
      ), '[]'::jsonb),
      'match', (
        select jsonb_build_object(
          'groups', count(*),
          'matched', count(*) filter (where accepted_at is not null),
          'waiting', count(*) filter (where waiting),
          'posted', count(*) filter (where posted),
          'via_market', count(*) filter (where via_market),
          'requests', (select count(*) from req_p where coalesce(cancel_reason, '') <> 'item_found'),
          'requests_accepted', (select count(*) from req_p where accepted_at is not null))
          from items_p
      ),
      'corridors', coalesce((
        select jsonb_agg(x order by x.demand + x.live_trips desc, x.from_city) from (
          select fc.name as from_city, fc.country_code as from_country, tc.name as to_city, tc.country_code as to_country,
                 coalesce(lt.n, 0) as live_trips, coalesce(o.n, 0) as open_requests, coalesce(al.n, 0) as alerts,
                 coalesce(o.n, 0) + coalesce(al.n, 0) as demand
            from (select from_id, to_id from live_trips
                  union select from_id, to_id from open_reqs
                  union select from_id, to_id from alerts) k
            join nata.cities fc on fc.id = k.from_id
            join nata.cities tc on tc.id = k.to_id
            left join live_trips lt on lt.from_id = k.from_id and lt.to_id = k.to_id
            left join open_reqs o on o.from_id = k.from_id and o.to_id = k.to_id
            left join alerts al on al.from_id = k.from_id and al.to_id = k.to_id
           order by coalesce(o.n, 0) + coalesce(al.n, 0) + coalesce(lt.n, 0) desc
           limit 15) x
      ), '[]'::jsonb),
      'repeat_senders', (
        select jsonb_build_object(
          'people', count(*),
          'repeat', count(*) filter (where second_at is not null and second_at <= first_at + interval '90 days'),
          'eligible', count(*) filter (where first_at <= now() - interval '90 days'),
          'eligible_repeat', count(*) filter (where first_at <= now() - interval '90 days'
                                               and second_at is not null and second_at <= first_at + interval '90 days'))
          from (select who, min(at) as first_at, (array_agg(at order by at))[2] as second_at
                  from first_sends group by who) s
      ),
      'repeat_travelers', (
        select jsonb_build_object(
          'people', count(*),
          'repeat', count(*) filter (where second_at is not null and second_at <= first_at + interval '90 days'),
          'eligible', count(*) filter (where first_at <= now() - interval '90 days'),
          'eligible_repeat', count(*) filter (where first_at <= now() - interval '90 days'
                                               and second_at is not null and second_at <= first_at + interval '90 days'))
          from (select who, min(at) as first_at, (array_agg(at order by at))[2] as second_at
                  from trips_by group by who) s
      ),
      'safety', jsonb_build_object(
        'deliveries', (select count(*) from delivered_p),
        'problems', (select count(*) from nata.disputes d
                      where (v_from is null or d.created_at >= v_from) and (v_to is null or d.created_at < v_to)),
        'problems_resolved', (select count(*) from nata.disputes d
                               where d.status in ('resolved', 'rejected')
                                 and (v_from is null or d.created_at >= v_from) and (v_to is null or d.created_at < v_to)),
        'chat_reports', (select count(*) from nata.chat_reports cr
                          where (v_from is null or cr.created_at >= v_from) and (v_to is null or cr.created_at < v_to)),
        'chat_reports_reviewed', (select count(*) from nata.chat_reports cr
                                   where cr.status <> 'open'
                                     and (v_from is null or cr.created_at >= v_from) and (v_to is null or cr.created_at < v_to))
      )
    ),

    -- ── 2. Growth and marketing ─────────────────────────────────────────────
    'growth', jsonb_build_object(
      'signups', (select count(*) from members_p),
      'verified', (select count(*) from members_p where verification_status = 'verified'),
      'posted_trip', (select count(*) from members_p where posted_trip),
      'sent_request', (select count(*) from members_p where sent_request),
      'active', (select count(*) from members_p where posted_trip or sent_request),
      'funnel', (
        select jsonb_build_object(
          'requested', count(*),
          'accepted',  count(*) filter (where accepted_at is not null),
          'paid',      count(*) filter (where paid_at is not null),
          'picked_up', count(*) filter (where picked_up_at is not null),
          'delivered', count(*) filter (where delivered_at is not null),
          'reviewed',  count(*) filter (where delivered_at is not null
                                          and exists (select 1 from nata.reviews rv
                                                        join nata.delivery_requests r on r.id = rv.request_id
                                                       where coalesce(r.group_id, r.id) = i.grp)))
          from items_p i
      ),
      'alerts', jsonb_build_object(
        'saved', (select count(*) from nata.route_alerts a
                   where (v_from is null or a.created_at >= v_from) and (v_to is null or a.created_at < v_to)),
        'active', (select count(*) from nata.route_alerts),
        'sent', (select count(*) from alert_sends),
        -- A request by the alerted member on the same route within 14 days.
        'led_to_request', (select count(*) from alert_sends s
                            where exists (select 1 from req q
                                           where q.sender_id = s.user_id
                                             and (q.trip_id = s.trip_id or (q.from_id = s.from_id and q.to_id = s.to_id))
                                             and q.created_at >= s.created_at
                                             and q.created_at < s.created_at + interval '14 days')),
        'parcel_saved', (select count(*) from nata.parcel_alerts a
                          where (v_from is null or a.created_at >= v_from) and (v_to is null or a.created_at < v_to)),
        'parcel_active', (select count(*) from nata.parcel_alerts),
        'parcel_sent', (select count(*) from nata.notifications n
                         where n.payload ->> 'event' in ('parcel_alert', 'market_parcel_new')
                           and (v_from is null or n.created_at >= v_from) and (v_to is null or n.created_at < v_to))
      ),
      'by_country', coalesce((
        select jsonb_agg(x order by x.signups desc, x.revenue_usd desc, x.country) from (
          select c.country,
                 coalesce(m.signups, 0) as signups,
                 coalesce(m.verified, 0) as verified,
                 coalesce(m.active, 0) as active,
                 coalesce(m.paying, 0) as paying,
                 coalesce(f.connections, 0) as connections,
                 coalesce(f.revenue_usd, 0) as revenue_usd
            from (select coalesce(country_of_residence, '??') as country from members_p
                  union select coalesce(sender_country, '??') from fee_p) c
            left join (
              select coalesce(country_of_residence, '??') as country, count(*) as signups,
                     count(*) filter (where verification_status = 'verified') as verified,
                     count(*) filter (where posted_trip or sent_request) as active,
                     count(*) filter (where paid_fee) as paying
                from members_p group by 1) m on m.country = c.country
            left join (
              select coalesce(sender_country, '??') as country, count(*) as connections,
                     round(coalesce(sum(usd), 0), 2) as revenue_usd
                from fee_p group by 1) f on f.country = c.country
           order by 2 desc, 7 desc limit 15) x
      ), '[]'::jsonb)
    ),

    -- ── 3. Operations and support ───────────────────────────────────────────
    'operations', jsonb_build_object(
      'identity', jsonb_build_object(
        'median_hours_to_verified', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from v.verified_at - v.created_at) / 3600))::numeric, 1)
            from iv v where v.status = 'verified' and v.verified_at is not null
             and (v_from is null or v.verified_at >= v_from) and (v_to is null or v.verified_at < v_to)),
        'verified', (select count(*) from iv v where v.status = 'verified' and v.verified_at is not null
                       and (v_from is null or v.verified_at >= v_from) and (v_to is null or v.verified_at < v_to)),
        -- Face match, for checks that ran it at least once (by last update).
        'face_checked', (select count(*) from iv v where coalesce(v.face_match_attempts, 0) > 0
                           and (v_from is null or v.updated_at >= v_from) and (v_to is null or v.updated_at < v_to)),
        'face_passed', (select count(*) from iv v where coalesce(v.face_match_attempts, 0) > 0
                          and v.status = 'verified' and v.face_similarity is not null
                          and (v_from is null or v.updated_at >= v_from) and (v_to is null or v.updated_at < v_to)),
        'face_no_score', (select count(*) from iv v where coalesce(v.face_match_attempts, 0) > 0
                            and v.face_similarity is null and v.status <> 'verified'
                            and (v_from is null or v.updated_at >= v_from) and (v_to is null or v.updated_at < v_to)),
        'face_attempts', (select coalesce(sum(v.face_match_attempts), 0) from iv v
                           where (v_from is null or v.updated_at >= v_from) and (v_to is null or v.updated_at < v_to)),
        'approved_by_team', (select count(*) from iv v where v.status = 'verified' and v.face_similarity is null
                               and v.verified_at is not null
                               and (v_from is null or v.verified_at >= v_from) and (v_to is null or v.verified_at < v_to)),
        'waiting', (select count(*) from iv v where v.waits),
        'oldest_waiting_hours', (select round(extract(epoch from now() - min(v.updated_at)) / 3600)::int
                                   from iv v where v.waits)
      ),
      'support', jsonb_build_object(
        'problems_open', (select count(*) from nata.disputes d where d.status in ('open', 'under_review')),
        'problems_oldest_hours', (select round(extract(epoch from now() - min(d.created_at)) / 3600)::int
                                    from nata.disputes d where d.status in ('open', 'under_review')),
        'problems_first_action_hours', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from d.first_action_at - d.created_at) / 3600))::numeric, 1)
            from disputes_x d where d.first_action_at is not null
             and (v_from is null or d.created_at >= v_from) and (v_to is null or d.created_at < v_to)),
        'problems_resolution_hours', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from d.resolved_at - d.created_at) / 3600))::numeric, 1)
            from nata.disputes d where d.resolved_at is not null
             and (v_from is null or d.created_at >= v_from) and (v_to is null or d.created_at < v_to)),
        'reports_open', (select count(*) from nata.chat_reports cr where cr.status = 'open'),
        'reports_oldest_hours', (select round(extract(epoch from now() - min(cr.created_at)) / 3600)::int
                                   from nata.chat_reports cr where cr.status = 'open'),
        'reports_review_hours', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from cr.reviewed_at - cr.created_at) / 3600))::numeric, 1)
            from nata.chat_reports cr where cr.reviewed_at is not null
             and (v_from is null or cr.created_at >= v_from) and (v_to is null or cr.created_at < v_to)),
        'id_reviews_open', (select count(*) from iv v where v.waits),
        'id_reviews_oldest_hours', (select round(extract(epoch from now() - min(v.updated_at)) / 3600)::int
                                      from iv v where v.waits),
        'id_reviews_decision_hours', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from coalesce(v.verified_at, v.reviewed_at) - v.created_at) / 3600))::numeric, 1)
            from iv v where v.face_similarity is null and coalesce(v.verified_at, v.reviewed_at) is not null
             and v.status in ('verified', 'rejected')
             and (v_from is null or coalesce(v.verified_at, v.reviewed_at) >= v_from)
             and (v_to is null or coalesce(v.verified_at, v.reviewed_at) < v_to))
      ),
      'payments_by_provider', coalesce((
        select jsonb_agg(x order by x.attempts desc) from (
          select k.provider,
                 coalesce(a.attempts, 0) as attempts,
                 coalesce(a.failed, 0) as failed,
                 coalesce(a.stuck, 0) as stuck,
                 coalesce(rf.refunds, 0) as refunds,
                 coalesce(rf.refunds_failed, 0) as refunds_failed,
                 coalesce(rf.refunds_waiting, 0) as refunds_waiting
            from (select provider from pay_p union select provider from refunds_p) k
            left join (
              select provider, count(*) as attempts,
                     count(*) filter (where status = 'failed') as failed,
                     count(*) filter (where status = 'pending' and created_at < now() - interval '1 hour') as stuck
                from pay_p where coalesce(purpose, 'delivery') = 'delivery' group by provider) a on a.provider = k.provider
            left join (
              select provider, count(*) as refunds,
                     count(*) filter (where refund_status = 'failed') as refunds_failed,
                     count(*) filter (where coalesce(refund_status, '') not in ('refunded', 'failed')) as refunds_waiting
                from refunds_p group by provider) rf on rf.provider = k.provider
           where k.provider is not null) x
      ), '[]'::jsonb),
      'handover', jsonb_build_object(
        'deliveries', (select count(*) from delivered_p),
        'with_pickup_photo', (select count(*) from delivered_p q
                                where q.pickup_photo_path is not null
                                   or coalesce(cardinality(q.pickup_photo_paths), 0) > 0
                                   or exists (select 1 from nata.request_photos ph
                                               where ph.request_id = q.id and ph.type ilike 'pickup%')),
        'with_sender_photo', (select count(*) from delivered_p q where q.sender_handover_photo_path is not null),
        'picked_up', (select count(*) from req q where q.picked_up_at is not null
                        and (v_from is null or q.picked_up_at >= v_from) and (v_to is null or q.picked_up_at < v_to)),
        'picked_up_with_sender_photo', (select count(*) from req q where q.picked_up_at is not null
                        and q.sender_handover_photo_path is not null
                        and (v_from is null or q.picked_up_at >= v_from) and (v_to is null or q.picked_up_at < v_to))
      )
    ),

    -- ── 4. Product and engineering ──────────────────────────────────────────
    'product', jsonb_build_object(
      'times', (
        select jsonb_build_object(
          'accept_median', round((percentile_cont(0.5) within group (order by extract(epoch from accepted_at - created_at) / 3600)
                                  filter (where accepted_at is not null))::numeric, 1),
          'accept_p90',    round((percentile_cont(0.9) within group (order by extract(epoch from accepted_at - created_at) / 3600)
                                  filter (where accepted_at is not null))::numeric, 1),
          'deliver_median', round((percentile_cont(0.5) within group (order by extract(epoch from delivered_at - picked_up_at) / 3600)
                                  filter (where delivered_at is not null and picked_up_at is not null))::numeric, 1),
          'deliver_p90',    round((percentile_cont(0.9) within group (order by extract(epoch from delivered_at - picked_up_at) / 3600)
                                  filter (where delivered_at is not null and picked_up_at is not null))::numeric, 1),
          'end_to_end_median', round((percentile_cont(0.5) within group (order by extract(epoch from delivered_at - created_at) / 3600)
                                  filter (where delivered_at is not null))::numeric, 1),
          'accepted', count(*) filter (where accepted_at is not null),
          'delivered', count(*) filter (where delivered_at is not null))
          from req_p
      ),
      'cancellations', jsonb_build_object(
        'total', (select count(*) from cancels_p),
        'item_found', (select count(*) from req q where q.cancel_reason = 'item_found'
                         and (v_from is null or q.cancelled_at >= v_from) and (v_to is null or q.cancelled_at < v_to)),
        'by_stage', coalesce((
          select jsonb_agg(x order by array_position(array['pending', 'accepted', 'paid', 'picked_up'], x.stage)) from (
            select stage,
                   count(*) filter (where who = 'sender') as sender,
                   count(*) filter (where who = 'traveler') as traveler,
                   count(*) filter (where who = 'nata') as nata,
                   count(*) as total
              from cancels_p group by stage) x
        ), '[]'::jsonb)
      ),
      'ratings', (
        select jsonb_build_object(
          'count', count(*),
          'average', round(avg(rating)::numeric, 2),
          'under_4', count(*) filter (where rating < 4),
          'traveler_average', round((avg(rating) filter (where reviewee_role = 'traveler'))::numeric, 2),
          'traveler_count', count(*) filter (where reviewee_role = 'traveler'),
          'sender_average', round((avg(rating) filter (where reviewee_role = 'sender'))::numeric, 2),
          'sender_count', count(*) filter (where reviewee_role = 'sender'))
          from reviews_p
      )
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.staff_kpis(int, int) from public, anon;
grant execute on function public.staff_kpis(int, int) to authenticated;
