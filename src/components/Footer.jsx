import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { NAV_SECTIONS } from './Header.jsx';
import Icon from './Icons.jsx';

export default function Footer() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const currentYear = new Date().getFullYear();
  const sectionHref = (id) => (pathname === '/' ? `#${id}` : `/#${id}`);

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-content">
          <div className="footer-column footer-brand">
            <Link to="/" className="footer-logo" aria-label="Nata">
              <img src="/images/nata-mark.jpg" alt="" />
              <span>Nata</span>
            </Link>
            <p className="footer-description">{t('footer.description')}</p>
          </div>

          <div className="footer-column">
            <h4 className="footer-heading">{t('footer.explore')}</h4>
            <ul className="footer-links">
              {NAV_SECTIONS.map((id) => (
                <li key={id}>
                  <a href={sectionHref(id)}>{t(`header.nav.${id}`)}</a>
                </li>
              ))}
            </ul>
          </div>

          <div className="footer-column footer-contact">
            <h4 className="footer-heading">{t('footer.contactHeading')}</h4>
            <a className="contact-item" href={`mailto:${t('footer.email')}`}>
              <Icon name="mail" />
              <span>{t('footer.email')}</span>
            </a>
            <div className="social-links">
              <a href="#" aria-label="Facebook">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M22 12C22 6.48 17.52 2 12 2S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z" />
                </svg>
              </a>
              <a href="#" aria-label="Instagram">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </a>
              <a href="#" aria-label="X">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.2 2.25h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9.1L.9 2.25h7l4.8 6.4 5.5-6.4zm-1.2 18h1.9L7.1 4.2H5.1l11.9 16.05z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>
            &copy; {currentYear} {t('footer.copyright')}
          </p>
          <p>
            <Link to="/privacy-policy" className="footer-legal-link">
              {t('footer.privacyPolicy')}
            </Link>
            <span className="sep">|</span>
            {t('footer.termsConditions')}
          </p>
        </div>
      </div>
    </footer>
  );
}
