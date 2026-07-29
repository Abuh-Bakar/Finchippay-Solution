import { isValidStellarAddress } from "@/lib/stellar";
import { createEncryptedStore } from "@/lib/encryptedStorage";

export interface AddressBookContact {
  id: string;
  nickname: string;
  address: string;
  federationAddress?: string;
  federationResolved?: boolean;
  federationCachedAt?: number;
  groupIds?: number[];
  createdAt: number;
  updatedAt: number;
}

const ADDRESS_BOOK_STORAGE_KEY = "finchippay:contacts";
const LEGACY_CONTACTS_STORAGE_KEY = "finchippay-contacts";
const LEGACY_FAVOURITES_STORAGE_KEY = "finchippay:favourites";
const CONTACTS_UPDATED_EVENT = "finchippay:contacts-updated";
const FEDERATION_CACHE_KEY = "finchippay:federation-cache";
const FEDERATION_CACHE_UPDATED_EVENT = "finchippay:federation-cache-updated";
const FEDERATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface FederationCacheEntry {
  /** Normalised (trimmed, lowercased) federation address, e.g. `bob*stellar.org`. */
  federationAddress: string;
  address: string;
  resolvedAt: number;
}

interface LegacyContact {
  id?: string;
  name?: string;
  nickname?: string;
  address?: string;
  createdAt?: number;
  updatedAt?: number;
  federationAddress?: string;
  federationResolved?: boolean;
  federationCachedAt?: number;
}

function now() {
  return Date.now();
}

function makeContact(input: unknown): AddressBookContact | null {
  const contact = (input ?? {}) as LegacyContact;
  const address = typeof contact.address === "string" ? contact.address.trim() : "";
  const nicknameSource =
    typeof contact.nickname === "string"
      ? contact.nickname
      : typeof contact.name === "string"
      ? contact.name
      : "";
  const nickname = nicknameSource.trim();

  if (!address || !nickname || !isValidStellarAddress(address)) return null;

  return {
    id: contact.id || `${address}:${contact.createdAt || now()}`,
    nickname,
    address,
    federationAddress: contact.federationAddress,
    federationResolved: contact.federationResolved || false,
    federationCachedAt: contact.federationCachedAt,
    createdAt: typeof contact.createdAt === "number" ? contact.createdAt : now(),
    updatedAt: typeof contact.updatedAt === "number" ? contact.updatedAt : now(),
  };
}

function dedupeContacts(contacts: AddressBookContact[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    if (seen.has(contact.address)) return false;
    seen.add(contact.address);
    return true;
  });
}

// Encrypted-at-rest store backing the address book. Contacts are only readable
// once a wallet session key has unlocked the store (see wallet.ts).
const store = createEncryptedStore<AddressBookContact>({
  storageKey: ADDRESS_BOOK_STORAGE_KEY,
  eventName: CONTACTS_UPDATED_EVENT,
  legacyKeys: [LEGACY_CONTACTS_STORAGE_KEY, LEGACY_FAVOURITES_STORAGE_KEY],
  revive: makeContact,
  dedupe: dedupeContacts,
});

export function loadAddressBookContacts(): AddressBookContact[] {
  return store.load();
}

export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  store.save(contacts);
}

export function upsertAddressBookContact(input: { nickname: string; address: string; federationAddress?: string }) {
  const nickname = input.nickname.trim();
  const address = input.address.trim();

  if (!nickname) throw new Error("Enter a nickname for this contact.");
  if (!isValidStellarAddress(address)) throw new Error("Enter a valid Stellar public key.");

  const contacts = loadAddressBookContacts();
  const existingIndex = contacts.findIndex((contact) => contact.address === address);
  const timestamp = now();

  if (existingIndex >= 0) {
    contacts[existingIndex] = {
      ...contacts[existingIndex],
      nickname,
      federationAddress: input.federationAddress || contacts[existingIndex].federationAddress,
      updatedAt: timestamp,
    };
  } else {
    contacts.unshift({
      id: `${address}:${timestamp}`,
      nickname,
      address,
      federationAddress: input.federationAddress,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  saveAddressBookContacts(contacts);
  return contacts;
}

export function deleteAddressBookContact(id: string) {
  const contacts = loadAddressBookContacts().filter((contact) => contact.id !== id);
  saveAddressBookContacts(contacts);
  return contacts;
}

export function subscribeToAddressBookContacts(callback: (contacts: AddressBookContact[]) => void) {
  return store.subscribe(callback);
}

export function getAddressBookStorageKey() {
  return ADDRESS_BOOK_STORAGE_KEY;
}

export function clearAddressBook() {
  store.clear();
}

// ─── Federation resolution with caching ──────────────────────────────────
//
// The cache links a federation address to the Stellar account it resolves to,
// which is contact data by another name — so it is encrypted at rest under the
// same wallet session key as the address book itself.

function normaliseFederationAddress(federationAddress: string) {
  return federationAddress.trim().toLowerCase();
}

function makeFederationEntry(input: unknown): FederationCacheEntry | null {
  const entry = (input ?? {}) as Partial<FederationCacheEntry>;
  const federationAddress =
    typeof entry.federationAddress === "string" ? normaliseFederationAddress(entry.federationAddress) : "";
  const address = typeof entry.address === "string" ? entry.address.trim() : "";

  if (!federationAddress || !isValidStellarAddress(address)) return null;

  return {
    federationAddress,
    address,
    resolvedAt: typeof entry.resolvedAt === "number" ? entry.resolvedAt : now(),
  };
}

/** Keep the first (most recently written) entry per federation address. */
function dedupeFederationEntries(entries: FederationCacheEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.federationAddress)) return false;
    seen.add(entry.federationAddress);
    return true;
  });
}

const federationStore = createEncryptedStore<FederationCacheEntry>({
  storageKey: FEDERATION_CACHE_KEY,
  eventName: FEDERATION_CACHE_UPDATED_EVENT,
  revive: makeFederationEntry,
  dedupe: dedupeFederationEntries,
});

export function getCachedFederationAddress(federationAddress: string): string | null {
  const key = normaliseFederationAddress(federationAddress);
  const entry = federationStore.load().find((item) => item.federationAddress === key);
  if (!entry) return null;
  if (now() - entry.resolvedAt > FEDERATION_CACHE_TTL_MS) return null;
  return entry.address;
}

export function setCachedFederationAddress(federationAddress: string, stellarAddress: string) {
  const key = normaliseFederationAddress(federationAddress);
  const entry = makeFederationEntry({
    federationAddress: key,
    address: stellarAddress,
    resolvedAt: now(),
  });
  if (!entry) return;

  const existing = federationStore.load().filter((item) => item.federationAddress !== key);
  federationStore.save([entry, ...existing]);
}

export async function resolveFederationWithCache(
  federationAddress: string
): Promise<string | null> {
  const cached = getCachedFederationAddress(federationAddress);
  if (cached) return cached;

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
  const url = `${apiBase}/federation?q=${encodeURIComponent(federationAddress)}&type=name`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data?.account_id && isValidStellarAddress(data.account_id)) {
      setCachedFederationAddress(federationAddress, data.account_id);
      return data.account_id;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearFederationCache() {
  federationStore.clear();
}

// ─── Session lifecycle (called from the wallet layer) ───────────────────────

/** Decrypt the address book into memory for the given wallet session. */
export function unlockAddressBook(key: CryptoKey, owner: string) {
  return store.unlock(key, owner);
}

/** Re-encrypt the in-memory contacts under a new wallet key (rotation). */
export function reEncryptAddressBook(key: CryptoKey, owner: string) {
  return store.reEncrypt(key, owner);
}

/** Drop the decrypted contacts from memory (on disconnect). */
export function lockAddressBook() {
  store.lock();
}

/** True when the stored contacts were encrypted for a different wallet. */
export function addressBookNeedsReEncryption(owner: string) {
  return store.needsReEncryption(owner);
}

/** Decrypt the federation cache into memory for the given wallet session. */
export function unlockFederationCache(key: CryptoKey, owner: string) {
  return federationStore.unlock(key, owner);
}

/** Re-encrypt the cached federation resolutions under a new wallet key. */
export function reEncryptFederationCache(key: CryptoKey, owner: string) {
  return federationStore.reEncrypt(key, owner);
}

/** Drop the decrypted federation cache from memory (on disconnect). */
export function lockFederationCache() {
  federationStore.lock();
}
