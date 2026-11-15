/**
 * The signed-in user's own documents in Firestore. User data only.
 *
 *   users/{uid}                               {displayName, email, createdAt, useCaseProfile?}
 *   users/{uid}/chats/{chatId}                {title, createdAt, updatedAt, useCase}   written by the API
 *   users/{uid}/chats/{chatId}/messages/{id}  {role, text, structured, createdAt}      written by the API
 *   users/{uid}/savedFilters/{id}             {name, manualFilters, customFilters, createdAt}
 */

import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { fromStored, type UiMessage } from "./chat";
import { normalizeCustomFilters, normalizeFilters, type CustomFilter, type Filters } from "./filters";

export const USE_CASE_MAX_LENGTH = 2000;
export const NAME_MAX_LENGTH = 120;
const BATCH_SIZE = 400;

export interface UserProfile {
  displayName: string;
  email: string;
  createdAt: Date | null;
  /** "Describe what you are designing." The assistant starts new chats from it. */
  useCaseDescription: string;
}

export interface SavedChat {
  id: string;
  title: string;
  updatedAt: Date | null;
}

export interface SavedFilter {
  id: string;
  name: string;
  manualFilters: Filters;
  /** Typed filter definitions. Derived values are not stored: they are read again when the filter is reapplied. */
  customFilters: CustomFilter[];
  createdAt: Date | null;
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

const userRef = (db: Firestore, uid: string) => doc(db, "users", uid);

/** Create users/{uid} on first sign-in. Leaves an existing profile alone. */
export async function ensureProfile(db: Firestore, user: User): Promise<void> {
  const snapshot = await getDoc(userRef(db, user.uid));
  if (snapshot.exists()) return;
  await setDoc(userRef(db, user.uid), {
    displayName: (user.displayName ?? "").slice(0, 200),
    email: user.email ?? "",
    createdAt: serverTimestamp(),
  });
}

export async function getProfile(db: Firestore, user: User): Promise<UserProfile> {
  const data = (await getDoc(userRef(db, user.uid))).data() ?? {};
  const useCase = data.useCaseProfile as { description?: unknown } | null | undefined;
  return {
    displayName: typeof data.displayName === "string" && data.displayName ? data.displayName : (user.displayName ?? ""),
    email: typeof data.email === "string" && data.email ? data.email : (user.email ?? ""),
    createdAt: toDate(data.createdAt),
    useCaseDescription: typeof useCase?.description === "string" ? useCase.description : "",
  };
}

/** Save the use case, or clear it with an empty description. */
export async function saveUseCase(db: Firestore, uid: string, description: string): Promise<void> {
  const text = description.trim().slice(0, USE_CASE_MAX_LENGTH);
  await updateDoc(userRef(db, uid), { useCaseProfile: text ? { description: text } : null });
}

export async function listChats(db: Firestore, uid: string): Promise<SavedChat[]> {
  const snapshot = await getDocs(query(collection(db, "users", uid, "chats"), orderBy("updatedAt", "desc")));
  return snapshot.docs.map((item) => ({
    id: item.id,
    title: typeof item.data().title === "string" ? item.data().title : "Untitled chat",
    updatedAt: toDate(item.data().updatedAt),
  }));
}

export async function renameChat(db: Firestore, uid: string, chatId: string, title: string): Promise<void> {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { title: title.trim().slice(0, NAME_MAX_LENGTH) });
}

/** Every message of a saved chat, oldest first. Throws if the chat does not exist. */
export async function listMessages(db: Firestore, uid: string, chatId: string): Promise<UiMessage[]> {
  const chat = await getDoc(doc(db, "users", uid, "chats", chatId));
  if (!chat.exists()) throw new Error("That chat no longer exists.");
  const snapshot = await getDocs(query(collection(db, "users", uid, "chats", chatId, "messages"), orderBy("seq", "asc")));
  return snapshot.docs.map((item) => fromStored(item.id, item.data()));
}

async function deleteAll(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let start = 0; start < refs.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    refs.slice(start, start + BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/** Delete a chat and every message in it. */
export async function deleteChat(db: Firestore, uid: string, chatId: string): Promise<void> {
  const messages = await getDocs(collection(db, "users", uid, "chats", chatId, "messages"));
  await deleteAll(db, messages.docs.map((item) => item.ref));
  await deleteDoc(doc(db, "users", uid, "chats", chatId));
}

export async function listSavedFilters(db: Firestore, uid: string): Promise<SavedFilter[]> {
  const snapshot = await getDocs(query(collection(db, "users", uid, "savedFilters"), orderBy("createdAt", "desc")));
  return snapshot.docs.map((item) => toSavedFilter(item.id, item.data()));
}

export async function getSavedFilter(db: Firestore, uid: string, id: string): Promise<SavedFilter | null> {
  const snapshot = await getDoc(doc(db, "users", uid, "savedFilters", id));
  return snapshot.exists() ? toSavedFilter(snapshot.id, snapshot.data()) : null;
}

function toSavedFilter(id: string, data: Record<string, unknown>): SavedFilter {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "Untitled filter",
    manualFilters: normalizeFilters(data.manualFilters),
    customFilters: normalizeCustomFilters(data.customFilters),
    createdAt: toDate(data.createdAt),
  };
}

export const CUSTOM_FILTERS_MAX = 20;

export async function saveFilter(
  db: Firestore,
  uid: string,
  name: string,
  manualFilters: Filters,
  customFilters: CustomFilter[] = [],
): Promise<string> {
  const created = await addDoc(collection(db, "users", uid, "savedFilters"), {
    name: name.trim().slice(0, NAME_MAX_LENGTH),
    manualFilters,
    customFilters: customFilters.slice(0, CUSTOM_FILTERS_MAX),
    createdAt: serverTimestamp(),
  });
  return created.id;
}

export async function deleteSavedFilter(db: Firestore, uid: string, id: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid, "savedFilters", id));
}

/** Delete every document the user owns: chats with their messages, saved filters, then the profile. */
export async function deleteAllUserData(db: Firestore, uid: string): Promise<void> {
  const chats = await getDocs(collection(db, "users", uid, "chats"));
  for (const chat of chats.docs) {
    await deleteChat(db, uid, chat.id);
  }
  const filters = await getDocs(collection(db, "users", uid, "savedFilters"));
  await deleteAll(db, filters.docs.map((item) => item.ref));
  await deleteDoc(userRef(db, uid));
}
