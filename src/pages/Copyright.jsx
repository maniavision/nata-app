import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import Icon from '../components/Icons.jsx';
import LegalSections from '../components/LegalSections.jsx';

// Public copyright notice (the app stores' "Copyright").
export default function Copyright() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <main className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">
          <Icon name="back" size={18} />
          {t('privacy.back')}
        </Link>
        <h1>{t('copyright.title')}</h1>
        <p className="copyright-notice">{t('copyright.notice').replace('{year}', year)}</p>
        <p className="legal-intro">{t('copyright.intro')}</p>
        <LegalSections sections={t('copyright.sections')} />
      </div>
    </main>
  );
}
