// Firebase 웹 설정값. 이 값들은 공개되어도 되는 값이며, 실제 접근 제어는 firestore.rules가 맡는다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDpVS1JMtuqz1F5Fawbd7JRgaKAn0syyG4",
  authDomain: "makingthinking-b6873.firebaseapp.com",
  projectId: "makingthinking-b6873",
  storageBucket: "makingthinking-b6873.firebasestorage.app",
  messagingSenderId: "307319058300",
  appId: "1:307319058300:web:9090c51822f3055e8bbef9",
};

export const app = initializeApp(firebaseConfig);
