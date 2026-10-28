import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { supabase } from '../supabase.js';
import { useFormatters } from '../format.js';
import Icon from '../components/Icons.jsx';
import StaffPage from '../components/StaffPage.jsx';

const TOP_COUNTRIES = 12;

// Rounds the top of an axis up to 1, 2 or 5 × a power of ten so gridlines land on readable values.
function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value);
  return step * power;
}

// Reads ?year=2026&month=10 (month only counts with a year).
function usePeriod() {
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || null;
  const rawMonth = Number(params.get('month')) || null;
  const month = year && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : null;
  const setPeriod = useCallback(
    (nextYear, nextMonth) => {
      const next = {};
      if (nextYear) next.year = String(nextYear);
      if (nextYear && nextMonth) next.month = String(nextMonth);
      setParams(next, { replace: true });
    },
    [setParams],
  );
  return { year, month, setPeriod };
}

function StatTile({ label, value, detail, icon }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-head">
        <span>{label}</span>
        <Icon name={icon} size={18} />
      </div>
      <b>{value}</b>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function PeriodFilter({ years, year, month, onChange, fmt, t }) {
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const thisMonth = now.getUTCMonth() + 1;
  const yearOptions = years.length ? years : [thisYear];

  return (
    <div className="filter-bar" role="group" aria-label={t('dashboard.filter.label')}>
      <label className="filter">
        <span>{t('dashboard.filter.year')}</span>
        <select value={year ?? ''} onChange={(e) => onChange(Number(e.target.value) || null, null)}>
          <option value="">{t('dashboard.filter.allTime')}</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="filter">
        <span>{t('dashboard.filter.month')}</span>
        <select
          value={month ?? ''}
          disabled={!year}
          onChange={(e) => onChange(year, Number(e.target.value) || null)}
        >
          <option value="">{t('dashboard.filter.allMonths')}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m} disabled={year === thisYear && m > thisMonth}>
              {fmt.monthName(m)}
            </option>
          ))}
        </select>
      </label>
      {year && (
        <button type="button" className="link-btn" onClick={() => onChange(null, null)}>
          {t('dashboard.filter.clear')}
        </button>
      )}
    </div>
  );
}

function SeriesChart({ series, measure, fmt, t, title }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setHover(null), [series]);

  const points = series.points ?? [];
  const byDay = series.unit === 'day';
  const field = { count: 'count', volume: 'volume_usd', revenue: 'revenue_usd' }[measure];
  const values = points.map((p) => Number(p[field] ?? 0));
  const max = niceMax(Math.max(...values, 0));
  const ticks = [0, max / 2, max];
  const formatValue = measure === 'count' ? fmt.number : fmt.usd;
  const formatTick = measure === 'count' ? fmt.compact : fmt.usdCompact;

  // Drawn at the container's real width so axis text stays 11px on phones instead of scaling down.
  const W = width || 720;
  const H = width && width < 480 ? 200 : 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(18, slot - 4));
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  // Which points get an axis label: days 1, 5, 10…; months every third (every sixth on phones),
  // except a single year's 12 months, which all fit when there's room.
  const every = byDay ? 5 : points.length <= 12 && W >= 480 ? 1 : W < 480 ? 6 : 3;
  const labelled = points.map((_, i) => (byDay ? i === 0 || (i + 1) % every === 0 : i % every === 0));
  if (!byDay && every > 1) {
    const last = points.length - 1;
    if (last % every >= every / 2) labelled[last] = true;
  }
  let prevYear = null;
  const labels = points.map((p, i) => {
    if (!labelled[i]) return null;
    if (byDay) return String(Number(p.date.slice(8, 10)));
    const yr = p.date.slice(0, 4);
    const text = fmt.monthShort(p.date) + (every > 1 && yr !== prevYear ? ` ${yr.slice(2)}` : '');
    prevYear = yr;
    return text;
  });

  const hovered = hover == null ? null : points[hover];

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={pad.left - 8} y={y(tick)} className="axis-label" textAnchor="end" dominantBaseline="middle">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const v = values[i];
          const x = pad.left + i * slot + (slot - barW) / 2;
          const h = Math.max((v / max) * plotH, v > 0 ? 2 : 0);
          const r = Math.min(4, h / 2, barW / 2);
          const top = pad.top + plotH - h;
          // Rounded at the data end, square at the baseline.
          const d = h
            ? `M${x},${pad.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + plotH} Z`
            : '';
          return (
            <g key={p.date} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
              {d && <path d={d} className={`bar${hover === i ? ' active' : ''}`} />}
              {labels[i] && (
                <text x={pad.left + i * slot + slot / 2} y={H - 8} className="axis-label" textAnchor="middle">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className="baseline" />
      </svg>
      {hovered && (
        <div
          className="chart-tooltip"
          style={(() => {
            // Anchored on the bar, but kept inside the chart near either edge.
            const pct = ((pad.left + hover * slot + slot / 2) / W) * 100;
            const shift = pct > 82 ? '-100%' : pct < 18 ? '0%' : '-50%';
            return { left: `${pct}%`, transform: `translate(${shift}, -8px)` };
          })()}
          role="status"
        >
          <span>{byDay ? fmt.dayLong(hovered.date) : fmt.monthLong(hovered.date)}</span>
          <b>{formatValue(values[hover])}</b>
          <small>
            {measure === 'count'
              ? fmt.usd(Number(hovered.volume_usd))
              : `${fmt.number(hovered.count)} ${t('dashboard.transactionsUnit')}`}
          </small>
          {measure === 'revenue' && Number(hovered.volume_usd) > 0 && (
            <small>{t('dashboard.revenue.ofVolume').replace('{v}', fmt.usd(Number(hovered.volume_usd)))}</small>
          )}
        </div>
      )}
    </div>
  );
}

function CountryBars({ countries, fmt, t }) {
  const [hover, setHover] = useState(null);
  const rows = useMemo(() => {
    const named = countries.map((c) => ({
      ...c,
      name: c.country === '??' ? t('dashboard.countries.notSet') : fmt.country(c.country),
    }));
    if (named.length <= TOP_COUNTRIES) return named;
    const rest = named.slice(TOP_COUNTRIES);
    return [
      ...named.slice(0, TOP_COUNTRIES),
      {
        country: 'other',
        name: t('dashboard.countries.other').replace('{n}', rest.length),
        total: rest.reduce((s, c) => s + c.total, 0),
        verified: rest.reduce((s, c) => s + c.verified, 0),
      },
    ];
  }, [countries, fmt, t]);
  const max = Math.max(...rows.map((r) => r.total), 1);

  if (!rows.length) return <p className="empty-note">{t('dashboard.empty')}</p>;

  return (
    <>
      <div className="legend">
        <span>
          <i className="swatch verified" /> {t('dashboard.countries.verified')}
        </span>
        <span>
          <i className="swatch unverified" /> {t('dashboard.countries.notVerified')}
        </span>
      </div>
      <ul className="country-bars">
        {rows.map((r) => {
          const unverified = r.total - r.verified;
          return (
            <li
              key={r.country}
              onMouseEnter={() => setHover(r.country)}
              onMouseLeave={() => setHover(null)}
              className={hover === r.country ? 'active' : ''}
            >
              <span className="country-name">{r.name}</span>
              <span className="country-track">
                <span className="seg verified" style={{ width: `${(r.verified / max) * 100}%` }} />
                <span className="seg unverified" style={{ width: `${(unverified / max) * 100}%` }} />
              </span>
              <span className="country-value">{fmt.number(r.total)}</span>
              {hover === r.country && (
                <span className="row-tooltip" role="status">
                  {fmt.number(r.verified)} {t('dashboard.countries.verified').toLowerCase()} ·{' '}
                  {fmt.number(unverified)} {t('dashboard.countries.notVerified').toLowerCase()}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Revenue per country of the sender who paid; one series, so no legend.
function RevenueBars({ countries, fmt, t }) {
  const [hover, setHover] = useState(null);
  const rows = useMemo(() => {
    const named = countries
      .filter((c) => Number(c.revenue_usd) > 0)
      .map((c) => ({
        ...c,
        revenue: Number(c.revenue_usd),
        name: c.country === '??' ? t('dashboard.countries.notSet') : fmt.country(c.country),
      }));
    if (named.length <= TOP_COUNTRIES) return named;
    const rest = named.slice(TOP_COUNTRIES);
    return [
      ...named.slice(0, TOP_COUNTRIES),
      {
        country: 'other',
        name: t('dashboard.countries.other').replace('{n}', rest.length),
        revenue: rest.reduce((s, c) => s + c.revenue, 0),
        count: rest.reduce((s, c) => s + c.count, 0),
      },
    ];
  }, [countries, fmt, t]);
  const max = Math.max(...rows.map((r) => r.revenue), 1);

  if (!rows.length) return <p className="empty-note">{t('dashboard.empty')}</p>;

  return (
    <ul className="country-bars revenue-bars">
      {rows.map((r) => (
        <li
          key={r.country}
          onMouseEnter={() => setHover(r.country)}
          onMouseLeave={() => setHover(null)}
          className={hover === r.country ? 'active' : ''}
        >
          <span className="country-name">{r.name}</span>
          <span className="country-track">
            <span className="seg verified" style={{ width: `${(r.revenue / max) * 100}%` }} />
          </span>
          <span className="country-value">{fmt.usd(r.revenue)}</span>
          {hover === r.country && (
            <span className="row-tooltip" role="status">
              {fmt.number(r.count)} {t('dashboard.transactionsUnit')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// `demoStats(year, month)` (dev-only preview route) renders sample figures without signing in.
export default function Dashboard({ demoStats = null }) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  const [fetching, setFetching] = useState(false);
  return (
    <StaffPage
      demo={Boolean(demoStats)}
      title={t('dashboard.title')}
      actions={
        <button type="button" className="btn-secondary btn-small" onClick={() => setReload((n) => n + 1)} disabled={fetching}>
          {fetching ? t('dashboard.refreshing') : t('dashboard.refresh')}
        </button>
      }
    >
      <DashboardContent demoStats={demoStats} reload={reload} onFetching={setFetching} />
    </StaffPage>
  );
}

function DashboardContent({ demoStats, reload, onFetching }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const { year, month, setPeriod } = usePeriod();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);
  const [measure, setMeasure] = useState('count');

  const load = useCallback(async () => {
    setError('');
    if (demoStats) {
      setStats(demoStats(year, month));
      return;
    }
    setFetching(true);
    onFetching(true);
    const { data, error: err } = await supabase.rpc('dashboard_stats', { p_year: year, p_month: month });
    setFetching(false);
    onFetching(false);
    if (err) {
      // PGRST202: the function (with year/month) isn't in the database yet.
      setError(err.code === 'PGRST202' ? t('dashboard.errors.notInstalled') : t('dashboard.errors.loadFailed'));
      return;
    }
    setStats(data);
  }, [t, demoStats, year, month, onFetching]);

  useEffect(() => {
    load();
  }, [load, reload]);

  const allTime = !year;
  const periodKey = month ? `${year}-${String(month).padStart(2, '0')}` : null;
  const periodName = allTime ? '' : month ? fmt.monthLong(periodKey) : String(year);
  const users = stats?.users;
  const verifiedShare = users?.total ? users.verified / users.total : 0;
  const seriesUnit = stats?.transactions_series?.unit;
  const seriesTitle = t(seriesUnit === 'day' ? 'dashboard.series.titleDay' : 'dashboard.series.titleMonth');
  const seriesSubtitle = allTime ? t('dashboard.series.last24') : periodName;
  const revenue = Number(stats?.transactions?.revenue_usd ?? 0);
  const volume = Number(stats?.transactions?.volume_usd ?? 0);

  return (
    <>
      {stats && (
        <p className="dash-updated">
          {t('dashboard.updated')} {fmt.dateTime(stats.generated_at)}
        </p>
      )}

      <PeriodFilter
        years={stats?.years_available ?? []}
        year={year}
        month={month}
        onChange={setPeriod}
        fmt={fmt}
        t={t}
      />

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {!stats && !error && <p className="dash-loading">{t('dashboard.loading')}</p>}

      {stats && (
        <div className={`dash-body${fetching ? ' is-fetching' : ''}`}>
          {!allTime && (
            <p className="period-note">{t('dashboard.filter.showing').replace('{period}', periodName)}</p>
          )}
          <section className="stat-grid">
            <StatTile
              icon="user"
              label={t(allTime ? 'dashboard.tiles.users' : 'dashboard.tiles.newUsers')}
              value={fmt.number(users.total)}
              detail={
                allTime
                  ? t('dashboard.tiles.newThisMonth').replace('{n}', fmt.number(users.new_this_month))
                  : t('dashboard.tiles.ofAllTime').replace('{n}', fmt.number(stats.users_all_time))
              }
            />
            <StatTile
              icon="badge"
              label={t('dashboard.tiles.verified')}
              value={fmt.number(users.verified)}
              detail={t('dashboard.tiles.verifiedDetail')
                .replace('{p}', fmt.percent(verifiedShare))
                .replace('{n}', fmt.number(users.pending))}
            />
            <StatTile
              icon="plane"
              label={t(allTime ? 'dashboard.tiles.trips' : 'dashboard.tiles.tripsPosted')}
              value={fmt.number(stats.trips.total)}
              detail={t('dashboard.tiles.tripsDetail')
                .replace('{live}', fmt.number(stats.trips.live))
                .replace('{done}', fmt.number(stats.trips.completed))}
            />
            <StatTile
              icon="card"
              label={t('dashboard.tiles.transactions')}
              value={fmt.number(stats.transactions.total)}
              detail={t('dashboard.tiles.volume').replace('{v}', fmt.usd(volume))}
            />
            <StatTile
              icon="bank"
              label={t('dashboard.tiles.revenue')}
              value={fmt.usd(revenue)}
              detail={
                volume > 0
                  ? t('dashboard.tiles.revenueDetail').replace('{p}', fmt.percent(revenue / volume))
                  : t('dashboard.tiles.revenueNone')
              }
            />
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <h2>{seriesTitle}</h2>
                <p>
                  {seriesSubtitle} · {t('dashboard.series.subtitle')}
                </p>
              </div>
              <div className="segmented" role="group" aria-label={t('dashboard.series.measure')}>
                {['count', 'volume', 'revenue'].map((m) => (
                  <button key={m} type="button" aria-pressed={measure === m} onClick={() => setMeasure(m)}>
                    {t(`dashboard.series.${m}`)}
                  </button>
                ))}
              </div>
            </div>
            <SeriesChart series={stats.transactions_series} measure={measure} fmt={fmt} t={t} title={seriesTitle} />
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <h2>{t('dashboard.yearly.title')}</h2>
                <p>{t('dashboard.yearly.subtitle')}</p>
              </div>
            </div>
            {stats.transactions_by_year.length ? (
              <div className="table-scroll">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{t('dashboard.yearly.year')}</th>
                      <th>{t('dashboard.yearly.count')}</th>
                      <th>{t('dashboard.yearly.volume')}</th>
                      <th>{t('dashboard.yearly.revenue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const maxRev = Math.max(...stats.transactions_by_year.map((y) => Number(y.revenue_usd ?? 0)), 1);
                      return [...stats.transactions_by_year].reverse().map((y) => (
                        <tr
                          key={y.year}
                          className={y.year === year ? 'selected' : ''}
                          onClick={() => setPeriod(y.year === year ? null : y.year, null)}
                          title={t('dashboard.yearly.select')}
                        >
                          <td>{y.year}</td>
                          <td>{fmt.number(y.count)}</td>
                          <td>{fmt.usd(Number(y.volume_usd))}</td>
                          <td>
                            <span className="inline-bar">
                              <span style={{ width: `${(Number(y.revenue_usd ?? 0) / maxRev) * 100}%` }} />
                            </span>
                            {fmt.usd(Number(y.revenue_usd ?? 0))}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-note">{t('dashboard.empty')}</p>
            )}
          </section>

          <div className="dash-two">
            <section className="dash-card">
              <div className="dash-card-head">
                <div>
                  <h2>{t('dashboard.revenue.byCountryTitle')}</h2>
                  <p>
                    {(allTime ? '' : `${periodName} · `) + t('dashboard.revenue.byCountrySubtitle')}
                  </p>
                </div>
              </div>
              <RevenueBars countries={stats.revenue_by_country ?? []} fmt={fmt} t={t} />
            </section>

            <section className="dash-card">
              <div className="dash-card-head">
                <div>
                  <h2>{t('dashboard.countries.title')}</h2>
                  <p>
                    {allTime
                      ? t('dashboard.countries.subtitle')
                      : t('dashboard.countries.subtitlePeriod').replace('{period}', periodName)}
                  </p>
                </div>
              </div>
              <CountryBars countries={stats.users_by_country} fmt={fmt} t={t} />
            </section>
          </div>
        </div>
      )}
    </>
  );
}
