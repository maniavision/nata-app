import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { supabase } from '../supabase.js';
import { useFormatters } from '../format.js';
import StaffPage from '../components/StaffPage.jsx';

const LIMIT = 500; // the most support_app_feedback returns

// Suggestions members leave after a review (nata.app_feedback), newest first. Staff only:
// members were told their answer goes only to the Nata team.
export default function Feedback({ demoFeedback = null }) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  const [fetching, setFetching] = useState(false);
  return (
    <StaffPage
      demo={Boolean(demoFeedback)}
      title={t('feedback.title')}
      actions={
        <button type="button" className="btn-secondary btn-small" onClick={() => setReload((n) => n + 1)} disabled={fetching}>
          {fetching ? t('dashboard.refreshing') : t('dashboard.refresh')}
        </button>
      }
    >
      <FeedbackContent demoFeedback={demoFeedback} reload={reload} onFetching={setFetching} />
    </StaffPage>
  );
}

function FeedbackContent({ demoFeedback, reload, onFetching }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError('');
    if (demoFeedback) {
      setItems(demoFeedback());
      return;
    }
    onFetching(true);
    const { data, error: err } = await supabase.rpc('support_app_feedback', { p_limit: LIMIT });
    onFetching(false);
    if (err) {
      setError(err.code === 'PGRST202' ? t('feedback.errors.notInstalled') : t('dashboard.errors.loadFailed'));
      return;
    }
    setItems(data ?? []);
  }, [demoFeedback, onFetching, t]);

  useEffect(() => {
    load();
  }, [load, reload]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (f) =>
        (!source || f.source === source) &&
        (!q || `${f.message} ${f.first_name ?? ''} ${f.last_name ?? ''}`.toLowerCase().includes(q)),
    );
  }, [items, source, query]);

  return (
    <>
      <p className="dash-updated">{t('feedback.subtitle')}</p>

      <div className="filter-bar">
        <label className="filter">
          <span>{t('feedback.filters.source')}</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('feedback.filters.all')}</option>
            <option value="review_traveler">{t('feedback.source.review_traveler')}</option>
            <option value="review_sender">{t('feedback.source.review_sender')}</option>
          </select>
        </label>
        <label className="filter filter-grow">
          <span>{t('feedback.filters.search')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('feedback.filters.searchPlaceholder')}
          />
        </label>
      </div>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {!items && !error && <p className="dash-loading">{t('dashboard.loading')}</p>}

      {items && (
        <>
          <p className="period-note">
            {t('feedback.count').replace('{n}', fmt.number(shown.length)).replace('{total}', fmt.number(items.length))}
          </p>
          {shown.length ? (
            <ul className="feedback-list">
              {shown.map((f) => (
                <li key={f.id} className="feedback-card">
                  <div className="feedback-meta">
                    <b>{[f.first_name, f.last_name].filter(Boolean).join(' ') || t('feedback.deletedMember')}</b>
                    <span className={`pill ${f.source === 'review_traveler' ? 'pill-teal' : 'pill-coral'}`}>
                      {t(`feedback.source.${f.source}`)}
                    </span>
                    <time dateTime={f.created_at}>{fmt.dateTime(f.created_at)}</time>
                  </div>
                  <p className="feedback-message">{f.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-card empty-card">
              <p>{items.length ? t('feedback.noMatch') : t('feedback.empty')}</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
