import { isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase.js";

/**
 * STEP 5 — Build the Sign-In Completion Handler
 * @returns {Promise<object>}
 */
export async function completeSignIn() {
  // Check if the link is a sign-in with email link (Step 5 & Step 8)
  if (isSignInWithEmailLink(auth, window.location.href)) {
    // Retrieve email from localStorage
    let email = window.localStorage.getItem('emailForSignIn');
    
    // If no email is found in storage (user opened link on a different device), prompt the user
    if (!email) {
      email = window.prompt('Please provide your email for confirmation');
    }

    try {
      // Calls signInWithEmailLink
      const result = await signInWithEmailLink(auth, email, window.location.href);
      
      // Clear email from localStorage immediately (Security Best Practice - Step 8)
      window.localStorage.removeItem('emailForSignIn');
      
      // Log signed-in user
      console.log("Successfully signed in user:", result.user);
      
      return { success: true, user: result.user };
    } catch (error) {
      console.error("Error completing sign in:", error.code, error.message);
      throw error;
    }
  }
  return { success: false, message: "Not a valid sign-in link." };
}
