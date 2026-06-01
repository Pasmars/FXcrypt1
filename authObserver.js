import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase.js";

// Fires on every auth state change — use for logout detection on protected pages.
export function setupAuthObserver(callback) {
  onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}

// Page guard for protected routes.
// Uses authStateReady() so Firebase finishes reading its persisted session
// before we decide whether to redirect — prevents the race condition where
// onAuthStateChanged fires null first and bounces a signed-in user to login.
export async function requireAuth(callback) {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  await callback(user);
  // Keep listening so a logout (this tab or another) redirects cleanly.
  onAuthStateChanged(auth, (u) => {
    if (!u) window.location.href = 'login.html';
  });
}
