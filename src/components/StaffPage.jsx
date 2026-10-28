import { Link, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { supabase } from '../supabase.js';
import Icon from './Icons.jsx';

const TABS = [
  { to: '/dashboard', key: 'overview' },
  { to: '/feedback', key: 'feedback' },
  { to: '/routes', key: 'routes' },
];

// Wraps every staff page: signed-out visitors go to /login, members who aren't staff
// (nata.admins) get a "Staff only" page. `demo` (dev-only preview routes) skips the checks.
export default function StaffPage({ demo = false, title, actions, children }) {
  const { t } = useI18n();
  const { session, isAdmin, loading, signOut } = useAuth();
  const { pathname } = useLocation();
  const preview = pathname.endsWith('/preview');

  if (!demo) {
    if (!supabase) return <Navigate to="/login" replace />;
    if (loading) {
      return (
        <main className="dash-page">
          <p className="dash-loading">{t('dashboard.loading')}</p>
        </main>
      );
    }
    if (!session) return <Navigate to="/login" replace />;
    if (!isAdmin) {
      return (
        <main className="dash-page">
          <div className="dash-denied">
            <Icon name="shield" size={32} />
            <h1>{t('dashboard.denied.title')}</h1>
            <p>{t('dashboard.denied.text')}</p>
            <div className="dash-denied-actions">
              <Link to="/" className="btn-secondary">
                {t('login.backHome')}
              </Link>
              <button type="button" className="link-btn" onClick={signOut}>
                {t('login.signOut')}
              </button>
            </div>
          </div>
        </main>
      );
    }
  }

  return (
    <main className="dash-page">
      <div className="dash-container">
        <header className="dash-header">
          <div>
            <p className="dash-eyebrow">{t('dashboard.eyebrow')}</p>
            <h1>{title}</h1>
          </div>
          <div className="dash-actions">
            {actions}
            <button type="button" className="link-btn" onClick={demo ? undefined : signOut}>
              {t('login.signOut')}
            </button>
          </div>
        </header>
        <nav className="staff-tabs" aria-label={t('staff.tabsLabel')}>
          {TABS.map((tab) => (
            <NavLink key={tab.key} to={preview ? `${tab.to}/preview` : tab.to} end>
              {t(`staff.tabs.${tab.key}`)}
            </NavLink>
          ))}
        </nav>
        {children}
      </div>
    </main>
  );
}
