import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import Icon from '../components/Icons.jsx';

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
        {t('privacy.sections').map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
