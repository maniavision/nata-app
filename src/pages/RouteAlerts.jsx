import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { supabase } from '../supabase.js';
import { useFormatters } from '../format.js';
import StaffPage from '../components/StaffPage.jsx';

const TOP = 10;

// The routes most members asked to be alerted about (public.top_route_alerts), with how
// many live trips cover each: a route with followers and no trips is unmet demand.
export default function RouteAlerts({ demoRoutes = null }) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  const [fetching, setFetching] = useState(false);
  return (
    <StaffPage
      demo={Boolean(demoRoutes)}
      title={t('routes.title')}
      actions={
        <button type="button" className="btn-secondary btn-small" onClick={() => setReload((n) => n + 1)} disabled={fetching}>
          {fetching ? t('dashboard.refreshing') : t('dashboard.refresh')}
        </button>
      }
    >
      <RoutesContent demoRoutes={demoRoutes} reload={reload} onFetching={setFetching} />
    </StaffPage>
  );
}

function RoutesContent({ demoRoutes, reload, onFetching }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [routes, setRoutes] = useState(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);

  const load = useCallback(async () => {
    setError('');
    if (demoRoutes) {
      setRoutes(demoRoutes());
      return;
    }
    onFetching(true);
    const { data, error: err } = await supabase.rpc('top_route_alerts', { p_limit: TOP });
    onFetching(false);
    if (err) {
      setError(err.code === 'PGRST202' ? t('routes.errors.notInstalled') : t('dashboard.errors.loadFailed'));
      return;
    }
    setRoutes(data ?? []);
  }, [demoRoutes, onFetching, t]);

  useEffect(() => {
    load();
  }, [load, reload]);

  const max = Math.max(...(routes ?? []).map((r) => Number(r.members)), 1);
  const uncovered = (routes ?? []).filter((r) => Number(r.live_trips) === 0).length;

  return (
    <>
      <p className="dash-updated">{t('routes.subtitle')}</p>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {!routes && !error && <p className="dash-loading">{t('dashboard.loading')}</p>}

      {routes &&
        (routes.length ? (
          <section className="dash-card">
            <div className="dash-card-head">
              <div>
                <h2>{t('routes.cardTitle').replace('{n}', routes.length)}</h2>
                <p>
                  {uncovered
                    ? t('routes.uncovered').replace('{n}', fmt.number(uncovered))
                    : t('routes.allCovered')}
                </p>
              </div>
            </div>
            <ol className="route-list">
              {routes.map((r, i) => {
                const key = `${r.from_city}-${r.to_city}-${i}`;
                const members = Number(r.members);
                const live = Number(r.live_trips);
                return (
                  <li
                    key={key}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    className={hover === key ? 'active' : ''}
                  >
                    <span className="route-rank">{i + 1}</span>
                    <div className="route-main">
                      <div className="route-name">
                        <b>{r.from_city}</b>
                        <span className="route-country">{fmt.country(r.from_country)}</span>
                        <span className="route-arrow" aria-hidden="true">→</span>
                        <b>{r.to_city}</b>
                        <span className="route-country">{fmt.country(r.to_country)}</span>
                      </div>
                      <span className="route-track">
                        <span style={{ width: `${(members / max) * 100}%` }} />
                      </span>
                    </div>
                    <div className="route-figures">
                      <b>{fmt.number(members)}</b>
                      <span>{t(members === 1 ? 'routes.member' : 'routes.members')}</span>
                    </div>
                    <span className={`pill ${live ? 'pill-teal' : 'pill-coral'}`}>
                      {live ? t(live === 1 ? 'routes.liveTrip' : 'routes.liveTrips').replace('{n}', fmt.number(live)) : t('routes.noTrips')}
                    </span>
                    {hover === key && (
                      <span className="row-tooltip" role="status">
                        {t('routes.since').replace('{d}', fmt.dateTime(r.first_saved))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <div className="dash-card empty-card">
            <p>{t('routes.empty')}</p>
          </div>
        ))}
    </>
  );
}
