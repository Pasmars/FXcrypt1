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

// Local development can't solve reCAPTCHA against a localhost origin. Setting
// this makes the SDK print a debug token to the console; register that token
// under App Check → Apps → Manage debug tokens to let a dev machine through.
declare global { interface Window { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string } }
if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

// Whether this browser can actually attest. Enforcement turns a failure here
// into "every Firebase call is rejected", which surfaces to the user as an
// opaque auth/internal-error — so it must be observable BEFORE enforcing, not
// diagnosed afterwards from user reports. Inspect with window.__APPCHECK__.
declare global { interface Window { __APPCHECK__?: Record<string, unknown> } }

if (APP_CHECK_SITE_KEY && typeof window !== 'undefined') {
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
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        window.__APPCHECK__ = { state: 'FAILED', error: msg.slice(0, 300) };
        console.warn('[appcheck] token acquisition FAILED — this browser would be ' +
          'locked out if App Check were enforced:', msg);
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.__APPCHECK__ = { state: 'INIT_FAILED', error: msg.slice(0, 300) };
    // App Check must never be the reason the app fails to boot — if attestation
    // is broken the backend still has auth, rules and rate limits behind it.
    console.warn('[appcheck] init failed; continuing without attestation:', err);
  }
}

export const auth = getAuth(app);
export const db = getFirestore(app);
// Callable Cloud Functions live in europe-west1 (matches the legacy backend).
export const fns = getFunctions(app, 'europe-west1');
export default app;
