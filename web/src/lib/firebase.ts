/**
 * Firebase client setup. Used for optional accounts only: science data never
 * goes through Firebase. Call getFirebase() from Client Components.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const useEmulators = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1";

/** False when the NEXT_PUBLIC_FIREBASE_* variables are not set. The site then runs guest-only. */
export const isFirebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let services: FirebaseServices | null = null;

/** The Firebase services, or null when Firebase is not configured or this runs during the build. */
export function getFirebase(): FirebaseServices | null {
  if (!isFirebaseConfigured || typeof window === "undefined") return null;
  if (services) return services;
  const firstInit = getApps().length === 0;
  const app = firstInit ? initializeApp(config) : getApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (useEmulators && firstInit) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
  }
  services = { app, auth, db };
  return services;
}
