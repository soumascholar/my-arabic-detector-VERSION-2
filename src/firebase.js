// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCeafx8n1lOqyPINvQH5vDt1vD9Oh7diOU",
  authDomain: "souma-s.firebaseapp.com",
  projectId: "souma-s",
  storageBucket: "souma-s.firebasestorage.app",
  messagingSenderId: "1070150131413",
  appId: "1:1070150131413:web:181a6e440c6e0280988c5c"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
