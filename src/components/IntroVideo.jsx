import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';

const SEEN_KEY = 'nata-intro-seen';

// Shown once per browser session, on the first visit to the home page.
function alreadySeen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

// Smaller file on phones and narrow windows.
function pickSource() {
  const small = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
  return small ? '/videos/intro-480.mp4' : '/videos/intro-720.mp4';
}

export default function IntroVideo() {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => !alreadySeen());
  const [closing, setClosing] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef(null);
  const skipRef = useRef(null);
  const [src] = useState(pickSource);

  const close = useCallback(() => {
    markSeen();
    videoRef.current?.pause();
    setClosing(true);
    setTimeout(() => setOpen(false), 350);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    // A class on <html> so the header's own body-overflow handling can't undo the lock.
    document.documentElement.classList.add('intro-open');
    skipRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('intro-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!open) return null;

  const toggleSound = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) {
      // Restart with sound the first time so the story isn't missed.
      if (v.currentTime < 8) v.currentTime = 0;
      v.play().catch(() => {});
    }
  };

  return (
    <div
      className={`intro-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('intro.label')}
    >
      <div className="intro-frame">
        <video
          ref={videoRef}
          className="intro-video"
          src={src}
          poster="/videos/intro-poster.jpg"
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={close}
          onError={close}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress(v.currentTime / v.duration);
          }}
          onClick={toggleSound}
        />
        <div className="intro-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="intro-controls">
          <button type="button" className="intro-btn intro-sound" onClick={toggleSound} aria-pressed={!muted}>
            {muted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 5a10 10 0 0 1 0 14" />
              </svg>
            )}
            <span>{muted ? t('intro.soundOn') : t('intro.soundOff')}</span>
          </button>
          <button type="button" ref={skipRef} className="intro-btn intro-skip" onClick={close}>
            <span>{t('intro.skip')}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
