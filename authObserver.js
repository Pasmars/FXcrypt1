import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase.js";

/**
 * STEP 6 — Auth State Observer
 * @param {function} callback - Function called with user object or null
 */
export function setupAuthObserver(callback) {
  // Detect when a user is signed in
  onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}
