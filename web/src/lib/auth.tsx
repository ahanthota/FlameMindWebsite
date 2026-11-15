"use client";

/**
 * Optional sign-in. Guests can use every page; an account only adds saving.
 * Wrap the app in <AuthProvider> and read it with useAuth().
 */

import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getFirebase, isFirebaseConfigured } from "./firebase";
import { deleteAllUserData, ensureProfile } from "./userdata";

export interface AuthContextValue {
  /** The signed-in user, or null for a guest. */
  user: User | null;
  /** True until Firebase reports the first auth state. */
  loading: boolean;
  /** False when this build has no Firebase config. Sign-in is then unavailable. */
  configured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** A fresh Firebase ID token for the API's Authorization header, or null for a guest. */
  getIdToken: () => Promise<string | null>;
  /** True when the account signs in with a password (so deleting it needs the password again). */
  usesPassword: boolean;
  /** Re-check the user's identity, then delete their Firestore data, then the auth user. */
  deleteAccount: (password?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function requireFirebase() {
  const firebase = getFirebase();
  if (!firebase) throw new Error("Sign-in is not set up for this build.");
  return firebase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  // Firebase changes the user object in place (for example when the name is set
  // after sign-up). Bumping this makes everything that reads the user render again.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const firebase = getFirebase();
    if (!firebase) return;
    return onAuthStateChanged(firebase.auth, (next) => {
      setUser(next);
      setLoading(false);
      if (next) {
        // The profile is a convenience. Failing to create it must not block sign-in.
        ensureProfile(firebase.db, next).catch((error) => console.error("Could not create the profile", error));
      }
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(requireFirebase().auth, new GoogleAuthProvider());
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(requireFirebase().auth, email.trim(), password);
  }, []);

  const createAccount = useCallback(async (email: string, password: string, displayName: string) => {
    const { auth, db } = requireFirebase();
    const created = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (displayName.trim()) {
      await updateProfile(created.user, { displayName: displayName.trim().slice(0, 200) });
      setRevision((value) => value + 1);
    }
    await ensureProfile(db, created.user);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(requireFirebase().auth);
  }, []);

  const getIdToken = useCallback(async () => (user ? user.getIdToken() : null), [user]);

  const usesPassword = Boolean(user?.providerData.some((provider) => provider.providerId === "password"));

  const deleteAccount = useCallback(
    async (password?: string) => {
      const { db } = requireFirebase();
      if (!user) throw new Error("You are not signed in.");
      // Firebase only deletes an account after a recent sign-in. Confirm identity
      // first, so the data is never deleted while the account itself survives.
      if (usesPassword) {
        if (!user.email || !password) throw new Error("Enter your password to confirm.");
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }
      await deleteAllUserData(db, user.uid);
      await deleteUser(user);
    },
    [user, usesPassword],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured: isFirebaseConfigured,
      signInWithGoogle,
      signInWithEmail,
      createAccount,
      signOut,
      getIdToken,
      usesPassword,
      deleteAccount,
    }),
    // `revision` is listed so consumers re-render when the user object changes in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, revision, loading, signInWithGoogle, signInWithEmail, createAccount, signOut, getIdToken, usesPassword, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}

const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password do not match an account.",
  "auth/wrong-password": "That password is not correct.",
  "auth/user-not-found": "There is no account with that email.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/email-already-in-use": "An account with that email already exists. Sign in instead.",
  "auth/weak-password": "Use a password of at least 6 characters.",
  "auth/missing-password": "Enter a password.",
  "auth/popup-closed-by-user": "The sign-in window was closed before finishing.",
  "auth/cancelled-popup-request": "The sign-in window was closed before finishing.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/network-request-failed": "Could not reach the sign-in service. Check your connection.",
  "auth/operation-not-allowed":
    "Email and password sign-in is not turned on for this project yet. Use Google, or enable Email/Password in the Firebase console.",
  "auth/unauthorized-domain": "This site address is not allowed to sign in. Add it under Authorized domains in the Firebase console.",
  "auth/requires-recent-login": "Sign out, sign in again, and then retry.",
  "permission-denied": "You do not have permission to do that.",
  unavailable: "Could not reach the database. Check your connection.",
};

/** A plain sentence for a Firebase error. */
export function errorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  return error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";
}
