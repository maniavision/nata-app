import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import Icon from '../components/Icons.jsx';
import LegalSections from '../components/LegalSections.jsx';

export default function PrivacyPolicy() {
  const { t } = useI18n();

  return (
    <main className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">
          <Icon name="back" size={18} />
          {t('privacy.back')}
        </Link>
        <h1>{t('privacy.title')}</h1>
        <p className="legal-updated">{t('privacy.updated')}</p>
        <p className="legal-intro">{t('privacy.intro')}</p>
        <LegalSections sections={t('privacy.sections')} />
      </div>
    </main>
  );
}
