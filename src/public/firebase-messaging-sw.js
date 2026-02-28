importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

firebase.initializeApp({
   apiKey: "AIzaSyAuUjDPCCyU3m_5PNX45s2xE-6KSSNJBqM",
  authDomain: "ev-alert-web.firebaseapp.com",
  projectId: "ev-alert-web",
  storageBucket: "ev-alert-web.firebasestorage.app",
  messagingSenderId: "1046302695642",
  appId: "1:1046302695642:web:e9f9b75d7126a7e26d05e3"
});

const messaging = firebase.messaging();
