import { useEffect, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import Icon from '../components/Icons.jsx';
import Reveal from '../components/Reveal.jsx';

const bubbles = Array.from({ length: 8 }, (_, i) => ({
  size: 24 + ((i * 17) % 50),
  left: (i * 13 + 5) % 95,
  top: (i * 29 + 10) % 85,
  duration: 7 + (i % 4) * 1.5,
  delay: i * 0.6,
}));

const floatingIcons = [
  { name: 'pin', left: 8, top: 22, delay: 0 },
  { name: 'box', left: 86, top: 18, delay: 1.2 },
  { name: 'plane', left: 14, top: 72, delay: 2.1 },
  { name: 'suitcase', left: 82, top: 70, delay: 0.7 },
  { name: 'send', left: 50, top: 88, delay: 1.6 },
];

const roles = [
  { key: 'sender', icon: 'send' },
  { key: 'traveler', icon: 'plane' },
  { key: 'recipient', icon: 'user' },
];

const whyFeatures = [
  { key: 'escrow', icon: 'shield' },
  { key: 'verified', icon: 'badge' },
  { key: 'pricing', icon: 'scale' },
  { key: 'code', icon: 'key' },
  { key: 'chat', icon: 'chat' },
  { key: 'reviews', icon: 'star' },
  { key: 'language', icon: 'globe' },
  { key: 'notify', icon: 'bell' },
];

const safetyIcons = ['pin', 'eye', 'shield', 'flag'];

function SectionHeader({ id }) {
  const { t } = useI18n();
  return (
    <Reveal className="section-header">
      <div className="section-badge">
        <Icon name="sparkle" size={16} />
        <span>{t(`home.${id}.badge`)}</span>
      </div>
      <h2 className="section-title">{t(`home.${id}.title`)}</h2>
      {t(`home.${id}.subtitle`) !== `home.${id}.subtitle` && (
        <p className="section-subtitle">{t(`home.${id}.subtitle`)}</p>
      )}
    </Reveal>
  );
}

function RoleModal({ role, onClose }) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const steps = t(`home.how.roles.${role.key}.steps`);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <div className="modal-icon">
          <Icon name={role.icon} />
        </div>
        <p className="modal-eyebrow">{t(`home.how.roles.${role.key}.category`)}</p>
        <h2 id="role-modal-title">{t(`home.how.roles.${role.key}.title`)}</h2>
        <p className="modal-description">{t(`home.how.roles.${role.key}.description`)}</p>
        <ol className="steps">
          {steps.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Faq() {
  const { t } = useI18n();
  const [open, setOpen] = useState(0);
  return (
    <div className="faq-list">
      {t('home.faq.items').map((item, i) => (
        <Reveal key={item.q} className={`faq-item${open === i ? ' open' : ''}`} delay={i * 60}>
          <button className="faq-question" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            <span>{item.q}</span>
            <Icon name="chevron" size={20} />
          </button>
          <div className="faq-answer">
            <p>{item.a}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

export default function Home() {
  const { t } = useI18n();
  const [selectedRole, setSelectedRole] = useState(null);
  const stats = ['fee', 'answer', 'code', 'countries'];

  return (
    <div>
      {/* Hero */}
      <section className="hero">
        <div className="bubbles-container" aria-hidden="true">
          {bubbles.map((b, i) => (
            <div
              key={i}
              className="bubble"
              style={{
                '--bubble-size': `${b.size}px`,
                '--bubble-duration': `${b.duration}s`,
                '--bubble-delay': `${b.delay}s`,
                left: `${b.left}%`,
                top: `${b.top}%`,
              }}
            />
          ))}
        </div>
        <div className="floating-icons-container" aria-hidden="true">
          {floatingIcons.map((f) => (
            <div
              key={f.name}
              className={`floating-icon floating-${f.name}`}
              style={{ left: `${f.left}%`, top: `${f.top}%`, animationDelay: `${f.delay}s` }}
            >
              <Icon name={f.name} size={26} />
            </div>
          ))}
        </div>

        <div className="hero-content">
          <div className="hero-text">
            <Reveal className="hero-badge">
              <Icon name="sparkle" size={16} />
              <span>{t('home.hero.badge')}</span>
            </Reveal>
            <Reveal as="h1" className="hero-title" delay={80}>
              {t('home.hero.title.line1')}{' '}
              <span className="title-highlight">{t('home.hero.title.highlight')}</span>
              {t('home.hero.title.line2')}
            </Reveal>
            <Reveal as="p" className="hero-subtitle" delay={160}>
              {t('home.hero.subtitle')}
            </Reveal>
            <Reveal className="hero-buttons" delay={240}>
              <a href="#how" className="btn-primary">
                {t('home.hero.buttons.send')}
                <Icon name="arrow" size={18} />
              </a>
              <a href="#how" className="btn-secondary">
                {t('home.hero.buttons.carry')}
              </a>
            </Reveal>
          </div>
          <Reveal className="hero-visual" delay={200}>
            <img src="/images/nata-hero-handover.jpg" alt="" />
          </Reveal>
        </div>

        <Reveal className="hero-stats" delay={320}>
          {stats.map((key) => (
            <div className="stat-item" key={key}>
              <div className="stat-value">{t(`home.hero.stats.${key}.value`)}</div>
              <div className="stat-label">{t(`home.hero.stats.${key}.label`)}</div>
            </div>
          ))}
        </Reveal>
      </section>

      {/* How it works */}
      <section id="how" className="section">
        <SectionHeader id="how" />
        <div className="roles-grid">
          {roles.map((role, i) => (
            <Reveal key={role.key} className="role-card" delay={i * 100}>
              <button className="role-card-inner" onClick={() => setSelectedRole(role)}>
                <div className={`role-banner role-${role.key}`}>
                  <Icon name={role.icon} size={34} />
                </div>
                <div className="role-content">
                  <h3 className="role-title">{t(`home.how.roles.${role.key}.title`)}</h3>
                  <p className="role-category">{t(`home.how.roles.${role.key}.category`)}</p>
                  <p className="role-description">{t(`home.how.roles.${role.key}.description`)}</p>
                  <ul className="feature-list">
                    {t(`home.how.roles.${role.key}.features`).map((f) => (
                      <li key={f}>
                        <Icon name="check" size={16} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="role-link">
                    {t('home.how.seeSteps')} <Icon name="arrow" size={16} />
                  </span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Why Nata */}
      <section id="why" className="section section-tinted">
        <SectionHeader id="why" />
        <div className="why-layout">
          <Reveal className="why-visual">
            <img src="/images/nata-mark-orbit.jpg" alt="" />
          </Reveal>
          <div className="why-grid">
            {whyFeatures.map((f, i) => (
              <Reveal key={f.key} className="why-card" delay={(i % 2) * 80}>
                <div className="why-icon">
                  <Icon name={f.icon} size={22} />
                </div>
                <div>
                  <h3>{t(`home.why.features.${f.key}.title`)}</h3>
                  <p>{t(`home.why.features.${f.key}.text`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Rules */}
      <section id="rules" className="section">
        <SectionHeader id="rules" />
        <div className="rules-grid">
          {t('home.rules.items').map((item, i) => (
            <Reveal key={item.label} className="rule-card" delay={i * 60}>
              <b>{item.value}</b>
              <span>{item.label}</span>
            </Reveal>
          ))}
        </div>
        <Reveal className="callout">
          <h3>{t('home.rules.cancel.title')}</h3>
          <p>{t('home.rules.cancel.text')}</p>
        </Reveal>
      </section>

      {/* Payments */}
      <section id="payments" className="section section-dark">
        <SectionHeader id="payments" />
        <div className="payments-grid">
          {[
            { key: 'card', icon: 'card' },
            { key: 'mobile', icon: 'phone' },
            { key: 'payout', icon: 'bank' },
          ].map((p, i) => (
            <Reveal key={p.key} className="payment-card" delay={i * 100}>
              <div className="payment-icon">
                <Icon name={p.icon} />
              </div>
              <h3>{t(`home.payments.${p.key}.title`)}</h3>
              <p>{t(`home.payments.${p.key}.text`)}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="countries">
          <p className="countries-title">{t('home.payments.countriesTitle')}</p>
          <ul>
            {t('home.payments.countries').map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Reveal>
      </section>

      {/* Safety */}
      <section id="safety" className="section">
        <SectionHeader id="safety" />
        <div className="safety-layout">
          <ol className="safety-list">
            {t('home.safety.items').map((item, i) => (
              <Reveal as="li" key={item.title} delay={i * 80}>
                <div className="safety-icon">
                  <Icon name={safetyIcons[i]} size={22} />
                </div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="section section-tinted">
        <SectionHeader id="faq" />
        <Faq />
      </section>

      {/* Download CTA */}
      <section id="download" className="cta-section">
        <Reveal className="cta-card">
          <div className="cta-text">
            <h2>{t('home.cta.title')}</h2>
            <p>{t('home.cta.subtitle')}</p>
            <div className="store-buttons">
              <a href="#" className="store-btn">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M16.4 12.6c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.3-2.1-4-2.1-1.7-.2-3.3 1-4.2 1-.9 0-2.2-1-3.6-1-1.9 0-3.6 1.1-4.5 2.7-1.9 3.4-.5 8.3 1.4 11 .9 1.3 2 2.8 3.4 2.8 1.4-.1 1.9-.9 3.5-.9s2.1.9 3.6.9c1.5 0 2.4-1.4 3.3-2.7 1-1.5 1.5-3 1.5-3.1-.1 0-2.7-1-2.7-4.5zM13.7 4.6c.8-.9 1.3-2.2 1.1-3.5-1.1 0-2.4.7-3.2 1.7-.7.8-1.3 2.1-1.2 3.4 1.3.1 2.5-.6 3.3-1.6z" />
                </svg>
                <span>
                  <small>{t('home.cta.appStore.small')}</small>
                  <b>{t('home.cta.appStore.big')}</b>
                </span>
              </a>
              <a href="#" className="store-btn">
                <svg width="20" height="22" viewBox="0 0 24 26" fill="currentColor" aria-hidden="true">
                  <path d="M1.2.5C.9.8.7 1.3.7 1.9v22.2c0 .6.2 1.1.5 1.4l12.4-12.5L1.2.5zM17.7 17.1l-4.1-4.1L17.7 9l5 2.8c1.4.8 1.4 2.1 0 2.9l-5 2.4zM16.4 18.4L12.4 14.3 1.9 25.1c.4.4 1.1.4 1.8 0l12.7-6.7zM16.4 7.6L3.7.9C3 .5 2.3.6 1.9 1l10.5 10.6 4-4z" />
                </svg>
                <span>
                  <small>{t('home.cta.googlePlay.small')}</small>
                  <b>{t('home.cta.googlePlay.big')}</b>
                </span>
              </a>
            </div>
          </div>
          <img className="cta-logo" src="/images/nata-logo-full.jpg" alt="Nata" />
        </Reveal>
      </section>

      {selectedRole && <RoleModal role={selectedRole} onClose={() => setSelectedRole(null)} />}
    </div>
  );
}
