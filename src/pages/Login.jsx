import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { COUNTRIES, isAccountNotFound, supabase, toE164 } from '../supabase.js';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const MIN_PASSWORD = 8;

function CodeInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');

  const setAt = (index, char) => {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join('').slice(0, CODE_LENGTH));
  };

  const handleChange = (index, raw) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return setAt(index, '');
    // A pasted or autofilled code arrives in one box: spread it over the boxes from here.
    if (typed.length > 1) {
      const next = (value.slice(0, index) + typed).slice(0, CODE_LENGTH);
      onChange(next);
      refs.current[Math.min(next.length, CODE_LENGTH - 1)]?.focus();
      return undefined;
    }
    setAt(index, typed);
    refs.current[index + 1]?.focus();
    return undefined;
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) refs.current[index - 1]?.focus();
  };

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  return (
    <div className="code-inputs">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? CODE_LENGTH : 1}
          aria-label={`${i + 1}`}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, placeholder }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="password-input">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('login.hidePassword') : t('login.showPassword')}
        aria-pressed={shown}
      >
        <Icon name={shown ? 'eyeOff' : 'eye'} size={20} />
      </button>
    </div>
  );
}

export default function Login() {
  const { t, lang } = useI18n();
  // login → (forgot password) code → newPassword → done
  const [step, setStep] = useState('login');
  const [countryIso, setCountryIso] = useState('US');
  const [localNumber, setLocalNumber] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [session, setSession] = useState(null);
  const [passwordWasSet, setPasswordWasSet] = useState(false);

  const country = COUNTRIES.find((c) => c.iso === countryIso);
  const phone = toE164(country, localNumber);

  const countryOptions = useMemo(() => {
    const names = new Intl.DisplayNames([lang], { type: 'region' });
    return COUNTRIES.map((c) => ({ ...c, name: names.of(c.iso) })).sort((a, b) =>
      a.name.localeCompare(b.name, lang),
    );
  }, [lang]);

  const auth = useAuth();
  // Someone already signed in (e.g. coming back to /login) skips straight to the signed-in screen.
  useEffect(() => {
    if (auth.session && step === 'login') {
      setSession(auth.session);
      setStep('done');
    }
  }, [auth.session, step]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const goTo = (next) => {
    setError('');
    setStep(next);
  };

  // Shared guard for both actions that start from the phone number.
  const checkPhone = () => {
    if (!supabase) return t('login.errors.notConfigured');
    if (localNumber.replace(/\D/g, '').length < 6) return t('login.errors.invalidPhone');
    return '';
  };

  const signIn = async () => {
    const problem = checkPhone() || (!password && t('login.errors.passwordRequired'));
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ phone, password });
    setBusy(false);
    if (err) return setError(err.code === 'invalid_credentials' || err.status === 400 ? t('login.errors.badCredentials') : t('login.errors.signInFailed'));
    setSession(data.session);
    setPassword('');
    setStep('done');
    return undefined;
  };

  // Forgot password / first time on the web: prove the number with an SMS code, then pick a password.
  const sendCode = async () => {
    const problem = checkPhone();
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    // Website passwords are for staff only: don't text a code to a number outside nata.admins.
    const { data: staff, error: checkErr } = await supabase.rpc('is_staff_phone', { p_phone: phone });
    if (checkErr || staff !== true) {
      setBusy(false);
      return setError(checkErr ? t('login.errors.sendFailed') : t('login.errors.notStaff'));
    }
    // Never creates an account: an unknown number gets no SMS, as in the app.
    const { error: err } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
    setBusy(false);
    if (err) return setError(isAccountNotFound(err) ? t('login.errors.noAccount') : t('login.errors.sendFailed'));
    setCode('');
    setStep('code');
    setResendIn(RESEND_SECONDS);
    return undefined;
  };

  const verifyCode = async (token) => {
    setError('');
    setBusy(true);
    const { data, error: err } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (err) {
      setBusy(false);
      setCode('');
      return setError(t('login.errors.wrongCode'));
    }
    // Website passwords are for staff only (nata.admins); the database refuses anyone else too.
    const { data: staff } = await supabase.rpc('am_i_admin');
    setBusy(false);
    if (staff !== true) {
      await auth.signOut();
      setCode('');
      setStep('forgot');
      return setError(t('login.errors.staffOnly'));
    }
    setSession(data.session);
    setNewPassword('');
    setConfirmPassword('');
    setStep('newPassword');
    return undefined;
  };

  const handleCodeChange = (next) => {
    setCode(next);
    if (next.length === CODE_LENGTH && !busy) verifyCode(next);
  };

  const savePassword = async () => {
    if (newPassword.length < MIN_PASSWORD) return setError(t('login.errors.passwordTooShort').replace('{n}', MIN_PASSWORD));
    if (newPassword !== confirmPassword) return setError(t('login.errors.passwordMismatch'));
    setError('');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (err) {
      if (err.code === 'weak_password') return setError(t('login.errors.weakPassword'));
      // The auth.users trigger answers 'nata:password_staff_only' for accounts outside nata.admins.
      if (/password_staff_only/.test(err.message ?? '')) {
        await auth.signOut();
        setStep('forgot');
        return setError(t('login.errors.staffOnly'));
      }
      return setError(t('login.errors.saveFailed'));
    }
    setPasswordWasSet(true);
    setStep('done');
    return undefined;
  };

  const signOut = async () => {
    await auth.signOut();
    setSession(null);
    setPassword('');
    setCode('');
    setPasswordWasSet(false);
    setStep('login');
  };

  const submit = (action) => (e) => {
    e.preventDefault();
    action();
  };

  const phoneField = (
    <>
      <label className="field-label" htmlFor="phone">
        {t('login.phoneLabel')}
      </label>
      <div className="phone-field">
        <select value={countryIso} onChange={(e) => setCountryIso(e.target.value)} aria-label={t('login.countryLabel')}>
          {countryOptions.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.flag} {c.name} (+{c.dial})
            </option>
          ))}
        </select>
        <div className="phone-input">
          <span>
            {country.flag} +{country.dial}
          </span>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder={t('login.phonePlaceholder')}
            value={localNumber}
            onChange={(e) => setLocalNumber(e.target.value)}
          />
        </div>
      </div>
    </>
  );

  // Staff land on the dashboard once signed in; other members keep the signed-in screen.
  if (step === 'done' && !auth.loading && auth.isAdmin) return <Navigate to="/dashboard" replace />;

  const errorBox = error && (
    <p className="auth-error" role="alert">
      {error}
    </p>
  );

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <aside className="auth-aside">
          <img src="/images/nata-hero-handover.jpg" alt="" />
          <h2>{t('login.aside.title')}</h2>
          <ul>
            {t('login.aside.benefits').map((b) => (
              <li key={b}>
                <Icon name="check" size={18} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="auth-card">
          <Link to="/" className="auth-close" aria-label={t('login.backHome')}>
            <Icon name="close" size={20} />
          </Link>
          <img src="/images/nata-mark.jpg" alt="" className="auth-mark" />

          {step === 'login' && (
            <form onSubmit={submit(signIn)}>
              <h1>{t('login.title')}</h1>
              <p className="auth-sub">{t('login.subtitle')}</p>
              {phoneField}
              <div className="field-row">
                <label className="field-label" htmlFor="password">
                  {t('login.passwordLabel')}
                </label>
                <button type="button" className="link-btn small" onClick={() => goTo('forgot')}>
                  {t('login.forgot')}
                </button>
              </div>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                placeholder={t('login.passwordPlaceholder')}
              />
              {errorBox}
              <button type="submit" className="btn-primary auth-submit" disabled={busy}>
                {busy ? t('login.signingIn') : t('login.signIn')}
              </button>
              <p className="auth-note">
                {t('login.firstTime')}{' '}
                <button type="button" className="link-btn inline" onClick={() => goTo('forgot')}>
                  {t('login.setPasswordLink')}
                </button>
              </p>
              <p className="auth-switch">
                {t('login.noAccount')} <a href="/#download">{t('login.getApp')}</a>
              </p>
            </form>
          )}

          {step === 'forgot' && (
            <form onSubmit={submit(sendCode)}>
              <h1>{t('login.forgotTitle')}</h1>
              <p className="auth-sub">{t('login.forgotSubtitle')}</p>
              {phoneField}
              {errorBox}
              <button type="submit" className="btn-primary auth-submit" disabled={busy}>
                {busy ? t('login.sending') : t('login.sendCode')}
              </button>
              <p className="auth-note">{t('login.smsNote')}</p>
              <p className="auth-switch">
                <button type="button" className="link-btn" onClick={() => goTo('login')}>
                  {t('login.backToSignIn')}
                </button>
              </p>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={submit(() => code.length === CODE_LENGTH && verifyCode(code))}>
              <h1>{t('login.codeTitle')}</h1>
              <p className="auth-sub">
                {t('login.codeSentTo')} <b>{phone}</b>
              </p>
              <CodeInput value={code} onChange={handleCodeChange} disabled={busy} />
              {errorBox}
              <button type="submit" className="btn-primary auth-submit" disabled={busy || code.length < CODE_LENGTH}>
                {busy ? t('login.verifying') : t('login.verify')}
              </button>
              <div className="auth-row">
                <button type="button" className="link-btn" onClick={() => goTo('forgot')}>
                  {t('login.changeNumber')}
                </button>
                <button type="button" className="link-btn" onClick={sendCode} disabled={busy || resendIn > 0}>
                  {resendIn > 0 ? t('login.resendIn').replace('{s}', resendIn) : t('login.resend')}
                </button>
              </div>
              <p className="auth-note">{t('login.notReceived')}</p>
            </form>
          )}

          {step === 'newPassword' && (
            <form onSubmit={submit(savePassword)}>
              <h1>{t('login.newPasswordTitle')}</h1>
              <p className="auth-sub">{t('login.newPasswordSubtitle').replace('{n}', MIN_PASSWORD)}</p>
              <label className="field-label" htmlFor="new-password">
                {t('login.newPasswordLabel')}
              </label>
              <PasswordInput id="new-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
              <label className="field-label spaced" htmlFor="confirm-password">
                {t('login.confirmPasswordLabel')}
              </label>
              <PasswordInput
                id="confirm-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
              {errorBox}
              <button type="submit" className="btn-primary auth-submit" disabled={busy}>
                {busy ? t('login.saving') : t('login.savePassword')}
              </button>
            </form>
          )}

          {step === 'done' && (
            <div className="auth-done">
              <div className="done-icon">
                <Icon name="check" size={30} />
              </div>
              <h1>{passwordWasSet ? t('login.passwordSavedTitle') : t('login.doneTitle')}</h1>
              <p className="auth-sub">
                {t('login.doneText')} <b>{session?.user?.phone ? `+${session.user.phone.replace(/^\+/, '')}` : ''}</b>
              </p>
              <p className="auth-note">{t('login.doneHint')}</p>
              <a href="/#download" className="btn-primary auth-submit">
                {t('login.getApp')}
              </a>
              <button type="button" className="link-btn" onClick={signOut}>
                {t('login.signOut')}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
