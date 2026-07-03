// fx-push.js — FCM web-push registration + notification preferences.
//
// Opt-in only: the browser permission prompt fires ONLY from enable(), i.e.
// after an explicit user action — never on page load. Tokens are stored per
// device at users/{uid}/devices/{hash}; per-category mutes live on
// users/{uid}.notifyPrefs and are enforced server-side (lib/notify.js).
//
// Exposed as window.FXPush for the window-global screens.
import app, { auth, db } from './firebase';
import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

const LS_KEY = 'fx_push_token';

// Stable short id for a token (doc id — tokens themselves are ~150 chars).
function tokenId(token) {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) >>> 0;
  return 'd' + h.toString(16);
}

// Register (or reuse) the app service worker — also restores the PWA cache
// layer, which shipped in public/sw.js but was never registered until now.
async function swReady() {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers unsupported');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

async function messagingMod() {
  // Dynamic import keeps firebase/messaging out of the critical bundle path.
  return import('firebase/messaging');
}

async function supported() {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
    const m = await messagingMod();
    return await m.isSupported();
  } catch (e) { return false; }
}

function status() {
  return {
    permission: ('Notification' in window) ? Notification.permission : 'unsupported',
    enabled: !!localStorage.getItem(LS_KEY),
  };
}

// Explicit user action → permission prompt → token → device doc.
async function enable() {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in to enable notifications.');
  if (!(await supported())) throw new Error('Push is not supported in this browser.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked — allow them in your browser settings.');
  const m = await messagingMod();
  const reg = await swReady();
  const messaging = m.getMessaging(app);
  const token = await m.getToken(messaging, { serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not get a push token — try again.');
  await setDoc(doc(db, 'users', u.uid, 'devices', tokenId(token)), {
    token, ua: String(navigator.userAgent).slice(0, 160),
    createdAt: Date.now(), lastSeenAt: Date.now(),
  });
  try { localStorage.setItem(LS_KEY, token); } catch (e) {}
  wireForeground();
  return true;
}

// Remove THIS device's registration (other devices keep receiving).
async function disable() {
  const u = auth.currentUser;
  const token = localStorage.getItem(LS_KEY);
  try {
    if (token && u) await deleteDoc(doc(db, 'users', u.uid, 'devices', tokenId(token)));
    const m = await messagingMod();
    if (await m.isSupported()) await m.deleteToken(m.getMessaging(app)).catch(() => {});
  } finally {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
  }
  return true;
}

// Foreground messages don't hit the SW — surface them as an in-app toast.
let wired = false;
async function wireForeground() {
  if (wired) return;
  wired = true;
  try {
    const m = await messagingMod();
    if (!(await m.isSupported())) return;
    m.onMessage(m.getMessaging(app), (payload) => {
      const n = payload && payload.notification;
      if (n && window.FXToast) window.FXToast.show(`${n.title}${n.body ? ' — ' + n.body : ''}`, { duration: 4200 });
    });
  } catch (e) { /* foreground toasts are best-effort */ }
}

// Per-category mute prefs (absent = enabled). Server enforces; this is the UI.
async function getPrefs() {
  const u = auth.currentUser;
  if (!u) return {};
  try { const s = await getDoc(doc(db, 'users', u.uid)); return (s.exists() && s.data().notifyPrefs) || {}; }
  catch (e) { return {}; }
}
async function setPref(category, on) {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in first.');
  await setDoc(doc(db, 'users', u.uid), { notifyPrefs: { [category]: !!on } }, { merge: true });
  return !!on;
}

// If this device was previously enabled, re-wire foreground toasts on boot
// (no permission prompt — permission was already granted).
if (typeof window !== 'undefined' && localStorage.getItem(LS_KEY) && ('Notification' in window) && Notification.permission === 'granted') {
  wireForeground();
}
// Register the SW at boot (idempotent) so PWA caching works even before the
// user ever touches notifications.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

window.FXPush = { supported, status, enable, disable, getPrefs, setPref };
export {};
