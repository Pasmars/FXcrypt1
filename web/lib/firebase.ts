// Firebase client SDK — initialized once, browser-side.
// Same project/config as the legacy app, so all existing Cloud Functions,
// Auth users and Firestore data work unchanged.
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyCpdVnFtB1dnlZmvfJ9srIBvgFl1ZqNLmQ',
  authDomain: 'pnl-calculator.firebaseapp.com',
  projectId: 'pnl-calculator',
  storageBucket: 'pnl-calculator.firebasestorage.app',
  messagingSenderId: '935070103115',
  appId: '1:935070103115:web:963a10b745483e2255bfce'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
// Callable Cloud Functions live in europe-west1 (matches the legacy backend).
export const fns = getFunctions(app, 'europe-west1');
export default app;
