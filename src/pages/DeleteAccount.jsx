import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import Icon from '../components/Icons.jsx';

// Public page for Google Play's "Delete account URL": how to delete in the app, or ask by email.
export default function DeleteAccount() {
  const { t } = useI18n();
  const email = t('footer.email');
  const mailto = `mailto:${email}?subject=${encodeURIComponent(t('deleteAccount.emailSubject'))}&body=${encodeURIComponent(
    t('deleteAccount.emailBody'),
  )}`;
  // Puts the email address as a link where a text says {email}.
  const withEmail = (text) => {
    const [before, after] = text.split('{email}');
    return after === undefined ? (
      text
    ) : (
      <>
        {before}
        <a href={`mailto:${email}`}>{email}</a>
        {after}
      </>
    );
  };

  return (
    <main className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">
          <Icon name="back" size={18} />
          {t('privacy.back')}
        </Link>
        <h1>{t('deleteAccount.title')}</h1>
        <p className="legal-intro">{t('deleteAccount.intro')}</p>

        <div className="delete-options">
          <section className="delete-option">
            <span className="delete-badge">1</span>
            <h2>{t('deleteAccount.appTitle')}</h2>
            <ol>
              {t('deleteAccount.appSteps').map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <section className="delete-option">
            <span className="delete-badge">2</span>
            <h2>{t('deleteAccount.emailTitle')}</h2>
            <ol>
              {t('deleteAccount.emailSteps').map((step) => (
                <li key={step}>{withEmail(step)}</li>
              ))}
            </ol>
            <a className="btn-primary" href={mailto}>
              <Icon name="mail" size={18} />
              {t('deleteAccount.emailCta')}
            </a>
          </section>
        </div>

        <section>
          <h2>{t('deleteAccount.beforeTitle')}</h2>
          <ul>
            {t('deleteAccount.beforeItems').map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2>{t('deleteAccount.dataTitle')}</h2>
          <p>{t('deleteAccount.dataIntro')}</p>
          <ul>
            {t('deleteAccount.dataItems').map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{t('deleteAccount.dataNote')}</p>
        </section>

        <p className="support-footer">
          {(() => {
            const [before, after] = t('deleteAccount.help').split('{email}');
            const [middle, end] = after.split(t('footer.support'));
            return (
              <>
                {before}
                <a href={`mailto:${email}`}>{email}</a>
                {middle}
                <Link to="/support">{t('footer.support')}</Link>
                {end}
              </>
            );
          })()}
        </p>
      </div>
    </main>
  );
}
