// fx-auth.js — bridges the ported design screens to the real Firebase auth that
// the legacy Next.js app uses (email/password + a Firestore `users/{uid}` profile).
// Exposed on window.FXAuth so the window-global design modules can call it.
import { auth, db } from './firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

// Create the Firestore profile doc the first time a user appears (Google sign-in
// has no signup step). Never overwrites an existing profile or its plan.
async function ensureProfileDoc(user) {
  if (!user) return;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    const parts = (user.displayName || '').trim().split(/\s+/);
    await setDoc(ref, {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      email: user.email || '',
      createdAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) { /* non-fatal: profile fills in on next load */ }
}

function mapError(code, fallback) {
  return ({
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'No account found with that email.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again later or reset your password.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/popup-closed-by-user': 'Sign-in window closed before finishing.',
    'auth/cancelled-popup-request': 'Sign-in already in progress.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups and try again.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email. Sign in with your password instead.',
    'auth/operation-not-allowed': 'Google sign-in isn’t enabled yet. Use email & password.',
  }[code] || fallback || 'Something went wrong.');
}

window.FXAuth = {
  currentUser: () => auth.currentUser,
  ready: () => auth.authStateReady(),
  onChange: (cb) => onAuthStateChanged(auth, cb),
  signIn: (email, password) => signInWithEmailAndPassword(auth, String(email).trim(), password),
  signUp: async ({ firstName = '', lastName = '', email, password, ref = '' }) => {
    const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
    const name = `${firstName} ${lastName}`.trim();
    if (name) await updateProfile(cred.user, { displayName: name });
    const profile = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: String(email).trim(),
      createdAt: new Date().toISOString(),
    };
    // Attribution: explicit form field wins, else the captured ?ref= link code.
    // Written once at profile creation; rules make it immutable afterwards.
    let refCode = String(ref || '').trim();
    if (!refCode) { try { refCode = localStorage.getItem('fx_ref') || ''; } catch (e) {} }
    refCode = refCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 22);
    if (refCode.length >= 6) profile.referredBy = refCode;
    try { localStorage.removeItem('fx_ref'); } catch (e) {}
    await setDoc(doc(db, 'users', cred.user.uid), profile);
    return cred;
  },
  // Real Google OAuth via Firebase. Creates the profile doc on first sign-in.
  googleSignIn: async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    await ensureProfileDoc(cred.user);
    return cred;
  },
  reset: (email) => sendPasswordResetEmail(auth, String(email).trim()),
  signOut: () => signOut(auth),
  getProfile: async () => {
    const u = auth.currentUser;
    if (!u) return null;
    try {
      const snap = await getDoc(doc(db, 'users', u.uid));
      return snap.exists() ? snap.data() : null;
    } catch (e) {
      return null;
    }
  },
  // One-time webapp first-run flag — per account (Firestore), not per device,
  // so onboarding never re-appears on a new browser.
  markOnboarded: async () => {
    const u = auth.currentUser;
    if (!u) return;
    try { await setDoc(doc(db, 'users', u.uid), { webOnboarded: true }, { merge: true }); } catch (e) { /* non-critical */ }
  },
  mapError,
};

export {};
