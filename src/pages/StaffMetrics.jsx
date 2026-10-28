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

function useStaffMetrics(demo, reload, onFetching) {
  const { t } = useI18n();
  const { year, month, setPeriod } = usePeriod();
  const [metrics, setMetrics] = useState(null);
  const [years, setYears] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (demo) {
      setMetrics(demo.metrics(year, month));
      setYears(demo.years());
      return;
    }
    onFetching(true);
    const [metricsRes, statsRes] = await Promise.all([
      supabase.rpc('staff_metrics', { p_year: year, p_month: month }),
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
  }, [demo, year, month, onFetching, t, years.length]);

  useEffect(() => {
    load();
  }, [load, reload]);

  return { metrics, error, year, month, setPeriod, years };
}

function MetricsPage({ titleKey, demo, children }) {
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
      <MetricsBody demo={demo} reload={reload} fetching={fetching} onFetching={setFetching}>
        {children}
      </MetricsBody>
    </StaffPage>
  );
}

function MetricsBody({ demo, reload, fetching, onFetching, children }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const data = useStaffMetrics(demo, reload, onFetching);
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

function Funnel({ f, fmt, t }) {
  const steps = [
    { key: 'requested', time: null },
    { key: 'accepted', time: 'to_accept' },
    { key: 'paid', time: 'to_pay' },
    { key: 'picked_up', time: 'to_pickup' },
    { key: 'delivered', time: 'to_deliver' },
  ];
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

export function MarketplacePage({ demo = null }) {
  return (
    <MetricsPage titleKey="metrics.marketplace.title" demo={demo}>
      {({ m, fmt, t, periodName, allTime }) => {
        const f = m.funnel;
        const cancelled = f.cancelled_before_payment + f.cancelled_after_payment;
        const r = m.routes;
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
                label={t('metrics.funnel.expired')}
                value={pct(fmt, ratio(f.expired_unanswered, f.requested))}
                detail={t('metrics.funnel.expiredDetail').replace('{n}', fmt.number(f.expired_unanswered))}
              />
              <StatTile
                icon="card"
                label={t('metrics.funnel.unpaid')}
                value={pct(fmt, ratio(f.expired_unpaid, f.accepted))}
                detail={t('metrics.funnel.unpaidDetail').replace('{n}', fmt.number(f.expired_unpaid))}
              />
              <StatTile
                icon="close"
                label={t('metrics.funnel.cancelled')}
                value={pct(fmt, ratio(cancelled, f.requested))}
                detail={t('metrics.funnel.cancelledDetail')
                  .replace('{before}', fmt.number(f.cancelled_before_payment))
                  .replace('{after}', fmt.number(f.cancelled_after_payment))}
              />
            </section>
            <Card
              title={t('metrics.funnel.chartTitle')}
              subtitle={t(allTime ? 'metrics.funnel.chartSubtitleAll' : 'metrics.funnel.chartSubtitle')
                .replace('{period}', periodName)
                .replace('{open}', fmt.number(f.open))}
            >
              {f.requested ? <Funnel f={f} fmt={fmt} t={t} /> : <p className="empty-note">{t('dashboard.empty')}</p>}
            </Card>

            <h2 className="dash-section-title">{t('metrics.routes.title')}</h2>
            <section className="stat-grid stat-grid-3">
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
            </section>
            <div className="dash-two">
              <Card title={t('metrics.routes.byRequests')} subtitle={t('metrics.routes.byRequestsSubtitle')}>
                <Table
                  empty={t('dashboard.empty')}
                  rows={r.by_requests}
                  columns={[
                    routeCol,
                    { key: 'req', label: t('metrics.routes.requests'), align: 'right', render: (row) => fmt.number(row.requests) },
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

// ── Money: payments, payouts, refunds, float ────────────────────────────────

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

function FloatTable({ m, float, floatError, fmt, t }) {
  const rows = {};
  const add = (cur) => (rows[cur] ??= { currency: cur, stripe: null, pawapay: null, owed: 0, held: 0 });
  (float?.stripe?.available ?? []).forEach((b) => {
    add(b.currency).stripe = (rows[b.currency].stripe ?? 0) + b.amount;
  });
  (float?.pawapay?.balances ?? []).forEach((b) => {
    if (b.currency) add(b.currency).pawapay = (rows[b.currency].pawapay ?? 0) + b.amount;
  });
  m.payments.owed_by_currency.forEach((o) => {
    add(o.currency).owed = Number(o.payouts_owed);
  });
  m.payments.escrow_by_currency.forEach((e) => {
    add(e.currency).held = Number(e.held);
  });
  const list = Object.values(rows).sort((a, b) => b.owed - a.owed || a.currency.localeCompare(b.currency));
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
        empty={t('dashboard.empty')}
        rows={list}
        columns={[
          { key: 'cur', label: t('metrics.money.currency'), render: (r) => <b>{r.currency}</b> },
          { key: 'stripe', label: t('metrics.money.stripe'), align: 'right', render: (r) => money(r.stripe, r.currency) },
          { key: 'pawapay', label: t('metrics.money.pawapay'), align: 'right', render: (r) => money(r.pawapay, r.currency) },
          { key: 'owed', label: t('metrics.money.owedCol'), align: 'right', render: (r) => money(r.owed, r.currency) },
          { key: 'held', label: t('metrics.money.heldCol'), align: 'right', render: (r) => money(r.held, r.currency) },
          {
            key: 'state',
            label: '',
            render: (r) => {
              if (!r.owed) return null;
              if (r.stripe == null && r.pawapay == null) return <span className="pill pill-muted">{t('metrics.money.noBalance')}</span>;
              const short = (r.stripe ?? 0) + (r.pawapay ?? 0) < r.owed;
              return (
                <span className={`pill ${short ? 'pill-coral' : 'pill-teal'}`}>
                  {t(short ? 'metrics.money.short' : 'metrics.money.covered')}
                </span>
              );
            },
          },
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
  const methodName = (row) =>
    `${t(`metrics.money.methods.${METHOD_KEYS[row.method] ?? 'other'}`)} · ${PROVIDERS[row.provider] ?? row.provider}`;
  const open = p.payouts_open.reduce((acc, o) => ({ count: acc.count + o.count, usd: acc.usd + Number(o.amount_usd) }), { count: 0, usd: 0 });

  return (
    <>
      <h2 className="dash-section-title">{t('metrics.money.payoutsTitle')}</h2>
      <section className="stat-grid stat-grid-4">
        <StatTile
          icon="send"
          label={t('metrics.money.payoutsWaiting')}
          value={fmt.usd(open.usd)}
          detail={t('metrics.money.payoutsWaitingDetail').replace('{n}', fmt.number(open.count))}
        />
        <StatTile
          icon="bell"
          label={t('metrics.money.oldestPayout')}
          value={hours(fmt, t, p.payouts_open.length ? Math.max(...p.payouts_open.map((o) => o.oldest_hours)) : null)}
          detail={t('metrics.money.olderThanDay').replace(
            '{n}',
            fmt.number(p.payouts_open.reduce((n, o) => n + o.older_than_day, 0)),
          )}
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
        <StatTile
          icon="shield"
          label={t('metrics.health.escrow')}
          value={fmt.usd(Number(m.health.escrow_usd))}
          detail={t('metrics.health.escrowDetail').replace('{n}', fmt.number(m.health.escrow_count))}
        />
      </section>

      <div className="dash-single">
        <Card title={t('metrics.money.payoutsByStatus')} subtitle={t('metrics.money.payoutsByStatusSubtitle')}>
          <Table
            empty={t('metrics.money.noOpenPayouts')}
            rows={p.payouts_open}
            columns={[
              { key: 's', label: t('metrics.money.status'), render: (o) => <b>{label(t, `metrics.money.payoutStatus.${o.status}`, o.status)}</b> },
              { key: 'n', label: t('metrics.money.count'), align: 'right', render: (o) => fmt.number(o.count) },
              { key: 'a', label: t('metrics.money.amount'), align: 'right', render: (o) => fmt.usd(Number(o.amount_usd)) },
              { key: 'o', label: t('metrics.money.oldest'), align: 'right', render: (o) => hours(fmt, t, o.oldest_hours) },
            ]}
          />
          {p.payout_failures.length > 0 && (
            <>
              <h3 className="metrics-subhead">{t('metrics.money.failureReasons')}</h3>
              <ul className="reason-list">
                {p.payout_failures.map((f) => (
                  <li key={f.reason}>
                    <span className="pill pill-coral">{fmt.number(f.count)}</span>
                    <span>{f.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card title={t('metrics.money.floatTitle')} subtitle={t('metrics.money.floatSubtitle')}>
        <FloatTable m={m} float={float} floatError={floatError} fmt={fmt} t={t} />
      </Card>

      <h2 className="dash-section-title">{t('metrics.money.paymentsTitle')}</h2>
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
              { key: 'n', label: t('metrics.money.network'), render: (r) => <span className="mono">{r.network}</span> },
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
        const g = m.growth;
        const rs = g.repeat_senders;
        const rt = g.repeat_travelers;
        return (
          <>
            <h2 className="dash-section-title">{t('metrics.trust.title')}</h2>
            <section className="stat-grid stat-grid-4">
              <StatTile
                icon="flag"
                label={t('metrics.trust.reports')}
                value={tr.deliveries ? fmt.number(Math.round((tr.reports / tr.deliveries) * 1000) / 10) : '–'}
                detail={t('metrics.trust.reportsDetail')
                  .replace('{n}', fmt.number(tr.reports))
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
                icon="badge"
                label={t('metrics.trust.identity')}
                value={pct(fmt, ratio(iv.passed, iv.passed + iv.rejected))}
                detail={t('metrics.trust.identityDetail')
                  .replace('{n}', fmt.number(iv.waiting))
                  .replace('{age}', hours(fmt, t, iv.oldest_waiting_hours))
                  .replace('{median}', hours(fmt, t, iv.median_hours_to_decide))}
              />
              <StatTile
                icon="key"
                label={t('metrics.trust.locked')}
                value={fmt.number(tr.locked_deliveries)}
                detail={t('metrics.trust.lockedDetail')}
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
