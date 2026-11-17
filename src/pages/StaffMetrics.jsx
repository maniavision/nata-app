import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { supabase } from '../supabase.js';
import { useFormatters } from '../format.js';
import StaffPage from '../components/StaffPage.jsx';
import { PeriodFilter, SeriesChart, StatTile, usePeriod } from './Dashboard.jsx';

// ── Shared ──────────────────────────────────────────────────────────────────

function ratio(part, whole) {
  return whole > 0 ? part / whole : null;
}

// 3 h, 2 d — for ages and median times given in hours.
function hours(fmt, t, h) {
  if (h == null) return '–';
  if (h < 1) return t('metrics.units.minutes').replace('{n}', fmt.number(Math.max(1, Math.round(h * 60))));
  if (h < 48) return t('metrics.units.hours').replace('{n}', fmt.number(Math.round(h * 10) / 10));
  return t('metrics.units.days').replace('{n}', fmt.number(Math.round(h / 24)));
}

// A translation, or `fallback` when the key has none (t returns the key itself).
function label(t, key, fallback) {
  const text = t(key);
  return text === key ? fallback : text;
}

function pct(fmt, value) {
  return value == null ? '–' : fmt.percent(value);
}

function routeName(fmt, r) {
  return `${r.from_city} → ${r.to_city}`;
}

function routeCountries(fmt, r) {
  return `${fmt.country(r.from_country)} → ${fmt.country(r.to_country)}`;
}

// `rpc` is the database function the page reads (staff_metrics or staff_kpis); `demoKey` the
// matching sample in the dev-only preview data.
function useStaffMetrics(demo, reload, onFetching, rpc, demoKey) {
  const { t } = useI18n();
  const { year, month, setPeriod } = usePeriod();
  const [metrics, setMetrics] = useState(null);
  const [years, setYears] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (demo) {
      setMetrics(demo[demoKey](year, month));
      setYears(demo.years());
      return;
    }
    onFetching(true);
    const [metricsRes, statsRes] = await Promise.all([
      supabase.rpc(rpc, { p_year: year, p_month: month }),
      // Only for the years the filter offers.
      years.length ? Promise.resolve({ data: null }) : supabase.rpc('dashboard_stats', {}),
    ]);
    onFetching(false);
    if (metricsRes.error) {
      setError(metricsRes.error.code === 'PGRST202' ? t('metrics.errors.notInstalled') : t('dashboard.errors.loadFailed'));
      return;
    }
    setMetrics(metricsRes.data);
    if (statsRes.data?.years_available) setYears(statsRes.data.years_available);
  }, [demo, year, month, onFetching, t, years.length, rpc, demoKey]);

  useEffect(() => {
    load();
  }, [load, reload]);

  return { metrics, error, year, month, setPeriod, years };
}

function MetricsPage({ titleKey, demo, children, rpc = 'staff_metrics', demoKey = 'metrics' }) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  const [fetching, setFetching] = useState(false);
  return (
    <StaffPage
      demo={Boolean(demo)}
      title={t(titleKey)}
      actions={
        <button type="button" className="btn-secondary btn-small" onClick={() => setReload((n) => n + 1)} disabled={fetching}>
          {fetching ? t('dashboard.refreshing') : t('dashboard.refresh')}
        </button>
      }
    >
      {/* Loads only once StaffPage has let a staff member through. */}
      <MetricsBody demo={demo} reload={reload} fetching={fetching} onFetching={setFetching} rpc={rpc} demoKey={demoKey}>
        {children}
      </MetricsBody>
    </StaffPage>
  );
}

function MetricsBody({ demo, reload, fetching, onFetching, rpc, demoKey, children }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const data = useStaffMetrics(demo, reload, onFetching, rpc, demoKey);
  const periodName = !data.year
    ? t('metrics.allTime')
    : data.month
      ? fmt.monthLong(`${data.year}-${String(data.month).padStart(2, '0')}`)
      : String(data.year);

  return (
    <>
      {data.metrics && (
        <p className="dash-updated">
          {t('dashboard.updated')} {fmt.dateTime(data.metrics.generated_at)}
        </p>
      )}
      <PeriodFilter years={data.years} year={data.year} month={data.month} onChange={data.setPeriod} fmt={fmt} t={t} />
      {data.error && (
        <p className="auth-error" role="alert">
          {data.error}
        </p>
      )}
      {!data.metrics && !data.error && <p className="dash-loading">{t('dashboard.loading')}</p>}
      {data.metrics && (
        <div className={`dash-body${fetching ? ' is-fetching' : ''}`}>
          {children({ m: data.metrics, fmt, t, periodName, reload, allTime: !data.year })}
        </div>
      )}
    </>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// columns: [{ key, label, align?, render(row) }]
function Table({ columns, rows, empty }) {
  if (!rows?.length) return <p className="empty-note">{empty}</p>;
  return (
    <div className="table-scroll">
      <table className="dash-table metrics-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Marketplace: funnel, supply and demand ──────────────────────────────────

const FUNNEL_STEPS = [
  { key: 'requested', time: null },
  { key: 'accepted', time: 'to_accept' },
  { key: 'paid', time: 'to_pay' },
  { key: 'picked_up', time: 'to_pickup' },
  { key: 'delivered', time: 'to_deliver' },
];

function Funnel({ f, fmt, t, steps = FUNNEL_STEPS }) {
  const top = Math.max(f.requested, 1);
  return (
    <ol className="funnel">
      {steps.map((s, i) => {
        const n = f[s.key];
        const prev = i ? f[steps[i - 1].key] : null;
        const lost = prev != null ? prev - n : null;
        return (
          <li key={s.key}>
            <div className="funnel-head">
              <b>{t(`metrics.funnel.steps.${s.key}`)}</b>
              <span className="funnel-count">{fmt.number(n)}</span>
            </div>
            <span className="funnel-track">
              <span style={{ width: `${(n / top) * 100}%` }} />
            </span>
            <div className="funnel-meta">
              <span>{t('metrics.funnel.ofRequests').replace('{p}', pct(fmt, ratio(n, f.requested)))}</span>
              {lost != null && lost > 0 && (
                <span className="funnel-drop">
                  {t('metrics.funnel.lost')
                    .replace('{n}', fmt.number(lost))
                    .replace('{p}', pct(fmt, ratio(lost, prev)))}
                </span>
              )}
              {s.time && f.median_hours?.[s.time] != null && (
                <span>{t('metrics.funnel.median').replace('{d}', hours(fmt, t, Number(f.median_hours[s.time])))}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Every figure here is by item: a request sent to several travelers, or a parcel posted on the
// Parcel Market, counts once. One item ends with one traveler.
export function MarketplacePage({ demo = null }) {
  return (
    <MetricsPage titleKey="metrics.marketplace.title" demo={demo}>
      {({ m, fmt, t, periodName, allTime }) => {
        const f = m.funnel;
        const mk = m.market;
        const r = m.routes;
        const cancelled = f.cancelled_by_sender + f.cancelled_by_traveler;
        const routeCol = {
          key: 'route',
          label: t('metrics.routes.route'),
          render: (row) => (
            <span className="route-cell">
              <b>{routeName(fmt, row)}</b>
              <small>{routeCountries(fmt, row)}</small>
            </span>
          ),
        };
        return (
          <>
            <h2 className="dash-section-title">{t('metrics.funnel.title')}</h2>
            <section className="stat-grid stat-grid-4">
              <StatTile
                icon="check"
                label={t('metrics.funnel.acceptance')}
                value={pct(fmt, ratio(f.accepted, f.requested))}
                detail={t('metrics.funnel.acceptanceDetail').replace('{n}', fmt.number(f.accepted)).replace('{total}', fmt.number(f.requested))}
              />
              <StatTile
                icon="bell"
                label={t('metrics.funnel.noTraveler')}
                value={pct(fmt, ratio(f.no_traveler, f.requested))}
                detail={t('metrics.funnel.noTravelerDetail').replace('{n}', fmt.number(f.no_traveler))}
              />
              <StatTile
                icon="card"
                label={t('metrics.funnel.unpaid')}
                value={pct(fmt, ratio(f.unpaid, f.accepted))}
                detail={t('metrics.funnel.unpaidDetail').replace('{n}', fmt.number(f.unpaid))}
              />
              <StatTile
                icon="close"
                label={t('metrics.funnel.cancelled')}
                value={pct(fmt, ratio(cancelled, f.requested))}
                detail={t('metrics.funnel.cancelledDetail')
                  .replace('{sender}', fmt.number(f.cancelled_by_sender))
                  .replace('{traveler}', fmt.number(f.cancelled_by_traveler))}
              />
            </section>
            <Card
              title={t('metrics.funnel.chartTitle')}
              subtitle={t(allTime ? 'metrics.funnel.chartSubtitleAll' : 'metrics.funnel.chartSubtitle')
                .replace('{period}', periodName)
                .replace('{open}', fmt.number(f.open))}
            >
              {f.requested ? <Funnel f={f} fmt={fmt} t={t} /> : <p className="empty-note">{t('dashboard.empty')}</p>}
              {f.requested > 0 && (
                <p className="metrics-note">
                  {t('metrics.funnel.howSent')
                    .replace('{posted}', fmt.number(f.posted))
                    .replace('{multi}', fmt.number(f.multi_sent))
                    .replace('{found}', fmt.number(f.item_found))}
                </p>
              )}
            </Card>

            <h2 className="dash-section-title">{t('metrics.market.title')}</h2>
            <section className="stat-grid stat-grid-4">
              <StatTile
                icon="box"
                label={t('metrics.market.listed')}
                value={fmt.number(mk.listed)}
                detail={t('metrics.market.listedDetail')
                  .replace('{posted}', fmt.number(mk.posted))
                  .replace('{requests}', fmt.number(mk.requests_listed))}
              />
              <StatTile
                icon="check"
                label={t('metrics.market.found')}
                value={pct(fmt, ratio(mk.found, mk.listed))}
                detail={t('metrics.market.foundDetail')
                  .replace('{n}', fmt.number(mk.found))
                  .replace('{offer}', fmt.number(mk.with_offer))
                  .replace('{d}', hours(fmt, t, mk.hours_to_first_offer))}
              />
              <StatTile
                icon="plane"
                label={t('metrics.market.offers')}
                value={fmt.number(mk.offers)}
                detail={t('metrics.market.offersDetail')
                  .replace('{accepted}', fmt.number(mk.offers_accepted))
                  .replace('{declined}', fmt.number(mk.offers_declined))
                  .replace('{withdrawn}', fmt.number(mk.offers_withdrawn))
                  .replace('{pending}', fmt.number(mk.offers_pending))}
              />
              <StatTile
                icon="bell"
                label={t('metrics.market.now')}
                value={fmt.number(mk.on_market_now)}
                detail={t('metrics.market.nowDetail').replace('{n}', fmt.number(mk.without_offer_now))}
              />
            </section>

            <h2 className="dash-section-title">{t('metrics.routes.title')}</h2>
            <section className="stat-grid stat-grid-4">
              <StatTile
                icon="plane"
                label={t('metrics.routes.activeTravelers')}
                value={fmt.number(r.active_travelers_30d)}
                detail={t('metrics.routes.travelers30')}
              />
              <StatTile
                icon="send"
                label={t('metrics.routes.activeSenders')}
                value={fmt.number(r.active_senders_30d)}
                detail={t('metrics.routes.senders30')}
              />
              <StatTile
                icon="bell"
                label={t('metrics.routes.unmatched')}
                value={fmt.number(r.alerts_unmatched)}
                detail={t('metrics.routes.unmatchedDetail').replace('{total}', fmt.number(r.alerts_total))}
              />
              <StatTile
                icon="box"
                label={t('metrics.routes.parcelAlerts')}
                value={fmt.number(r.parcel_alerts_total)}
                detail={t('metrics.routes.parcelAlertsDetail').replace('{n}', fmt.number(r.parcel_alerts_matched))}
              />
            </section>
            <div className="dash-two">
              <Card title={t('metrics.routes.byRequests')} subtitle={t('metrics.routes.byRequestsSubtitle')}>
                <Table
                  empty={t('dashboard.empty')}
                  rows={r.by_requests}
                  columns={[
                    routeCol,
                    { key: 'req', label: t('metrics.routes.requests'), align: 'right', render: (row) => fmt.number(row.requests) },
                    { key: 'wait', label: t('metrics.routes.waiting'), align: 'right', render: (row) => fmt.number(row.waiting) },
                    { key: 'del', label: t('metrics.routes.delivered'), align: 'right', render: (row) => fmt.number(row.delivered) },
                    {
                      key: 'live',
                      label: t('metrics.routes.liveTrips'),
                      align: 'right',
                      render: (row) =>
                        row.live_trips ? (
                          fmt.number(row.live_trips)
                        ) : (
                          <span className="pill pill-coral">{t('routes.noTrips')}</span>
                        ),
                    },
                  ]}
                />
              </Card>
              <Card title={t('metrics.routes.byTrips')} subtitle={t('metrics.routes.byTripsSubtitle')}>
                <Table
                  empty={t('dashboard.empty')}
                  rows={r.by_trips}
                  columns={[
                    routeCol,
                    { key: 'trips', label: t('metrics.routes.trips'), align: 'right', render: (row) => fmt.number(row.trips) },
                    { key: 'req', label: t('metrics.routes.requests'), align: 'right', render: (row) => fmt.number(row.requests) },
                  ]}
                />
              </Card>
            </div>
          </>
        );
      }}
    </MetricsPage>
  );
}

// ── Money: connection fees, payments, refunds, provider balances ───────────
// Nata's money is the flat fee a sender pays for each traveler who accepts. The delivery itself is
// paid between sender and traveler, so there is no escrow and nothing to pay out.

function useFloat(demo, reload) {
  const [float, setFloat] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      if (demo) {
        setFloat(demo.float());
        return;
      }
      const { data, error: err } = await supabase.functions.invoke('staff-float', { method: 'GET' });
      if (cancelled) return;
      if (err) {
        setFloat(null);
        setError('unavailable');
        return;
      }
      setFloat(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, reload]);
  return { float, error };
}

function BalanceTable({ float, floatError, fmt, t }) {
  const rows = {};
  const add = (cur) => (rows[cur] ??= { currency: cur, stripe: null, pawapay: null });
  (float?.stripe?.available ?? []).forEach((b) => {
    add(b.currency).stripe = (rows[b.currency].stripe ?? 0) + b.amount;
  });
  (float?.pawapay?.balances ?? []).forEach((b) => {
    if (b.currency) add(b.currency).pawapay = (rows[b.currency].pawapay ?? 0) + b.amount;
  });
  const list = Object.values(rows).sort((a, b) => a.currency.localeCompare(b.currency));
  const money = (v, cur) => (v == null ? '–' : fmt.money(v, cur));

  return (
    <>
      {floatError && <p className="metrics-note">{t('metrics.money.floatUnavailable')}</p>}
      {float?.stripe?.error && (
        <p className="metrics-note">{t('metrics.money.providerError').replace('{p}', 'Stripe').replace('{e}', float.stripe.error)}</p>
      )}
      {float?.pawapay?.error && (
        <p className="metrics-note">{t('metrics.money.providerError').replace('{p}', 'pawaPay').replace('{e}', float.pawapay.error)}</p>
      )}
      {(float?.stripe?.mode === 'test' || float?.pawapay?.mode === 'sandbox') && (
        <p className="metrics-note">{t('metrics.money.testMode')}</p>
      )}
      <Table
        empty={floatError ? '' : t('dashboard.empty')}
        rows={list}
        columns={[
          { key: 'cur', label: t('metrics.money.currency'), render: (r) => <b>{r.currency}</b> },
          { key: 'stripe', label: t('metrics.money.stripe'), align: 'right', render: (r) => money(r.stripe, r.currency) },
          { key: 'pawapay', label: t('metrics.money.pawapay'), align: 'right', render: (r) => money(r.pawapay, r.currency) },
        ]}
      />
    </>
  );
}

const PROVIDERS = { stripe: 'Stripe', pawapay: 'pawaPay', flutterwave: 'Flutterwave' };
const METHOD_KEYS = { card: 'card', apple_pay: 'applePay', google_pay: 'googlePay', mobile_money: 'mobileMoney', bank_transfer: 'bankTransfer' };

export function MoneyPage({ demo = null }) {
  return (
    <MetricsPage titleKey="metrics.money.title" demo={demo}>
      {({ m, fmt, t, periodName, reload, allTime }) => (
        <MoneyContent m={m} fmt={fmt} t={t} periodName={periodName} allTime={allTime} demo={demo} reload={reload} />
      )}
    </MetricsPage>
  );
}

function MoneyContent({ m, fmt, t, periodName, allTime, demo, reload }) {
  const { float, error: floatError } = useFloat(demo, reload);
  const p = m.payments;
  const h = m.health;
  const period = allTime ? t('metrics.allTime') : periodName;
  const methodName = (row) =>
    `${t(`metrics.money.methods.${METHOD_KEYS[row.method] ?? 'other'}`)} · ${PROVIDERS[row.provider] ?? row.provider}`;

  return (
    <>
      <h2 className="dash-section-title">{t('metrics.money.feesTitle')}</h2>
      <p className="kpi-intro">{t('metrics.money.feesIntro')}</p>
      <section className="stat-grid stat-grid-4">
        <StatTile
          icon="card"
          label={t('metrics.money.feesPaid')}
          value={fmt.usd(Number(p.fees_usd))}
          detail={t('metrics.money.feesPaidDetail').replace('{n}', fmt.number(p.fees_paid)).replace('{period}', period)}
        />
        <StatTile
          icon="bank"
          label={t('metrics.money.kept')}
          value={fmt.usd(Number(p.fees_kept_usd))}
          detail={t('metrics.money.keptDetail')}
        />
        <StatTile
          icon="shield"
          label={t('metrics.health.refundable')}
          value={fmt.usd(Number(h.refundable_usd))}
          detail={t('metrics.health.refundableDetail').replace('{n}', fmt.number(h.refundable_count))}
        />
        <StatTile
          icon="back"
          label={t('metrics.money.refunds')}
          value={fmt.usd(Number(p.refunds.amount_usd))}
          detail={t('metrics.money.refundsDetail')
            .replace('{n}', fmt.number(p.refunds.count))
            .replace('{failed}', fmt.number(p.refunds.failed))
            .replace('{waiting}', fmt.number(p.refunds.waiting))}
        />
      </section>

      <div className="dash-two">
        <Card title={t('metrics.money.byCurrency')} subtitle={t('metrics.money.byCurrencySubtitle').replace('{period}', period)}>
          <Table
            empty={t('dashboard.empty')}
            rows={p.fees_by_currency}
            columns={[
              { key: 'c', label: t('metrics.money.currency'), render: (r) => <b>{r.currency}</b> },
              { key: 'n', label: t('metrics.money.count'), align: 'right', render: (r) => fmt.number(r.count) },
              { key: 'k', label: t('metrics.money.keptCol'), align: 'right', render: (r) => fmt.money(Number(r.kept), r.currency) },
              { key: 'r', label: t('metrics.money.refundableCol'), align: 'right', render: (r) => fmt.money(Number(r.refundable), r.currency) },
              { key: 'u', label: t('kpis.inUsd'), align: 'right', render: (r) => <b>{fmt.usd(Number(r.usd))}</b> },
            ]}
          />
        </Card>
        <Card title={t('metrics.money.floatTitle')} subtitle={t('metrics.money.floatSubtitle')}>
          <BalanceTable float={float} floatError={floatError} fmt={fmt} t={t} />
        </Card>
      </div>

      <h2 className="dash-section-title">{t('metrics.money.paymentsTitle')}</h2>
      <p className="kpi-intro">
        {t('metrics.money.paymentsIntro')
          .replace('{n}', fmt.number(p.attempts))
          .replace('{failed}', fmt.number(p.failed))
          .replace('{stuck}', fmt.number(p.stuck))}
      </p>
      <div className="dash-two">
        <Card
          title={t('metrics.money.byMethod')}
          subtitle={allTime ? t('metrics.money.byMethodSubtitleAll') : t('metrics.money.byMethodSubtitle').replace('{period}', periodName)}
        >
          <Table
            empty={t('dashboard.empty')}
            rows={p.by_method}
            columns={[
              { key: 'm', label: t('metrics.money.method'), render: (r) => <b>{methodName(r)}</b> },
              { key: 'a', label: t('metrics.money.attempts'), align: 'right', render: (r) => fmt.number(r.attempts) },
              { key: 'f', label: t('metrics.money.failed'), align: 'right', render: (r) => fmt.number(r.failed) },
              { key: 'p', label: t('metrics.money.pending'), align: 'right', render: (r) => fmt.number(r.pending) },
              { key: 'r', label: t('metrics.money.successRate'), align: 'right', render: (r) => <b>{pct(fmt, ratio(r.succeeded, r.attempts))}</b> },
            ]}
          />
        </Card>
        <Card title={t('metrics.money.mobileMoney')} subtitle={t('metrics.money.mobileMoneySubtitle')}>
          <Table
            empty={t('dashboard.empty')}
            rows={p.mobile_money}
            columns={[
              { key: 'c', label: t('metrics.money.country'), render: (r) => (r.country === '??' ? '–' : fmt.country(r.country)) },
              { key: 'n', label: t('metrics.money.network'), render: (r) => <span className="mono">{r.network === '?' ? '–' : r.network}</span> },
              { key: 'a', label: t('metrics.money.attempts'), align: 'right', render: (r) => fmt.number(r.attempts) },
              { key: 'r', label: t('metrics.money.successRate'), align: 'right', render: (r) => <b>{pct(fmt, ratio(r.succeeded, r.attempts))}</b> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

// ── Trust and growth ────────────────────────────────────────────────────────

export function TrustGrowthPage({ demo = null }) {
  return (
    <MetricsPage titleKey="metrics.trust.pageTitle" demo={demo}>
      {({ m, fmt, t }) => {
        const tr = m.trust;
        const iv = tr.identity;
        const tk = tr.tickets;
        const cf = tr.confirmations;
        const g = m.growth;
        const rs = g.repeat_senders;
        const rt = g.repeat_travelers;
        const reports = tr.problems + tr.chat_reports;
        return (
          <>
            <h2 className="dash-section-title">{t('metrics.trust.title')}</h2>
            <section className="stat-grid">
              <StatTile
                icon="flag"
                label={t('metrics.trust.reports')}
                value={tr.deliveries ? fmt.number(Math.round((reports / tr.deliveries) * 1000) / 10) : '–'}
                detail={t('metrics.trust.reportsDetail')
                  .replace('{p}', fmt.number(tr.problems))
                  .replace('{c}', fmt.number(tr.chat_reports))
                  .replace('{open}', fmt.number(tr.reports_open))
                  .replace('{age}', hours(fmt, t, tr.reports_oldest_open_hours))}
              />
              <StatTile
                icon="star"
                label={t('metrics.trust.rating')}
                value={tr.traveler_rating != null ? `${fmt.number(Number(tr.traveler_rating))} ★` : '–'}
                detail={t('metrics.trust.ratingDetail')
                  .replace('{p}', pct(fmt, ratio(tr.delivered_reviewed, tr.deliveries)))
                  .replace('{n}', fmt.number(tr.traveler_reviews))}
              />
              <StatTile
                icon="check"
                label={t('metrics.trust.confirmed')}
                value={pct(fmt, ratio(cf.by_sender, cf.delivered))}
                detail={t('metrics.trust.confirmedDetail')
                  .replace('{traveler}', fmt.number(cf.by_traveler_only))
                  .replace('{late}', fmt.number(tr.unconfirmed))}
              />
              <StatTile
                icon="badge"
                label={t('metrics.trust.identity')}
                value={pct(fmt, ratio(iv.passed, iv.passed + iv.rejected))}
                detail={t('metrics.trust.identityDetail')
                  .replace('{n}', fmt.number(iv.waiting))
                  .replace('{age}', hours(fmt, t, iv.oldest_waiting_hours))
                  .replace('{median}', hours(fmt, t, iv.median_hours_to_decide))}
              />
              <StatTile
                icon="plane"
                label={t('metrics.trust.tickets')}
                value={fmt.number(tk.waiting)}
                detail={tk.waiting ? t('metrics.trust.ticketsDetail').replace('{age}', hours(fmt, t, tk.oldest_waiting_hours)) : t('kpis.nothingWaiting')}
              />
            </section>

            <h2 className="dash-section-title">{t('metrics.growth.title')}</h2>
            <section className="stat-grid stat-grid-4">
              <StatTile icon="user" label={t('metrics.growth.signups')} value={fmt.number(g.signups)} detail={t('metrics.growth.signupsDetail')} />
              <StatTile
                icon="badge"
                label={t('metrics.growth.verified')}
                value={pct(fmt, ratio(g.signups_verified, g.signups))}
                detail={t('metrics.growth.ofSignups').replace('{n}', fmt.number(g.signups_verified))}
              />
              <StatTile
                icon="plane"
                label={t('metrics.growth.firstTrip')}
                value={pct(fmt, ratio(g.signups_posted_trip, g.signups))}
                detail={t('metrics.growth.ofSignups').replace('{n}', fmt.number(g.signups_posted_trip))}
              />
              <StatTile
                icon="send"
                label={t('metrics.growth.firstRequest')}
                value={pct(fmt, ratio(g.signups_sent_request, g.signups))}
                detail={t('metrics.growth.ofSignups').replace('{n}', fmt.number(g.signups_sent_request))}
              />
            </section>

            <div className="dash-two">
              <Card title={t('metrics.growth.weeklyTitle')} subtitle={t('metrics.growth.weeklySubtitle')}>
                <SeriesChart
                  series={{ unit: 'week', points: g.signups_by_week }}
                  measure="count"
                  fmt={fmt}
                  t={t}
                  title={t('metrics.growth.weeklyTitle')}
                  detail={(w) =>
                    t('metrics.growth.weekDetail')
                      .replace('{v}', fmt.number(w.verified))
                      .replace('{trip}', fmt.number(w.posted_trip))
                      .replace('{req}', fmt.number(w.sent_request))
                  }
                />
              </Card>
              <Card title={t('metrics.growth.repeatTitle')} subtitle={t('metrics.growth.repeatSubtitle')}>
                <div className="repeat-grid">
                  {[
                    { key: 'senders', r: rs },
                    { key: 'travelers', r: rt },
                  ].map(({ key, r }) => (
                    <div key={key} className="repeat-item">
                      <span>{t(`metrics.growth.repeat.${key}`)}</span>
                      <b>{pct(fmt, ratio(r.repeat_60d, r.with_delivery))}</b>
                      <p>
                        {t('metrics.growth.repeatDetail')
                          .replace('{n}', fmt.number(r.repeat_60d))
                          .replace('{total}', fmt.number(r.with_delivery))
                          .replace('{eligible}', fmt.number(r.eligible))}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        );
      }}
    </MetricsPage>
  );
}

// ── Key metrics: management, growth, operations, product ────────────────────

const KPI_FUNNEL_STEPS = [...FUNNEL_STEPS.map((s) => ({ ...s, time: null })), { key: 'reviewed', time: null }];
const STAGES = ['pending', 'accepted', 'paid', 'picked_up'];

// Share of `part` in `whole` with the counts underneath ("3 of 12").
function ofTotal(fmt, t, part, whole) {
  return t('kpis.ofTotal').replace('{n}', fmt.number(part)).replace('{total}', fmt.number(whole));
}

// Repeat within 90 days, over the people whose first time is at least 90 days ago when there are
// any (everyone else hasn't had 90 days yet), else over everyone so far.
function repeatRate(r) {
  return r.eligible > 0 ? ratio(r.eligible_repeat, r.eligible) : ratio(r.repeat, r.people);
}

function corridorSignal(row, t) {
  if (row.demand > 0 && row.live_trips === 0) return <span className="pill pill-coral">{t('kpis.corridors.recruitTravelers')}</span>;
  if (row.demand === 0 && row.live_trips > 0) return <span className="pill pill-muted">{t('kpis.corridors.findSenders')}</span>;
  if (row.demand > row.live_trips * 2) return <span className="pill pill-coral">{t('kpis.corridors.shortOfTravelers')}</span>;
  return <span className="pill pill-teal">{t('kpis.corridors.balanced')}</span>;
}

export function KeyMetricsPage({ demo = null }) {
  return (
    <MetricsPage titleKey="kpis.title" demo={demo} rpc="staff_kpis" demoKey="kpis">
      {({ m, fmt, t, periodName, allTime }) => <KeyMetricsContent k={m} fmt={fmt} t={t} periodName={periodName} allTime={allTime} />}
    </MetricsPage>
  );
}

function KeyMetricsContent({ k, fmt, t, periodName, allTime }) {
  const mg = k.management;
  const gr = k.growth;
  const op = k.operations;
  const pr = k.product;
  const period = allTime ? t('kpis.allTime') : periodName;
  const routeCol = {
    key: 'route',
    label: t('kpis.corridor'),
    render: (row) => (
      <span className="route-cell">
        <b>{routeName(fmt, row)}</b>
        <small>{routeCountries(fmt, row)}</small>
      </span>
    ),
  };
  const country = (c) => (c === '??' ? t('dashboard.countries.notSet') : fmt.country(c));
  const matchDecided = mg.match.groups - mg.match.waiting;
  const reconciled = mg.connections === mg.paid_requests;
  const safety = mg.safety;
  const id = op.identity;
  const sp = op.support;
  const ho = op.handover;
  const times = pr.times;
  const ratings = pr.ratings;

  return (
    <>
      {/* ── 1. Management ── */}
      <h2 className="dash-section-title">{t('kpis.management.title')}</h2>
      <p className="kpi-intro">{t('kpis.management.intro')}</p>
      <section className="stat-grid stat-grid-4">
        <StatTile
          icon="card"
          label={t('kpis.revenue.label')}
          value={fmt.usd(Number(mg.revenue_usd))}
          detail={t('kpis.revenue.detail')
            .replace('{period}', period)
            .replace('{n}', fmt.number(mg.connections))
            .replace('{kept}', fmt.usd(Number(mg.revenue_kept_usd ?? mg.revenue_usd)))
            .replace('{refundable}', fmt.usd(Number(mg.revenue_refundable_usd ?? 0)))}
        />
        <StatTile
          icon="check"
          label={t('kpis.connections.label')}
          value={fmt.number(mg.connections)}
          detail={
            (reconciled ? t('kpis.connections.reconciled') : t('kpis.connections.mismatch'))
              .replace('{paid}', fmt.number(mg.paid_requests))
              .replace('{list}', fmt.usd(Number(mg.list_usd)))
              .replace('{refunded}', fmt.number(mg.refunded_connections))
          }
        />
        <StatTile
          icon="scale"
          label={t('kpis.match.label')}
          value={pct(fmt, ratio(mg.match.matched, matchDecided))}
          detail={t('kpis.match.detail')
            .replace('{n}', fmt.number(mg.match.matched))
            .replace('{total}', fmt.number(matchDecided))
            .replace('{waiting}', fmt.number(mg.match.waiting))
            .replace('{posted}', fmt.number(mg.match.posted ?? 0))
            .replace('{market}', fmt.number(mg.match.via_market ?? 0))
            .replace('{req}', pct(fmt, ratio(mg.match.requests_accepted, mg.match.requests)))}
        />
        <StatTile
          icon="flag"
          label={t('kpis.safety.label')}
          value={safety.deliveries ? fmt.number(Math.round((safety.problems / safety.deliveries) * 1000) / 10) : '–'}
          detail={t('kpis.safety.detail')
            .replace('{n}', fmt.number(safety.problems))
            .replace('{resolved}', fmt.number(safety.problems_resolved))
            .replace('{deliveries}', fmt.number(safety.deliveries))
            .replace('{chat}', fmt.number(safety.chat_reports))}
        />
      </section>

      <div className="dash-two">
        <Card title={t('kpis.revenue.weekly')} subtitle={t('kpis.revenue.weeklySubtitle')}>
          <SeriesChart
            series={{ unit: 'week', points: mg.revenue_by_week }}
            measure="revenue"
            fmt={fmt}
            t={t}
            title={t('kpis.revenue.weekly')}
            detail={(w) => t('kpis.revenue.pointDetail').replace('{n}', fmt.number(w.count))}
          />
        </Card>
        <Card title={t('kpis.revenue.monthly')} subtitle={t('kpis.revenue.monthlySubtitle')}>
          <SeriesChart
            series={{ unit: 'month', points: mg.revenue_by_month }}
            measure="revenue"
            fmt={fmt}
            t={t}
            title={t('kpis.revenue.monthly')}
            detail={(w) => t('kpis.revenue.pointDetail').replace('{n}', fmt.number(w.count))}
          />
        </Card>
      </div>

      <div className="dash-two">
        <Card title={t('kpis.revenue.byCurrency')} subtitle={t('kpis.revenue.byCurrencySubtitle').replace('{period}', period)}>
          <Table
            empty={t('dashboard.empty')}
            rows={mg.revenue_by_currency}
            columns={[
              { key: 'c', label: t('metrics.money.currency'), render: (r) => <b>{r.currency}</b> },
              { key: 'n', label: t('kpis.connectionsCol'), align: 'right', render: (r) => fmt.number(r.count) },
              { key: 'a', label: t('kpis.collected'), align: 'right', render: (r) => fmt.money(Number(r.amount), r.currency) },
              { key: 'u', label: t('kpis.inUsd'), align: 'right', render: (r) => <b>{fmt.usd(Number(r.usd))}</b> },
            ]}
          />
        </Card>
        <Card title={t('kpis.revenue.byCorridor')} subtitle={t('kpis.revenue.byCorridorSubtitle').replace('{period}', period)}>
          <Table
            empty={t('dashboard.empty')}
            rows={mg.revenue_by_corridor}
            columns={[
              routeCol,
              { key: 'n', label: t('kpis.connectionsCol'), align: 'right', render: (r) => fmt.number(r.count) },
              { key: 'u', label: t('kpis.inUsd'), align: 'right', render: (r) => <b>{fmt.usd(Number(r.usd))}</b> },
            ]}
          />
        </Card>
      </div>

      <Card title={t('kpis.corridors.title')} subtitle={t('kpis.corridors.subtitle')}>
        <Table
          empty={t('dashboard.empty')}
          rows={mg.corridors}
          columns={[
            routeCol,
            { key: 'lt', label: t('kpis.corridors.liveTrips'), align: 'right', render: (r) => fmt.number(r.live_trips) },
            { key: 'or', label: t('kpis.corridors.openRequests'), align: 'right', render: (r) => fmt.number(r.open_requests) },
            { key: 'al', label: t('kpis.corridors.alerts'), align: 'right', render: (r) => fmt.number(r.alerts) },
            { key: 's', label: t('kpis.corridors.signal'), render: (r) => corridorSignal(r, t) },
          ]}
        />
      </Card>

      <Card title={t('kpis.repeat.title')} subtitle={t('kpis.repeat.subtitle')}>
        <div className="repeat-grid">
          {[
            { key: 'senders', r: mg.repeat_senders },
            { key: 'travelers', r: mg.repeat_travelers },
          ].map(({ key, r }) => (
            <div key={key} className="repeat-item">
              <span>{t(`kpis.repeat.${key}`)}</span>
              <b>{pct(fmt, repeatRate(r))}</b>
              <p>
                {(r.eligible > 0 ? t('kpis.repeat.detailEligible') : t('kpis.repeat.detailEarly'))
                  .replace('{n}', fmt.number(r.eligible > 0 ? r.eligible_repeat : r.repeat))
                  .replace('{total}', fmt.number(r.eligible > 0 ? r.eligible : r.people))}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── 2. Growth and marketing ── */}
      <h2 className="dash-section-title">{t('kpis.growth.title')}</h2>
      <section className="stat-grid stat-grid-4">
        <StatTile icon="user" label={t('kpis.growth.signups')} value={fmt.number(gr.signups)} detail={t('kpis.growth.signupsDetail').replace('{period}', period)} />
        <StatTile
          icon="badge"
          label={t('kpis.growth.verified')}
          value={pct(fmt, ratio(gr.verified, gr.signups))}
          detail={ofTotal(fmt, t, gr.verified, gr.signups)}
        />
        <StatTile
          icon="send"
          label={t('kpis.growth.activated')}
          value={pct(fmt, ratio(gr.active, gr.signups))}
          detail={t('kpis.growth.activatedDetail')
            .replace('{trip}', fmt.number(gr.posted_trip))
            .replace('{req}', fmt.number(gr.sent_request))}
        />
        <StatTile
          icon="bell"
          label={t('kpis.alerts.label')}
          value={pct(fmt, ratio(gr.alerts.led_to_request, gr.alerts.sent))}
          detail={t('kpis.alerts.detail')
            .replace('{saved}', fmt.number(gr.alerts.saved))
            .replace('{sent}', fmt.number(gr.alerts.sent))
            .replace('{led}', fmt.number(gr.alerts.led_to_request))
            .replace('{parcel}', fmt.number(gr.alerts.parcel_active ?? 0))
            .replace('{parcelSent}', fmt.number(gr.alerts.parcel_sent ?? 0))}
        />
      </section>

      <div className="dash-two">
        <Card title={t('kpis.funnel.title')} subtitle={t('kpis.funnel.subtitle').replace('{period}', period)}>
          {gr.funnel.requested ? (
            <Funnel f={gr.funnel} fmt={fmt} t={t} steps={KPI_FUNNEL_STEPS} />
          ) : (
            <p className="empty-note">{t('dashboard.empty')}</p>
          )}
        </Card>
        <Card title={t('kpis.acquisition.title')} subtitle={t('kpis.acquisition.subtitle').replace('{period}', period)}>
          <Table
            empty={t('dashboard.empty')}
            rows={gr.by_country}
            columns={[
              { key: 'c', label: t('metrics.money.country'), render: (r) => <b>{country(r.country)}</b> },
              { key: 's', label: t('kpis.acquisition.signups'), align: 'right', render: (r) => fmt.number(r.signups) },
              { key: 'v', label: t('kpis.acquisition.verified'), align: 'right', render: (r) => fmt.number(r.verified) },
              { key: 'a', label: t('kpis.acquisition.active'), align: 'right', render: (r) => fmt.number(r.active) },
              { key: 'p', label: t('kpis.acquisition.paying'), align: 'right', render: (r) => fmt.number(r.paying) },
              { key: 'r', label: t('kpis.acquisition.revenue'), align: 'right', render: (r) => <b>{fmt.usd(Number(r.revenue_usd))}</b> },
            ]}
          />
        </Card>
      </div>

      {/* ── 3. Operations and support ── */}
      <h2 className="dash-section-title">{t('kpis.ops.title')}</h2>
      <section className="stat-grid stat-grid-4">
        <StatTile
          icon="badge"
          label={t('kpis.identity.timeToVerified')}
          value={hours(fmt, t, id.median_hours_to_verified)}
          detail={t('kpis.identity.timeDetail').replace('{n}', fmt.number(id.verified))}
        />
        <StatTile
          icon="eye"
          label={t('kpis.identity.faceMatch')}
          value={pct(fmt, ratio(id.face_passed, id.face_checked))}
          detail={t('kpis.identity.faceDetail')
            .replace('{n}', fmt.number(id.face_passed))
            .replace('{total}', fmt.number(id.face_checked))
            .replace('{noScore}', fmt.number(id.face_no_score))
            .replace('{team}', fmt.number(id.approved_by_team))}
        />
        <StatTile
          icon="shield"
          label={t('kpis.identity.waiting')}
          value={fmt.number(id.waiting)}
          detail={id.waiting ? t('kpis.oldest').replace('{age}', hours(fmt, t, id.oldest_waiting_hours)) : t('kpis.nothingWaiting')}
        />
        <StatTile
          icon="pin"
          label={t('kpis.handover.label')}
          value={pct(fmt, ratio(ho.with_pickup_photo, ho.deliveries))}
          detail={t('kpis.handover.detail')
            .replace('{n}', fmt.number(ho.with_pickup_photo))
            .replace('{total}', fmt.number(ho.deliveries))
            .replace('{sender}', pct(fmt, ratio(ho.picked_up_with_sender_photo, ho.picked_up)))}
        />
      </section>

      <div className="dash-two">
        <Card title={t('kpis.support.title')} subtitle={t('kpis.support.subtitle')}>
          <Table
            empty={t('dashboard.empty')}
            rows={[
              { key: 'problems', open: sp.problems_open, oldest: sp.problems_oldest_hours, first: sp.problems_first_action_hours, done: sp.problems_resolution_hours },
              { key: 'reports', open: sp.reports_open, oldest: sp.reports_oldest_hours, first: sp.reports_review_hours, done: sp.reports_review_hours },
              { key: 'idReviews', open: sp.id_reviews_open, oldest: sp.id_reviews_oldest_hours, first: sp.id_reviews_decision_hours, done: sp.id_reviews_decision_hours },
            ]}
            columns={[
              { key: 'q', label: t('kpis.support.queue'), render: (r) => <b>{t(`kpis.support.${r.key}`)}</b> },
              {
                key: 'o',
                label: t('kpis.support.open'),
                align: 'right',
                render: (r) => (r.open ? <span className="pill pill-coral">{fmt.number(r.open)}</span> : fmt.number(0)),
              },
              { key: 'a', label: t('kpis.support.oldest'), align: 'right', render: (r) => hours(fmt, t, r.oldest) },
              { key: 'f', label: t('kpis.support.firstAction'), align: 'right', render: (r) => hours(fmt, t, r.first) },
              { key: 'd', label: t('kpis.support.resolved'), align: 'right', render: (r) => hours(fmt, t, r.done) },
            ]}
          />
        </Card>
        <Card title={t('kpis.failed.title')} subtitle={t('kpis.failed.subtitle').replace('{period}', period)}>
          <Table
            empty={t('dashboard.empty')}
            rows={op.payments_by_provider}
            columns={[
              { key: 'p', label: t('kpis.failed.provider'), render: (r) => <b>{PROVIDERS[r.provider] ?? r.provider}</b> },
              { key: 'a', label: t('metrics.money.attempts'), align: 'right', render: (r) => fmt.number(r.attempts) },
              {
                key: 'f',
                label: t('metrics.money.failed'),
                align: 'right',
                render: (r) => `${fmt.number(r.failed)} (${pct(fmt, ratio(r.failed, r.attempts))})`,
              },
              { key: 's', label: t('kpis.failed.stuck'), align: 'right', render: (r) => fmt.number(r.stuck) },
              {
                key: 'rf',
                label: t('kpis.failed.refundsFailed'),
                align: 'right',
                render: (r) => (r.refunds_failed ? <span className="pill pill-coral">{fmt.number(r.refunds_failed)}</span> : fmt.number(0)),
              },
              { key: 'rw', label: t('kpis.failed.refundsWaiting'), align: 'right', render: (r) => fmt.number(r.refunds_waiting) },
            ]}
          />
        </Card>
      </div>

      {/* ── 4. Product and engineering ── */}
      <h2 className="dash-section-title">{t('kpis.product.title')}</h2>
      <section className="stat-grid stat-grid-4">
        <StatTile
          icon="check"
          label={t('kpis.product.timeToAccept')}
          value={hours(fmt, t, times.accept_median)}
          detail={t('kpis.product.p90').replace('{d}', hours(fmt, t, times.accept_p90)).replace('{n}', fmt.number(times.accepted))}
        />
        <StatTile
          icon="plane"
          label={t('kpis.product.timeToDeliver')}
          value={hours(fmt, t, times.deliver_median)}
          detail={t('kpis.product.deliverDetail')
            .replace('{d}', hours(fmt, t, times.deliver_p90))
            .replace('{e}', hours(fmt, t, times.end_to_end_median))}
        />
        <StatTile
          icon="star"
          label={t('kpis.product.rating')}
          value={ratings.average != null ? `${fmt.number(Number(ratings.average))} ★` : '–'}
          detail={t('kpis.product.ratingDetail')
            .replace('{p}', pct(fmt, ratio(ratings.under_4, ratings.count)))
            .replace('{n}', fmt.number(ratings.count))
            .replace('{trav}', ratings.traveler_average != null ? fmt.number(Number(ratings.traveler_average)) : '–')
            .replace('{send}', ratings.sender_average != null ? fmt.number(Number(ratings.sender_average)) : '–')}
        />
        <StatTile
          icon="close"
          label={t('kpis.product.cancellations')}
          value={fmt.number(pr.cancellations.total)}
          detail={t('kpis.product.cancellationsDetail')
            .replace('{period}', period)
            .replace('{found}', fmt.number(pr.cancellations.item_found ?? 0))}
        />
      </section>

      <div className="dash-two">
        <Card title={t('kpis.cancel.title')} subtitle={t('kpis.cancel.subtitle')}>
          <Table
            empty={t('kpis.cancel.none')}
            rows={pr.cancellations.by_stage.slice().sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage))}
            columns={[
              { key: 's', label: t('kpis.cancel.stage'), render: (r) => <b>{t(`kpis.cancel.stages.${r.stage}`)}</b> },
              { key: 'se', label: t('kpis.cancel.sender'), align: 'right', render: (r) => fmt.number(r.sender) },
              { key: 'tr', label: t('kpis.cancel.traveler'), align: 'right', render: (r) => fmt.number(r.traveler) },
              { key: 'na', label: t('kpis.cancel.nata'), align: 'right', render: (r) => fmt.number(r.nata) },
              { key: 'to', label: t('kpis.cancel.total'), align: 'right', render: (r) => <b>{fmt.number(r.total)}</b> },
            ]}
          />
        </Card>
        <Card title={t('kpis.appHealth.title')} subtitle={t('kpis.appHealth.subtitle')}>
          <p className="metrics-note">{t('kpis.appHealth.note')}</p>
          <ul className="kpi-list">
            <li>{t('kpis.appHealth.crashFree')}</li>
            <li>{t('kpis.appHealth.stepErrors')}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
