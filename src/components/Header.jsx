import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { useAuth } from '../auth.jsx';

export const NAV_SECTIONS = ['how', 'why', 'payments', 'safety', 'faq'];

export default function Header() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { session, isAdmin } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
  }, [mobileMenuOpen]);

  const close = () => setMobileMenuOpen(false);
  // Section links work from any page: off the home page they go back to it first.
  const sectionHref = (id) => (pathname === '/' ? `#${id}` : `/#${id}`);

  return (
    <nav className={`header${isScrolled ? ' scrolled' : ''}`}>
      <div className="header-container">
        <Link to="/" className="logo" onClick={close} aria-label="Nata">
          <img src="/images/nata-mark.jpg" alt="" className="logo-mark" />
          <span className="logo-text">Nata</span>
        </Link>

        <button
          className={`mobile-toggle${mobileMenuOpen ? ' open' : ''}`}
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={t('header.toggleMenu')}
          aria-expanded={mobileMenuOpen}
        >
          <span />
          <span />
          <span />
        </button>

        <div className={`nav-wrapper${mobileMenuOpen ? ' mobile-open' : ''}`}>
          <div className="nav-overlay" onClick={close} />
          <div className="nav-content">
            <div className="nav-links">
              {NAV_SECTIONS.map((id) => (
                <a key={id} href={sectionHref(id)} onClick={close} className="nav-link">
                  {t(`header.nav.${id}`)}
                </a>
              ))}
            </div>
            <div className="nav-actions">
              <LanguageSwitcher />
              <Link to={isAdmin ? '/dashboard' : '/login'} onClick={close} className="nav-link nav-login">
                {isAdmin ? t('header.dashboard') : session ? t('header.account') : t('header.login')}
              </Link>
              <a href={sectionHref('download')} onClick={close} className="btn-primary btn-small">
                {t('header.cta')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
