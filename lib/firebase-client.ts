import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase 웹 설정은 브라우저에 공개되는 식별값입니다. 장부 데이터 권한은 서버가
// Firebase ID 토큰과 가정 장부 구성원을 별도로 확인합니다.
const firebaseConfig = {
  apiKey: "AIzaSyBPDGOPfalwLkfpkdJUgGU53K2MZFYrzMY",
  authDomain: "uri-jangbu.firebaseapp.com",
  projectId: "uri-jangbu",
  storageBucket: "uri-jangbu.firebasestorage.app",
  messagingSenderId: "657741814578",
  appId: "1:657741814578:web:15f6e0e9bb5ecd6476552b",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);
export const firebaseGoogleProvider = new GoogleAuthProvider();
firebaseGoogleProvider.setCustomParameters({ prompt: "select_account" });
