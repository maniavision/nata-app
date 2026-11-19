import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { supabase } from '../supabase.js';
import { useFormatters } from '../format.js';
import StaffPage from '../components/StaffPage.jsx';

// The app's Profile › Support tools for Nata staff (20240154_support_tools.sql and later).
// Every RPC refuses anyone not in nata.admins, so StaffPage's check is a convenience, not the guard.

const LINK_SECONDS = 600;

function realApi() {
  const rpc = async (name, params) => {
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw error;
    return data;
  };
  const signed = async (bucket, path) => {
    if (!path) return null;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, LINK_SECONDS);
    return error ? null : data?.signedUrl ?? null;
  };
  return {
    summary: async () => (await rpc('support_summary'))?.[0] ?? {},
    activity: () => rpc('support_recent_activity', { p_limit: 15 }),
    problems: (open) => rpc('support_problems', { p_open: open }),
    photos: async (requestId) => {
      const r = (await rpc('support_delivery_photos', { p_request: requestId }))?.[0];
      if (!r) return [];
      const pickup = r.pickup_photo_paths?.length ? r.pickup_photo_paths : [r.pickup_photo_path];
      const handover = r.handover_photo_paths?.length ? r.handover_photo_paths : [r.handover_photo_path];
      const items = [
        ...pickup.filter(Boolean).map((p) => ['pickup', p]),
        ...handover.filter(Boolean).map((p) => ['handover', p]),
        ...(r.sender_handover_photo_path ? [['sender', r.sender_handover_photo_path]] : []),
      ];
      const urls = await Promise.all(items.map(([, p]) => signed('handover-photos', p)));
      return items.map(([kind], i) => ({ kind, url: urls[i] })).filter((x) => x.url);
    },
    resolve: (id, note) => rpc('support_resolve', { p_dispute: id, p_note: note }),
    refund: (id, note) => rpc('support_refund_sender', { p_dispute: id, p_note: note }),
    failed: () => rpc('support_failed_payments'),
    retry: (kind, id) => rpc('support_retry', { p_kind: kind, p_id: id }),
    locked: () => rpc('support_locked_deliveries'),
    unlock: (requestId) => rpc('support_unlock', { p_request: requestId }),
    reports: (open) => rpc('support_chat_reports', { p_open: open }),
    reportMessages: (id) => rpc('support_report_messages', { p_report: id }),
    reviewReport: (id, note) => rpc('support_review_report', { p_report: id, p_note: note }),
    idReviews: () => rpc('support_id_reviews'),
    idUrl: (path) => signed('identity-documents', path),
    reviewId: (userId, approve, note) => rpc('support_review_id', { p_user: userId, p_approve: approve, p_note: note }),
    ticketReviews: () => rpc('support_ticket_reviews'),
    ticketUrl: (path) => signed('trip-receipts', path),
    reviewTicket: (tripId, approve, note) =>
      rpc('support_review_ticket', { p_trip: tripId, p_approve: approve, p_note: note }),
  };
}

const SECTIONS = [
  { key: 'problems', count: 'open_problems', tone: 'coral' },
  { key: 'reports', count: 'open_reports', tone: 'teal' },
  { key: 'ids', count: 'id_reviews', tone: 'amber' },
  { key: 'tickets', count: 'ticket_reviews', tone: 'amber' },
  { key: 'failed', count: 'failed_payments', tone: 'red' },
  { key: 'locked', count: 'locked_deliveries', tone: 'amber' },
];

export default function Work({ demoApi = null }) {
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  return (
    <StaffPage
      demo={Boolean(demoApi)}
      title={t('work.title')}
      actions={
        <button type="button" className="btn-secondary btn-small" onClick={() => setReload((n) => n + 1)}>
          {t('dashboard.refresh')}
        </button>
      }
    >
      <WorkContent demoApi={demoApi} reload={reload} />
    </StaffPage>
  );
}

function WorkContent({ demoApi, reload }) {
  const { t } = useI18n();
  const api = useMemo(() => demoApi ?? realApi(), [demoApi]);
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some((s) => s.key === params.get('s')) ? params.get('s') : null;
  const [toast, setToast] = useState('');

  const go = (key) => {
    setParams(key ? { s: key } : {});
    window.scrollTo(0, 0);
  };
  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  return (
    <>
      <p className="dash-updated">{t('work.subtitle')}</p>
      {section ? (
        <>
          <button type="button" className="link-btn work-back" onClick={() => go(null)}>
            ← {t('work.back')}
          </button>
          <h2 className="work-section-title">{t(`work.summary.${section}.label`)}</h2>
          {section === 'problems' && <Problems api={api} reload={reload} notify={notify} />}
          {section === 'reports' && <Reports api={api} reload={reload} notify={notify} />}
          {section === 'ids' && <IdReviews api={api} reload={reload} notify={notify} />}
          {section === 'tickets' && <TicketReviews api={api} reload={reload} notify={notify} />}
          {section === 'failed' && <FailedPayments api={api} reload={reload} notify={notify} />}
          {section === 'locked' && <LockedDeliveries api={api} reload={reload} notify={notify} />}
        </>
      ) : (
        <Hub api={api} reload={reload} onOpen={go} />
      )}
      {toast && (
        <div className="work-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

// Loads a list and reloads it on demand; `deps` re-run the loader.
function useLoad(loader, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(false);
    loader()
      .then((d) => alive && setData(d ?? []))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, refresh: () => setTick((n) => n + 1), setData };
}

function Status({ error, data, empty }) {
  const { t } = useI18n();
  if (error)
    return (
      <p className="auth-error" role="alert">
        {t('work.loadFailed')}
      </p>
    );
  if (!data) return <p className="dash-loading">{t('dashboard.loading')}</p>;
  if (!data.length)
    return (
      <div className="dash-card empty-card">
        <p>{empty}</p>
      </div>
    );
  return null;
}

// Runs a staff action, shows the result, and reports whether it worked.
function useAction(notify) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      notify(done);
      return true;
    } catch {
      notify(t('work.actionFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

// ── Hub ────────────────────────────────────────────────────────────────────

function Hub({ api, reload, onOpen }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const summary = useLoad(api.summary, [reload]);
  const activity = useLoad(api.activity, [reload]);
  const s = summary.data;

  return (
    <>
      {summary.error && (
        <p className="auth-error" role="alert">
          {t('work.loadFailed')}
        </p>
      )}
      {!s && !summary.error && <p className="dash-loading">{t('dashboard.loading')}</p>}
      {s && (
        <div className="work-grid">
          {SECTIONS.map(({ key, count, tone }) => {
            const n = Number(s[count] ?? 0);
            return (
              <button key={key} type="button" className={`work-card tone-${tone}${n ? ' has-items' : ''}`} onClick={() => onOpen(key)}>
                <span className="work-card-label">{t(`work.summary.${key}.label`)}</span>
                <span className="work-card-count">
                  <b>{fmt.number(n)}</b> {t(`work.summary.${key}.suffix`)}
                </span>
                <span className="work-card-line">{t(`work.summary.${key}.line`)}</span>
                <span className="work-card-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            );
          })}
        </div>
      )}

      <section className="dash-card work-activity">
        <div className="dash-card-head">
          <h2>{t('work.activity.title')}</h2>
        </div>
        {activity.data && !activity.data.length && <p className="work-muted">{t('work.activity.empty')}</p>}
        {activity.data?.length > 0 && (
          <ul className="work-activity-list">
            {activity.data.map((a, i) => {
              const parts = (a.subject ?? '').split(' · ');
              const subject = parts.length > 1 ? parts.slice(1).join(' · ') : '';
              const label = t(`work.activity.${a.action}`);
              return (
                <li key={`${a.created_at}-${i}`}>
                  <span className={`pill ${a.action === 'resolved' ? 'pill-teal' : 'pill-muted'}`}>
                    {label.startsWith('work.') ? a.action : label}
                  </span>
                  <span className="work-activity-subject">{[subject, a.admin_name].filter(Boolean).join(' · ')}</span>
                  <time dateTime={a.created_at}>{fmt.dateTime(a.created_at)}</time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function OpenToggle({ open, setOpen, closedLabel }) {
  const { t } = useI18n();
  return (
    <div className="segmented work-toggle" role="group">
      <button type="button" aria-pressed={open} onClick={() => setOpen(true)}>
        {t('work.open')}
      </button>
      <button type="button" aria-pressed={!open} onClick={() => setOpen(false)}>
        {closedLabel}
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="work-field">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function NoteBox({ value, onChange, placeholder, label }) {
  return (
    <label className="work-note">
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function ImageLink({ url, alt, missing }) {
  if (!url) return <p className="work-muted">{missing}</p>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="work-image">
      <img src={url} alt={alt} loading="lazy" />
    </a>
  );
}

const name = (first, last) => [first, last].filter(Boolean).join(' ');
const tr = (t, key, fallback) => {
  const v = t(key);
  return v === key ? fallback : v;
};

// ── Reported problems ───────────────────────────────────────────────────────

function Problems({ api, reload, notify }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [openId, setOpenId] = useState(null);
  const list = useLoad(() => api.problems(open), [open, reload]);

  return (
    <>
      <OpenToggle open={open} setOpen={setOpen} closedLabel={t('work.resolved')} />
      <Status error={list.error} data={list.data} empty={t('work.problems.empty')} />
      <ul className="work-list">
        {list.data?.map((p) => (
          <ProblemCard
            key={p.dispute_id}
            p={p}
            api={api}
            expanded={openId === p.dispute_id}
            onToggle={() => setOpenId(openId === p.dispute_id ? null : p.dispute_id)}
            notify={notify}
            onDone={() => {
              setOpenId(null);
              list.refresh();
            }}
          />
        ))}
      </ul>
    </>
  );
}

function ProblemCard({ p, api, expanded, onToggle, notify, onDone }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [note, setNote] = useState(p.resolution ?? '');
  const [photos, setPhotos] = useState(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [busy, run] = useAction(notify);
  const isOpen = p.status === 'open' || p.status === 'under_review';
  const amount = p.amount ? fmt.money(Number(p.amount), p.currency) : '';
  const refundable =
    isOpen && p.payment_status === 'held' && p.payout_status !== 'processing' && p.payout_status !== 'paid';

  useEffect(() => {
    if (expanded && photos === null) api.photos(p.request_id).then(setPhotos).catch(() => setPhotos([]));
  }, [expanded, photos, api, p.request_id]);

  const paymentLine =
    p.payment_status === 'held'
      ? t('work.problems.held')
      : p.payment_status === 'released'
        ? t('work.problems.released')
        : p.payment_status === 'refunded'
          ? t('work.problems.refunded')
          : t('work.problems.noPayment');

  return (
    <li className={`work-item${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="work-item-head" onClick={onToggle} aria-expanded={expanded}>
        <div>
          <div className="work-item-tags">
            <span className="pill pill-coral">{tr(t, `work.problems.reasons.${p.reason}`, p.reason)}</span>
            <span className="pill pill-muted">{p.reported_by === 'sender' ? t('work.problems.bySender') : t('work.problems.byTraveler')}</span>
          </div>
          <b>{p.item_name || '—'}</b>
          <span className="work-muted">
            {[p.route, p.reporter_name, fmt.dateTime(p.created_at)].filter(Boolean).join(' · ')}
          </span>
        </div>
        <span className="work-chevron" aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>

      {expanded && (
        <div className="work-item-body">
          <Field label={t('work.problems.details')}>
            <p className="work-quote">{p.details || t('work.problems.noDetails')}</p>
          </Field>
          <div className="work-cols">
            <Field label={t('work.problems.sender')}>
              {p.sender_name}
              {p.sender_phone && (
                <>
                  <br />
                  <a href={`tel:${p.sender_phone}`}>{p.sender_phone}</a>
                </>
              )}
            </Field>
            <Field label={t('work.problems.traveler')}>
              {p.traveler_name}
              {p.traveler_phone && (
                <>
                  <br />
                  <a href={`tel:${p.traveler_phone}`}>{p.traveler_phone}</a>
                </>
              )}
            </Field>
          </div>
          <Field label={t('work.problems.timeline')}>
            <ol className="work-timeline">
              {[
                ['paid', p.paid_at],
                ['pickedUp', p.picked_up_at],
                ['delivered', p.delivered_at],
                ['reported', p.created_at],
              ].map(([k, d]) => (
                <li key={k} className={d ? 'done' : ''}>
                  <span>{t(`work.problems.${k}`)}</span>
                  <time>{d ? fmt.dateTime(d) : '—'}</time>
                </li>
              ))}
            </ol>
          </Field>
          {photos?.length > 0 && (
            <Field label={t('work.problems.photos')}>
              <div className="work-photos">
                {photos.map((ph, i) => (
                  <figure key={i}>
                    <ImageLink url={ph.url} alt={t(`work.problems.photo.${ph.kind}`)} />
                    <figcaption>{t(`work.problems.photo.${ph.kind}`)}</figcaption>
                  </figure>
                ))}
              </div>
            </Field>
          )}
          <Field label={t('work.problems.payment')}>{paymentLine.replace('{amount}', amount)}</Field>

          {isOpen ? (
            <>
              <NoteBox
                label={t('work.problems.note')}
                value={note}
                onChange={setNote}
                placeholder={t('work.problems.noteHint')}
              />
              {confirmRefund ? (
                <div className="work-confirm" role="alert">
                  <p>
                    {t('work.problems.refundConfirm').replace('{amount}', amount).replace('{name}', p.sender_name)}
                  </p>
                  <div className="work-actions">
                    <button type="button" className="btn-secondary btn-small" onClick={() => setConfirmRefund(false)} disabled={busy}>
                      {t('work.cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-small btn-danger"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => api.refund(p.dispute_id, note.trim()), t('work.problems.refundDone'))) onDone();
                      }}
                    >
                      {t('work.problems.confirmRefund')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="work-actions">
                  <button
                    type="button"
                    className="btn-primary btn-small"
                    disabled={busy}
                    onClick={async () => {
                      if (await run(() => api.resolve(p.dispute_id, note.trim()), t('work.problems.resolvedDone'))) onDone();
                    }}
                  >
                    {t('work.problems.markResolved')}
                  </button>
                  {refundable && (
                    <button type="button" className="btn-secondary btn-small" disabled={busy} onClick={() => setConfirmRefund(true)}>
                      {t('work.problems.refund')}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <Field label={t('work.problems.resolution')}>
              <p className="work-quote">{p.resolution || '—'}</p>
              {p.resolved_at && <span className="work-muted">{fmt.dateTime(p.resolved_at)}</span>}
            </Field>
          )}
        </div>
      )}
    </li>
  );
}

// ── Chat reports ───────────────────────────────────────────────────────────

function Reports({ api, reload, notify }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [openId, setOpenId] = useState(null);
  const list = useLoad(() => api.reports(open), [open, reload]);
  return (
    <>
      <OpenToggle open={open} setOpen={setOpen} closedLabel={t('work.reviewed')} />
      <Status error={list.error} data={list.data} empty={t('work.reports.empty')} />
      <ul className="work-list">
        {list.data?.map((r) => (
          <ReportCard
            key={r.id}
            r={r}
            api={api}
            expanded={openId === r.id}
            onToggle={() => setOpenId(openId === r.id ? null : r.id)}
            notify={notify}
            onDone={() => {
              setOpenId(null);
              list.refresh();
            }}
          />
        ))}
      </ul>
    </>
  );
}

function ReportCard({ r, api, expanded, onToggle, notify, onDone }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [messages, setMessages] = useState(null);
  const [note, setNote] = useState('');
  const [busy, run] = useAction(notify);
  const isOpen = r.status !== 'reviewed';

  useEffect(() => {
    if (expanded && messages === null) api.reportMessages(r.id).then(setMessages).catch(() => setMessages([]));
  }, [expanded, messages, api, r.id]);

  return (
    <li className={`work-item${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="work-item-head" onClick={onToggle} aria-expanded={expanded}>
        <div>
          <div className="work-item-tags">
            <span className="pill pill-coral">{tr(t, `work.reports.reasons.${r.reason}`, r.reason)}</span>
            {r.reported_count > 1 && (
              <span className="pill pill-muted">{t('work.reports.times').replace('{n}', fmt.number(r.reported_count))}</span>
            )}
            {r.blocked && <span className="pill pill-muted">{t('work.reports.blocked')}</span>}
          </div>
          <b>{r.reported_name || '—'}</b>
          <span className="work-muted">
            {t('work.reports.reportedBy')} {r.reporter_name} · {fmt.dateTime(r.created_at)}
          </span>
        </div>
        <span className="work-chevron" aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className="work-item-body">
          <div className="work-cols">
            <Field label={t('work.reports.reportedBy')}>{r.reporter_name}</Field>
            <Field label={t('work.reports.reportedMember')}>{r.reported_name}</Field>
          </div>
          {r.note && (
            <Field label={t('work.reports.note')}>
              <p className="work-quote">{r.note}</p>
            </Field>
          )}
          {r.message_body && (
            <Field label={t('work.reports.message')}>
              <p className="work-quote">{r.message_body}</p>
            </Field>
          )}
          <Field label={t('work.reports.conversation')}>
            {messages === null ? (
              <p className="dash-loading">{t('dashboard.loading')}</p>
            ) : messages.length ? (
              <ul className="work-chat">
                {messages.map((m) => {
                  const who = m.author_id === r.reported_id ? 'reported' : m.author_id === r.reporter_id ? 'reporter' : 'other';
                  return (
                    <li key={m.id} className={`from-${who}`}>
                      <span className="work-chat-meta">
                        {who === 'reported' ? r.reported_name : who === 'reporter' ? r.reporter_name : ''} ·{' '}
                        {fmt.dateTime(m.created_at)}
                      </span>
                      <span>{m.body || (m.has_photo ? t('work.reports.photo') : '')}</span>
                      {m.body && m.has_photo && <span className="work-muted">{t('work.reports.photo')}</span>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="work-muted">{t('work.reports.noMessages')}</p>
            )}
          </Field>
          {isOpen ? (
            <>
              <NoteBox label={t('work.reports.reviewNote')} value={note} onChange={setNote} placeholder={t('work.reports.reviewHint')} />
              <div className="work-actions">
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => api.reviewReport(r.id, note.trim()), t('work.reports.reviewedDone'))) onDone();
                  }}
                >
                  {t('work.reports.markReviewed')}
                </button>
              </div>
            </>
          ) : (
            <Field label={t('work.reports.reviewNote')}>
              <p className="work-quote">{r.review_note || '—'}</p>
              {r.reviewed_at && <span className="work-muted">{fmt.dateTime(r.reviewed_at)}</span>}
            </Field>
          )}
        </div>
      )}
    </li>
  );
}

// ── ID reviews ─────────────────────────────────────────────────────────────

function IdReviews({ api, reload, notify }) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState(null);
  const list = useLoad(api.idReviews, [reload]);
  return (
    <>
      <Status error={list.error} data={list.data} empty={t('work.ids.empty')} />
      <ul className="work-list">
        {list.data?.map((r) => (
          <IdCard
            key={r.user_id}
            r={r}
            api={api}
            expanded={openId === r.user_id}
            onToggle={() => setOpenId(openId === r.user_id ? null : r.user_id)}
            notify={notify}
            onDone={() => {
              setOpenId(null);
              list.refresh();
            }}
          />
        ))}
      </ul>
    </>
  );
}

function IdCard({ r, api, expanded, onToggle, notify, onDone }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [urls, setUrls] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction(notify);
  const hasSelfie = Boolean(r.selfie_path?.trim());

  useEffect(() => {
    if (!expanded || urls) return;
    Promise.all([api.idUrl(r.id_document_path), hasSelfie ? api.idUrl(r.selfie_path.trim()) : null])
      .then(([doc, selfie]) => setUrls({ doc, selfie }))
      .catch(() => setUrls({ doc: null, selfie: null }));
  }, [expanded, urls, api, r.id_document_path, r.selfie_path, hasSelfie]);

  const decide = async (approve) => {
    if (!approve && !note.trim()) {
      setError(t('work.ids.noteRequired'));
      return;
    }
    setError('');
    const done = approve ? (hasSelfie ? t('work.ids.verified') : t('work.ids.approved')) : t('work.ids.rejected');
    if (await run(() => api.reviewId(r.user_id, approve, approve ? '' : note.trim()), done)) onDone();
  };

  return (
    <li className={`work-item${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="work-item-head" onClick={onToggle} aria-expanded={expanded}>
        <div>
          <div className="work-item-tags">
            <span className="pill pill-coral">{tr(t, `work.ids.reasons.${r.review_reason}`, r.review_reason)}</span>
            <span className="pill pill-muted">{tr(t, `work.ids.docTypes.${r.id_document_type}`, r.id_document_type)}</span>
          </div>
          <b>{name(r.first_name, r.last_name) || '—'}</b>
          <span className="work-muted">{t('work.waitingSince').replace('{date}', fmt.dateTime(r.submitted_at))}</span>
        </div>
        <span className="work-chevron" aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className="work-item-body">
          <div className="work-cols">
            <Field label={t('work.ids.profileName')}>{name(r.first_name, r.last_name)}</Field>
            <Field label={t('work.ids.failedCheck')}>{tr(t, `work.ids.reasons.${r.review_reason}`, r.review_reason)}</Field>
            <Field label={t('work.ids.failures')}>{fmt.number(r.failures ?? 0)}</Field>
            {r.face_match_attempts > 0 && <Field label={t('work.ids.faceTries')}>{fmt.number(r.face_match_attempts)}</Field>}
          </div>
          <div className="work-photos work-photos-large">
            <figure>
              {urls ? (
                <ImageLink url={urls.doc} alt={t('work.ids.idImage')} missing={t('work.ids.noImage')} />
              ) : (
                <p className="dash-loading">{t('dashboard.loading')}</p>
              )}
              <figcaption>{tr(t, `work.ids.docTypes.${r.id_document_type}`, t('work.ids.idImage'))}</figcaption>
            </figure>
            {hasSelfie && (
              <figure>
                {urls ? <ImageLink url={urls.selfie} alt={t('work.ids.selfie')} missing={t('work.ids.noImage')} /> : null}
                <figcaption>{t('work.ids.selfie')}</figcaption>
              </figure>
            )}
          </div>
          <p className="work-hint">{hasSelfie ? t('work.ids.hintSelfie') : t('work.ids.hint')}</p>
          <NoteBox label={t('work.ids.rejectLabel')} value={note} onChange={setNote} placeholder={t('work.ids.rejectHint')} />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="work-actions">
            <button type="button" className="btn-primary btn-small" disabled={busy} onClick={() => decide(true)}>
              {hasSelfie ? t('work.ids.verify') : t('work.ids.approve')}
            </button>
            <button type="button" className="btn-secondary btn-small" disabled={busy} onClick={() => decide(false)}>
              {t('work.ids.reject')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Ticket reviews ───────────────────────────────────────────────────────────

function TicketReviews({ api, reload, notify }) {
  const { t } = useI18n();
  const [openId, setOpenId] = useState(null);
  const list = useLoad(api.ticketReviews, [reload]);
  return (
    <>
      <Status error={list.error} data={list.data} empty={t('work.tickets.empty')} />
      <ul className="work-list">
        {list.data?.map((r) => (
          <TicketCard
            key={r.trip_id}
            r={r}
            api={api}
            expanded={openId === r.trip_id}
            onToggle={() => setOpenId(openId === r.trip_id ? null : r.trip_id)}
            notify={notify}
            onDone={() => {
              setOpenId(null);
              list.refresh();
            }}
          />
        ))}
      </ul>
    </>
  );
}

function TicketCard({ r, api, expanded, onToggle, notify, onDone }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const [url, setUrl] = useState(undefined);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction(notify);
  const isPdf = (r.ticket_receipt_path ?? '').toLowerCase().endsWith('.pdf');
  const route = `${r.departure_city} → ${r.arrival_city}`;

  useEffect(() => {
    if (expanded && url === undefined) api.ticketUrl(r.ticket_receipt_path).then(setUrl).catch(() => setUrl(null));
  }, [expanded, url, api, r.ticket_receipt_path]);

  const decide = async (approve) => {
    if (!approve && !note.trim()) {
      setError(t('work.tickets.noteRequired'));
      return;
    }
    setError('');
    const done = approve ? t('work.tickets.approved') : t('work.tickets.rejected');
    if (await run(() => api.reviewTicket(r.trip_id, approve, approve ? '' : note.trim()), done)) onDone();
  };

  return (
    <li className={`work-item${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="work-item-head" onClick={onToggle} aria-expanded={expanded}>
        <div>
          <div className="work-item-tags">
            <span className="pill pill-coral">{tr(t, `work.tickets.reasons.${r.review_reason}`, r.review_reason)}</span>
          </div>
          <b>{route}</b>
          <span className="work-muted">
            {name(r.first_name, r.last_name)} · {t('work.waitingSince').replace('{date}', fmt.dateTime(r.requested_at))}
          </span>
        </div>
        <span className="work-chevron" aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className="work-item-body">
          <div className="work-cols">
            <Field label={t('work.tickets.traveler')}>{name(r.first_name, r.last_name)}</Field>
            <Field label={t('work.tickets.route')}>{route}</Field>
            <Field label={t('work.tickets.dates')}>
              {fmt.dayMonth(r.departure_date)} → {fmt.dayMonth(r.arrival_date)}
            </Field>
            {r.airline && <Field label={t('work.tickets.airline')}>{r.airline}</Field>}
            {r.booking_reference && <Field label={t('work.tickets.reference')}>{r.booking_reference}</Field>}
            <Field label={t('work.tickets.failedCheck')}>{tr(t, `work.tickets.reasons.${r.review_reason}`, r.review_reason)}</Field>
          </div>
          <div className="work-photos work-photos-large">
            <figure>
              {url === undefined ? (
                <p className="dash-loading">{t('dashboard.loading')}</p>
              ) : isPdf && url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-small">
                  {t('work.tickets.openPdf')}
                </a>
              ) : (
                <ImageLink url={url} alt={t('work.tickets.ticket')} missing={t('work.tickets.noImage')} />
              )}
            </figure>
          </div>
          <p className="work-hint">{t('work.tickets.hint')}</p>
          <NoteBox label={t('work.tickets.rejectLabel')} value={note} onChange={setNote} placeholder={t('work.tickets.rejectHint')} />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="work-actions">
            <button type="button" className="btn-primary btn-small" disabled={busy} onClick={() => decide(true)}>
              {t('work.tickets.approve')}
            </button>
            <button type="button" className="btn-secondary btn-small" disabled={busy} onClick={() => decide(false)}>
              {t('work.tickets.reject')}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Failed payments and locked deliveries ────────────────────────────────────

function FailedPayments({ api, reload, notify }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const list = useLoad(api.failed, [reload]);
  const [busy, run] = useAction(notify);
  return (
    <>
      <Status error={list.error} data={list.data} empty={t('work.payments.noneFailed')} />
      <ul className="work-list">
        {list.data?.map((p) => (
          <li key={`${p.kind}-${p.id}`} className="work-item">
            <div className="work-item-head work-item-static">
              <div>
                <div className="work-item-tags">
                  <span className={`pill ${p.kind === 'refund' ? 'pill-coral' : 'pill-muted'}`}>
                    {p.kind === 'refund' ? t('work.payments.refund') : t('work.payments.payout')}
                  </span>
                </div>
                <b>
                  {fmt.money(Number(p.amount), p.currency)} · {p.person_name}
                </b>
                {p.reason && <span className="work-muted">{t('work.payments.reason').replace('{reason}', p.reason)}</span>}
                <span className="work-muted">{fmt.dateTime(p.updated_at)}</span>
              </div>
              <button
                type="button"
                className="btn-primary btn-small"
                disabled={busy}
                onClick={async () => {
                  const done = p.kind === 'refund' ? t('work.payments.refundRequeued') : t('work.payments.payoutRequeued');
                  if (await run(() => api.retry(p.kind, p.id), done)) list.refresh();
                }}
              >
                {t('work.payments.retry')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function LockedDeliveries({ api, reload, notify }) {
  const { t, lang } = useI18n();
  const fmt = useFormatters(lang);
  const list = useLoad(api.locked, [reload]);
  const [confirm, setConfirm] = useState(null);
  const [busy, run] = useAction(notify);
  return (
    <>
      <Status error={list.error} data={list.data} empty={t('work.payments.noneLocked')} />
      <ul className="work-list">
        {list.data?.map((d) => (
          <li key={d.request_id} className="work-item">
            <div className="work-item-head work-item-static">
              <div>
                <div className="work-item-tags">
                  <span className="pill pill-coral">{t('work.payments.attempts').replace('{n}', fmt.number(d.attempts))}</span>
                </div>
                <b>{d.item_name || '—'}</b>
                <span className="work-muted">
                  {[d.route, `${t('work.problems.traveler')}: ${d.traveler_name}`, `${t('work.problems.sender')}: ${d.sender_name}`].join(' · ')}
                </span>
                {d.picked_up_at && (
                  <span className="work-muted">
                    {t('work.problems.pickedUp')} {fmt.dateTime(d.picked_up_at)}
                  </span>
                )}
              </div>
              {confirm !== d.request_id && (
                <button type="button" className="btn-secondary btn-small" onClick={() => setConfirm(d.request_id)}>
                  {t('work.payments.unlock')}
                </button>
              )}
            </div>
            {confirm === d.request_id && (
              <div className="work-item-body">
                <div className="work-confirm" role="alert">
                  <p>{t('work.payments.unlockConfirm').replace('{name}', d.traveler_name)}</p>
                  <div className="work-actions">
                    <button type="button" className="btn-secondary btn-small" onClick={() => setConfirm(null)} disabled={busy}>
                      {t('work.cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-small"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => api.unlock(d.request_id), t('work.payments.unlocked'))) {
                          setConfirm(null);
                          list.refresh();
                        }
                      }}
                    >
                      {t('work.payments.confirmUnlock')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
