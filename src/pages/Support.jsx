import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import Icon from '../components/Icons.jsx';
import LegalSections from '../components/LegalSections.jsx';

// Public support page (the app stores' "Support URL").
export default function Support() {
  const { t } = useI18n();
  const email = t('footer.email');

  return (
    <main className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">
          <Icon name="back" size={18} />
          {t('privacy.back')}
        </Link>
        <h1>{t('support.title')}</h1>
        <p className="legal-intro">{t('support.intro')}</p>

        <div className="support-contact">
          <a className="btn-primary" href={`mailto:${email}`}>
            <Icon name="mail" size={18} />
            {t('support.emailCta')}
          </a>
          <div>
            <b>{email}</b>
            <p>{t('support.emailNote')}</p>
          </div>
        </div>

        <LegalSections sections={t('support.topics')} />

        <section className="support-footer">
          <h2>{t('support.contactTitle')}</h2>
          <p>
            {t('support.contactText').split('{email}')[0]}
            <a href={`mailto:${email}`}>{email}</a>
            {t('support.contactText').split('{email}')[1]}
          </p>
          <p className="legal-links">
            <Link to="/privacy-policy">{t('footer.privacyPolicy')}</Link>
            <span aria-hidden="true">·</span>
            <Link to="/copyright">{t('footer.copyrightLink')}</Link>
            <span aria-hidden="true">·</span>
            <Link to="/delete-account">{t('footer.deleteAccount')}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
