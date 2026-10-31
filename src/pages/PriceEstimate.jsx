import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { supabase } from '../supabase.js';
import { useFormatters } from '../format.js';
import { COST_PER_KG, COST_PER_KM, BASE_COST, haversineKm, hoursUntilDeparture, quote } from '../pricing.js';
import StaffPage from '../components/StaffPage.jsx';

// Today + n days as YYYY-MM-DD (UTC, like the app's day count).
const dayFromToday = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Staff tool: pick a route, a weight and a departure day, and see what a sender would
// be quoted in the app (same formula: src/pricing.js). `demo` is the dev-only preview.
export default function PriceEstimate({ demo = false }) {
  const { t } = useI18n();
  return (
    <StaffPage demo={demo} title={t('estimate.title')}>
      <EstimateContent />
    </StaffPage>
  );
}

// The cities of one country (nata.cities), capital first, then by name. Cached per country.
const cityCache = new Map();
function useCities(country) {
  const [state, setState] = useState({ country: '', cities: [], error: false });
  useEffect(() => {
    if (!country) return undefined;
    if (cityCache.has(country)) {
      setState({ country, cities: cityCache.get(country), error: false });
      return undefined;
    }
    let live = true;
    supabase
      .schema('nata')
      .from('cities')
      .select('id, name, latitude, longitude, is_capital')
      .eq('country_code', country)
      .order('is_capital', { ascending: false })
      .order('name')
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setState({ country, cities: [], error: true });
          return;
        }
        cityCache.set(country, data ?? []);
        setState({ country, cities: data ?? [], error: false });
      });
    return () => {
      live = false;
    };
  }, [country]);
  return state.country === country ? state : { country, cities: [], error: false, loading: Boolean(country) };
}

function Place({ label, countries, country, city, onCountry, onCity, cities }) {
  const { t } = useI18n();
  return (
    <fieldset className="estimate-place">
      <legend>{label}</legend>
      <label className="filter">
        <span>{t('estimate.country')}</span>
        <select value={country} onChange={(e) => onCountry(e.target.value)}>
          <option value="">{t('estimate.chooseCountry')}</option>
          {countries.map((c) => (
            <option key={c.iso_code} value={c.iso_code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="filter">
        <span>{t('estimate.city')}</span>
        <select value={city} onChange={(e) => onCity(e.target.value)} disabled={!country || cities.loading}>
          <option value="">{cities.loading ? t('dashboard.loading') : t('estimate.chooseCity')}</option>
          {cities.cities.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function EstimateContent() {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [countries, setCountries] = useState(null);
  const [error, setError] = useState('');
  const [fromCountry, setFromCountry] = useState('');
  const [fromCity, setFromCity] = useState('');
  const [toCountry, setToCountry] = useState('');
  const [toCity, setToCity] = useState('');
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(dayFromToday(7));

  useEffect(() => {
    supabase
      .schema('nata')
      .from('countries')
      .select('iso_code, name')
      .order('name')
      .then(({ data, error: err }) => {
        if (err) setError(t('dashboard.errors.loadFailed'));
        else setCountries(data ?? []);
      });
  }, [t]);

  const fromCities = useCities(fromCountry);
  const toCities = useCities(toCountry);
  const loadError = error || (fromCities.error || toCities.error ? t('dashboard.errors.loadFailed') : '');

  // Pick the capital when a country is chosen, as the app does.
  useEffect(() => {
    if (fromCities.cities.length && !fromCity) setFromCity(String(fromCities.cities[0].id));
  }, [fromCities.cities, fromCity]);
  useEffect(() => {
    if (toCities.cities.length && !toCity) setToCity(String(toCities.cities[0].id));
  }, [toCities.cities, toCity]);

  const from = fromCities.cities.find((c) => String(c.id) === fromCity);
  const to = toCities.cities.find((c) => String(c.id) === toCity);
  const weightKg = Number(weight.replace(',', '.'));
  const weightOk = weight !== '' && Number.isFinite(weightKg) && weightKg > 0 && weightKg <= 1000;
  const sameCity = from && to && from.id === to.id;

  const result = useMemo(() => {
    if (!from || !to || sameCity || !weightOk || !date) return null;
    const distanceKm = haversineKm(Number(from.latitude), Number(from.longitude), Number(to.latitude), Number(to.longitude));
    return quote({ distanceKm, weightKg, hours: hoursUntilDeparture(date) });
  }, [from, to, sameCity, weightOk, weightKg, date]);

  const money2 = (n) => fmt.money(n, 'USD');
  const swap = () => {
    setFromCountry(toCountry);
    setToCountry(fromCountry);
    setFromCity(toCity);
    setToCity(fromCity);
  };

  return (
    <>
      <p className="dash-updated">{t('estimate.subtitle')}</p>
      {loadError && (
        <p className="auth-error" role="alert">
          {loadError}
        </p>
      )}
      {!countries && !error && <p className="dash-loading">{t('dashboard.loading')}</p>}

      {countries && (
        <div className="estimate-layout">
          <section className="dash-card estimate-form">
            <div className="estimate-route">
              <Place
                label={t('estimate.from')}
                countries={countries}
                country={fromCountry}
                city={fromCity}
                cities={fromCities}
                onCountry={(c) => {
                  setFromCountry(c);
                  setFromCity('');
                }}
                onCity={setFromCity}
              />
              <button type="button" className="estimate-swap" onClick={swap} aria-label={t('estimate.swap')} title={t('estimate.swap')}>
                ⇄
              </button>
              <Place
                label={t('estimate.to')}
                countries={countries}
                country={toCountry}
                city={toCity}
                cities={toCities}
                onCountry={(c) => {
                  setToCountry(c);
                  setToCity('');
                }}
                onCity={setToCity}
              />
            </div>
            <div className="estimate-row">
              <label className="filter">
                <span>{t('estimate.weight')}</span>
                <div className="estimate-unit">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="5"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value.replace(/[^\d.,]/g, ''))}
                  />
                  <span>kg</span>
                </div>
              </label>
              <label className="filter">
                <span>{t('estimate.departure')}</span>
                <input type="date" value={date} min={dayFromToday(0)} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            {weight !== '' && !weightOk && <p className="estimate-hint error">{t('estimate.weightInvalid')}</p>}
            {sameCity && <p className="estimate-hint error">{t('estimate.sameCity')}</p>}
            <p className="estimate-hint">{t('estimate.departureNote')}</p>
          </section>

          <section className="dash-card estimate-result" aria-live="polite">
            {result ? (
              <>
                <p className="estimate-label">{t('estimate.total')}</p>
                <p className="estimate-total">{fmt.usd(result.totalUsd)}</p>
                <p className="estimate-route-line">
                  {from.name} → {to.name} · {fmt.number(Math.round(result.distanceKm))} km · {fmt.number(weightKg)} kg
                </p>
                <dl className="estimate-lines">
                  <div>
                    <dt>{t('estimate.lines.base')}</dt>
                    <dd>{money2(BASE_COST)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t('estimate.lines.distance')}
                      <small>
                        {fmt.number(Math.round(result.distanceKm))} km × {COST_PER_KM} USD
                      </small>
                    </dt>
                    <dd>{money2(result.distanceCost)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t('estimate.lines.weight')}
                      <small>
                        {fmt.number(weightKg)} kg × {money2(COST_PER_KG)}
                      </small>
                    </dt>
                    <dd>{money2(result.weightCost)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t('estimate.lines.urgency')}
                      <small>{t('estimate.lines.urgencyNote').replace('{h}', fmt.number(result.hours))}</small>
                    </dt>
                    <dd>{money2(result.urgencyCost)}</dd>
                  </div>
                  <div className="estimate-subtotal">
                    <dt>
                      {t('estimate.lines.cost')}
                      <small>{t('estimate.lines.costNote').replace('{x}', money2(result.exactCost))}</small>
                    </dt>
                    <dd>{fmt.usd(result.costUsd)}</dd>
                  </div>
                  <div>
                    <dt>{t('estimate.lines.fee')}</dt>
                    <dd>{fmt.usd(result.feeUsd)}</dd>
                  </div>
                  <div className="estimate-grand">
                    <dt>{t('estimate.lines.total')}</dt>
                    <dd>{fmt.usd(result.totalUsd)}</dd>
                  </div>
                </dl>
                <p className="estimate-hint">{t('estimate.usdNote')}</p>
              </>
            ) : (
              <p className="estimate-empty">{t('estimate.empty')}</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
