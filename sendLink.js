import { sendSignInLinkToEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase.js";

/**
 * STEP 2 — Enable Email Link Sign-In
 * Developer Instructions:
 * 1. Go to the Firebase Console -> Authentication -> Sign-in method
 * 2. Enable Email/Password provider (required prerequisite)
 * 3. Enable Email link (passwordless sign-in)
 * 4. Click Save
 * 5. Add the app's domain to the Authorized Domains list under Authentication -> Settings
 */

/**
 * STEP 4 — Send the Sign-In Link
 * @param {string} email - The user's email address
 * @returns {Promise<object>}
 */
export async function sendSignInLink(email) {
  // STEP 3 — Build the ActionCodeSettings Object
  const actionCodeSettings = {
    url: window.location.origin + '/login.html',
    handleCodeInApp: true
  };

  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.sessionStorage.setItem('emailForSignIn', email);
    // Show success message (handled by UI)
    return { success: true, message: "A sign-in link has been sent to your email." };
  } catch (error) {
    // On error: log code and message
    console.error("Error sending sign-in link:", error.code, error.message);
    throw error;
  }
}
