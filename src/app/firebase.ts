// Firebase Realtime Database configuration. The web-config is *not*
// secret — Firebase web apps are designed to ship these values in the
// client. Authorisation is enforced server-side via Database Rules; see
// the project README for the recommended rules block.
//
// Why Realtime Database and not Firestore? Realtime DB has simpler reads
// and writes for "append-only" data like leaderboards, and the free tier
// is more than enough for a small indie game's highscore traffic.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBX5iAcevdch3RqjFpgmpaUUzeiCKkSzbk",
  authDomain: "turbo-raketti.firebaseapp.com",
  databaseURL: "https://turbo-raketti-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "turbo-raketti",
  storageBucket: "turbo-raketti.firebasestorage.app",
  messagingSenderId: "334981297776",
  appId: "1:334981297776:web:da7a63fc3bb16e369066b5",
  measurementId: "G-WEKNGLWW4P",
};

let app: FirebaseApp | null = null;
let db: Database | null = null;

/** Lazily initialise the Firebase app + database. Safe to call repeatedly;
 *  returns the same instance every time. Wrapped in try/catch so a
 *  broken config doesn't prevent the rest of the menu from loading. */
export function getDb(): Database | null {
  if (db) return db;
  try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    return db;
  } catch (err) {
    console.warn("Firebase init failed — falling back to localStorage only:", err);
    return null;
  }
}
