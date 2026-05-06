import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// TODO: Replace this with your actual Firebase project configuration
// Once you create the project, paste the keys here!
const firebaseConfig = {
  apiKey: "AIzaSyCpdVnFtB1dnlZmvfJ9srIBvgFl1ZqNLmQ",

  authDomain: "pnl-calculator.firebaseapp.com",
  projectId: "pnl-calculator",
  storageBucket: "pnl-calculator.firebasestorage.app",
  messagingSenderId: "935070103115",
  appId: "1:935070103115:web:963a10b745483e2255bfce"

};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
