/**
 * Firestore security rules, run against the emulator:
 *
 *   npm run test:rules
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "firestore.rules");

let env: RulesTestEnvironment;

const alice = () => env.authenticatedContext("alice").firestore();
const bob = () => env.authenticatedContext("bob").firestore();
const guest = () => env.unauthenticatedContext().firestore();

const CHAT = "users/alice/chats/c1";
const MESSAGE = "users/alice/chats/c1/messages/m1";
const FILTER = "users/alice/savedFilters/f1";
const savedFilter = { name: "High oxygen", manualFilters: { o2: { min: 30, max: null } }, customFilters: [] };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-flamemind",
    firestore: { rules: readFileSync(RULES, "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // What the API (service account) writes. Rules are bypassed here, as they are for the API.
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users/alice"), { displayName: "Alice", email: "alice@example.com", createdAt: 1 });
    await setDoc(doc(db, CHAT), { title: "Fabric flames", createdAt: 1, updatedAt: 1, useCase: null });
    await setDoc(doc(db, MESSAGE), { role: "user", text: "hi", structured: null, createdAt: 1 });
    await setDoc(doc(db, FILTER), { ...savedFilter, createdAt: 1 });
  });
});

describe("reading", () => {
  it("lets a user read their own profile, chats, messages, and saved filters", async () => {
    await assertSucceeds(getDoc(doc(alice(), "users/alice")));
    await assertSucceeds(getDocs(collection(alice(), "users/alice/chats")));
    await assertSucceeds(getDoc(doc(alice(), MESSAGE)));
    await assertSucceeds(getDocs(collection(alice(), "users/alice/savedFilters")));
  });

  it("blocks other users and guests from all of it", async () => {
    for (const db of [bob(), guest()]) {
      await assertFails(getDoc(doc(db, "users/alice")));
      await assertFails(getDoc(doc(db, CHAT)));
      await assertFails(getDocs(collection(db, "users/alice/chats")));
      await assertFails(getDoc(doc(db, MESSAGE)));
      await assertFails(getDoc(doc(db, FILTER)));
    }
  });

  it("allows nothing outside users/", async () => {
    await assertFails(getDoc(doc(alice(), "investigations/PSI-26")));
    await assertFails(setDoc(doc(alice(), "investigations/PSI-26"), { name: "x" }));
  });
});

describe("profile", () => {
  it("lets the owner create and update their profile, including the saved use case", async () => {
    await assertSucceeds(
      setDoc(doc(bob(), "users/bob"), { displayName: "Bob", email: "bob@example.com", createdAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(doc(alice(), "users/alice"), { useCaseProfile: { description: "A Moon base galley" } }));
    await assertSucceeds(updateDoc(doc(alice(), "users/alice"), { useCaseProfile: null }));
    await assertSucceeds(deleteDoc(doc(alice(), "users/alice")));
  });

  it("rejects unknown fields, oversized text, and a changed createdAt", async () => {
    await assertFails(updateDoc(doc(alice(), "users/alice"), { admin: true }));
    await assertFails(updateDoc(doc(alice(), "users/alice"), { useCaseProfile: { description: "x".repeat(2001) } }));
    await assertFails(updateDoc(doc(alice(), "users/alice"), { useCaseProfile: { role: "admin" } }));
    await assertFails(updateDoc(doc(alice(), "users/alice"), { createdAt: 2 }));
  });

  it("blocks writing someone else's profile", async () => {
    await assertFails(setDoc(doc(bob(), "users/alice"), { displayName: "Mallory" }));
    await assertFails(deleteDoc(doc(bob(), "users/alice")));
    await assertFails(setDoc(doc(guest(), "users/alice"), { displayName: "Mallory" }));
  });
});

describe("chats and messages", () => {
  it("does not let the owner create chats or messages: only the API writes them", async () => {
    await assertFails(setDoc(doc(alice(), "users/alice/chats/c2"), { title: "New", createdAt: 1, updatedAt: 1, useCase: null }));
    await assertFails(addDoc(collection(alice(), "users/alice/chats/c1/messages"), { role: "user", text: "x" }));
    await assertFails(updateDoc(doc(alice(), MESSAGE), { text: "edited" }));
  });

  it("lets the owner rename a chat, and nothing else", async () => {
    await assertSucceeds(updateDoc(doc(alice(), CHAT), { title: "Renamed" }));
    await assertFails(updateDoc(doc(alice(), CHAT), { title: "" }));
    await assertFails(updateDoc(doc(alice(), CHAT), { title: "x".repeat(121) }));
    await assertFails(updateDoc(doc(alice(), CHAT), { useCase: { description: "changed" } }));
    await assertFails(updateDoc(doc(alice(), CHAT), { title: "Renamed", updatedAt: 99 }));
  });

  it("lets the owner delete a chat and its messages", async () => {
    await assertSucceeds(deleteDoc(doc(alice(), MESSAGE)));
    await assertSucceeds(deleteDoc(doc(alice(), CHAT)));
  });

  it("blocks other users and guests from renaming or deleting", async () => {
    for (const db of [bob(), guest()]) {
      await assertFails(updateDoc(doc(db, CHAT), { title: "Hacked" }));
      await assertFails(deleteDoc(doc(db, CHAT)));
      await assertFails(deleteDoc(doc(db, MESSAGE)));
    }
  });
});

describe("saved filters", () => {
  it("lets the owner create, update, and delete", async () => {
    const created = await assertSucceeds(
      addDoc(collection(alice(), "users/alice/savedFilters"), { ...savedFilter, createdAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(doc(alice(), created.path), { name: "Renamed" }));
    await assertSucceeds(deleteDoc(doc(alice(), FILTER)));
  });

  it("rejects malformed filters", async () => {
    const filters = collection(alice(), "users/alice/savedFilters");
    await assertFails(addDoc(filters, { ...savedFilter, name: "" }));
    await assertFails(addDoc(filters, { ...savedFilter, manualFilters: "all" }));
    await assertFails(addDoc(filters, { name: "No filters" }));
    await assertFails(addDoc(filters, { ...savedFilter, extra: 1 }));
  });

  it("keeps a saved chat and filter private, then removes them when the account is deleted", async () => {
    const created = await assertSucceeds(
      addDoc(collection(alice(), "users/alice/savedFilters"), { ...savedFilter, createdAt: serverTimestamp() }),
    );
    await assertFails(getDoc(doc(bob(), CHAT)));
    await assertFails(getDoc(doc(bob(), MESSAGE)));
    await assertFails(getDoc(doc(bob(), created.path)));

    await assertSucceeds(deleteDoc(doc(alice(), MESSAGE)));
    await assertSucceeds(deleteDoc(doc(alice(), CHAT)));
    await assertSucceeds(deleteDoc(doc(alice(), created.path)));
    await assertSucceeds(deleteDoc(doc(alice(), FILTER)));
    await assertSucceeds(deleteDoc(doc(alice(), "users/alice")));

    expect((await getDoc(doc(alice(), CHAT))).exists()).toBe(false);
    expect((await getDoc(doc(alice(), MESSAGE))).exists()).toBe(false);
    expect((await getDoc(doc(alice(), created.path))).exists()).toBe(false);
    expect((await getDoc(doc(alice(), FILTER))).exists()).toBe(false);
    expect((await getDoc(doc(alice(), "users/alice"))).exists()).toBe(false);
    await assertFails(getDoc(doc(bob(), CHAT)));
  });

  it("blocks other users and guests", async () => {
    await assertFails(addDoc(collection(bob(), "users/alice/savedFilters"), savedFilter));
    await assertFails(deleteDoc(doc(bob(), FILTER)));
    await assertFails(addDoc(collection(guest(), "users/alice/savedFilters"), savedFilter));
  });
});
