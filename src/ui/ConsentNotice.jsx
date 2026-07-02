// ===========================================================================
// CONSENT NOTICE — lightweight privacy/cookie banner (standalone build only).
// ---------------------------------------------------------------------------
// CrazyGames' User Consent rule requires a privacy/T&C notice for new players
// because we run PostHog analytics beyond the CrazyGames SDK. This is a small,
// dismissible bottom banner in the dark/amber game theme. Dismissal is stored
// in localStorage so it shows once per browser.
//
// Mounted ONLY in crazygames-main.jsx (the standalone CrazyGames entry), never
// in the SlayFit portal build.
// ===========================================================================
import React from 'react';

const STORAGE_KEY = 'tc_consent_dismissed_v1';

function readDismissed() {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

export default function ConsentNotice() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Only reveal after mount (and only if not previously dismissed), so the
    // banner never blocks or flashes during the initial paint.
    if (!readDismissed()) setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Privacy notice"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        padding: '10px 16px',
        background: 'rgba(15, 12, 8, 0.94)',
        borderTop: '1px solid rgba(245, 176, 65, 0.35)',
        boxShadow: '0 -6px 24px rgba(0, 0, 0, 0.45)',
        color: '#f3ead9',
        font: '13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        backdropFilter: 'blur(4px)',
      }}
    >
      <span style={{ maxWidth: '640px', textAlign: 'center', opacity: 0.95 }}>
        This game uses cookies &amp; analytics to improve gameplay.{' '}
        <a
          href="./privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#f5b041', textDecoration: 'underline', fontWeight: 600 }}
        >
          Privacy Policy
        </a>
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{
          flex: '0 0 auto',
          cursor: 'pointer',
          padding: '6px 16px',
          borderRadius: '6px',
          border: '1px solid rgba(245, 176, 65, 0.55)',
          background: 'linear-gradient(180deg, #f5b041, #d68910)',
          color: '#1a1206',
          fontWeight: 700,
          fontSize: '13px',
        }}
      >
        Got it
      </button>
    </div>
  );
}
