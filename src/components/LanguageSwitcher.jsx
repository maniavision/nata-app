import { LANGUAGES, useI18n } from '../i18n.jsx';

export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="lang-switch" role="group" aria-label={t('header.language')}>
      {LANGUAGES.map(({ code, label, name }) => (
        <button
          key={code}
          type="button"
          title={name}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
