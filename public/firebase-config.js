
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import { getMessaging, isSupported } from
  "https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyAGWCW9p4H8u0OfLvIMbUKqGk1hKb6nGRk",
  authDomain: "hatchai-8d34c.firebaseapp.com",
  projectId: "hatchai-8d34c",
  storageBucket: "hatchai-8d34c.firebasestorage.app",
  messagingSenderId: "935024796827",
  appId: "1:935024796827:web:93aad7f809d19eabe2523e"
};

export const app = initializeApp(firebaseConfig);

export async function getHatchaiMessaging() {
  if (!(await isSupported())) {
    throw new Error("Firebase Messaging is not supported in this browser.");
  }
  return getMessaging(app);
}
