// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";
import { getStorage } from "firebase/storage";

// Paste the exact config from Firebase Console → Project settings → Your apps → Web app
const firebaseConfig = {
  apiKey: "AIzaSyAuUjDPCCyU3m_5PNX45s2xE-6KSSNJBqM",
  authDomain: "ev-alert-web.firebaseapp.com",
  projectId: "ev-alert-web",
  storageBucket: "ev-alert-web.firebasestorage.app",
  messagingSenderId: "1046302695642",
  appId: "1:1046302695642:web:e9f9b75d7126a7e26d05e3"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Web push only (browser). Returns null on Android WebView, etc.
export async function getWebMessaging() {
  const supported = await isSupported();
  return supported ? getMessaging(app) : null;
}

export default app;