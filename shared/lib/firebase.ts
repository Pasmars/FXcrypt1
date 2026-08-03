// Firebase client SDK — initialized once, browser-side.
// Same project/config as the legacy app, so all existing Cloud Functions,
// Auth users and Firestore data work unchanged.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: 'AIzaSyCpdVnFtB1dnlZmvfJ9srIBvgFl1ZqNLmQ',
  authDomain: 'pnl-calculator.firebaseapp.com',
  projectId: 'pnl-calculator',
  storageBucket: 'pnl-calculator.firebasestorage.app',
  messagingSenderId: '935070103115',
  appId: '1:935070103115:web:963a10b745483e2255bfce'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ── App Check ───────────────────────────────────────────────────────────────
// Attests that calls come from *this* app rather than a script holding a stolen
// ID token, and is what lets the backend refuse traffic from anything else.
//
// The reCAPTCHA site key is public by design (it ships in the page, like the
// apiKey above), so it lives here rather than in a secret. This is a reCAPTCHA
// ENTERPRISE score-based key, registered against this project's App Check
// recaptchaEnterpriseConfig — it must stay in sync with that registration and
// with admin/index.html, which uses the same key.
// While it is empty, App Check simply does not initialize — nothing breaks, and
// the backend stays in monitor-only mode.
const APP_CHECK_SITE_KEY = '6Lf2IGotAAAAADM5HJH1HSkGOcNZZu9aSazur6iK';

// Local development can't solve reCAPTCHA against a localhost origin, so the
// SDK's debug-token path is the only way to attest from a dev machine.
//
// But a debug token is minted per browser profile and only works once it has
// been pasted into App Check → Apps → Manage debug tokens. Setting this flag to
// `true` unconditionally therefore mints an UNREGISTERED token on every dev
// machine, and the exchange answers 403 — so every local page load logged
//   "AppCheck: Fetch server returned an HTTP error status. HTTP status: 403"
// and left window.__APPCHECK__ reading FAILED. Harmless in itself (nothing is
// enforced and the error is caught below), but it drowns out a REAL attestation
// failure, which is the one thing this diagnostic exists to make visible.
//
// So locally we attest only when a token has been supplied deliberately:
//   localStorage.setItem('FIREBASE_APPCHECK_DEBUG_TOKEN', '<token from console>')
// With no token, App Check simply does not initialize on localhost.
declare global { interface Window { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string } }
const IS_LOCAL = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
let localDebugToken: string | null = null;
if (IS_LOCAL) {
  try { localDebugToken = window.localStorage.getItem('FIREBASE_APPCHECK_DEBUG_TOKEN'); } catch (_) { /* storage blocked */ }
  if (localDebugToken) window.FIREBASE_APPCHECK_DEBUG_TOKEN = localDebugToken;
}

// Whether this browser can actually attest. Enforcement turns a failure here
// into "every Firebase call is rejected", which surfaces to the user as an
// opaque auth/internal-error — so it must be observable BEFORE enforcing, not
// diagnosed afterwards from user reports. Inspect with window.__APPCHECK__.
declare global { interface Window { __APPCHECK__?: Record<string, unknown> } }

// Opening the page with ?appcheck shows the result as an on-screen banner.
// The failure this diagnoses happens on phones too, where a DevTools console
// is not a realistic thing to ask anyone to open — so the answer has to be
// readable without one. Only renders when explicitly asked for.
function showAppCheckBanner(status: Record<string, unknown>) {
  if (typeof document === 'undefined') return;
  if (!/[?&]appcheck\b/.test(window.location.search)) return;
  const ok = status.state === 'ok';
  // "Off on purpose" is not a failure — showing it in alarm red would train
  // everyone to ignore the banner that actually matters.
  const skipped = status.state === 'skipped-localhost';
  const el = document.getElementById('__appcheck_banner') || document.createElement('div');
  el.id = '__appcheck_banner';
  el.setAttribute('style', [
    'position:fixed', 'inset:auto 8px 8px 8px', 'z-index:2147483647',
    'font:13px/1.45 ui-monospace,monospace', 'padding:12px 14px', 'border-radius:10px',
    'white-space:pre-wrap', 'word-break:break-word', 'max-height:45vh', 'overflow:auto',
    'color:#fff',
    `background:${ok ? '#11603a' : skipped ? '#3f3f46' : '#7f1d1d'}`,
    `border:1px solid ${ok ? '#22C55E' : skipped ? '#A1A1AA' : '#EF4444'}`,
  ].join(';'));
  el.textContent = (ok ? 'App Check OK\n' : skipped ? 'App Check OFF (localhost)\n' : 'App Check FAILED\n') + JSON.stringify(status, null, 1);
  if (!el.parentNode) document.body.appendChild(el);
}

if (APP_CHECK_SITE_KEY && typeof window !== 'undefined' && (!IS_LOCAL || localDebugToken)) {
  window.__APPCHECK__ = { state: 'initializing', key: APP_CHECK_SITE_KEY.slice(0, 12) + '…' };
  try {
    const ac = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
      // Keeps the token fresh so long sessions don't start failing mid-use.
      isTokenAutoRefreshEnabled: true,
    });
    // Actively probe once. reCAPTCHA is blocked outright by a good number of
    // privacy extensions and corporate proxies; that is invisible until it is
    // fatal, so find out now while enforcement is still off.
    getToken(ac, false)
      .then((r) => {
        window.__APPCHECK__ = { state: 'ok', tokenLength: (r?.token || '').length };
        showAppCheckBanner(window.__APPCHECK__);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        window.__APPCHECK__ = { state: 'FAILED', error: msg.slice(0, 300) };
        showAppCheckBanner(window.__APPCHECK__);
        console.warn('[appcheck] token acquisition FAILED — this browser would be ' +
          'locked out if App Check were enforced:', msg);
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.__APPCHECK__ = { state: 'INIT_FAILED', error: msg.slice(0, 300) };
    showAppCheckBanner(window.__APPCHECK__);
    // App Check must never be the reason the app fails to boot — if attestation
    // is broken the backend still has auth, rules and rate limits behind it.
    console.warn('[appcheck] init failed; continuing without attestation:', err);
  }
} else if (IS_LOCAL) {
  // Say so explicitly, so ?appcheck on a dev build reports "deliberately off"
  // rather than looking like a silent failure.
  window.__APPCHECK__ = {
    state: 'skipped-localhost',
    note: "App Check is off on localhost. To attest locally, set localStorage FIREBASE_APPCHECK_DEBUG_TOKEN to a token registered under App Check → Apps → Manage debug tokens, then reload.",
  };
  showAppCheckBanner(window.__APPCHECK__);
}

export const auth = getAuth(app);
export const db = getFirestore(app);
// Callable Cloud Functions live in europe-west1 (matches the legacy backend).
export const fns = getFunctions(app, 'europe-west1');
export default app;
