import { isValidStellarAddress } from "@/lib/stellar";
import { createEncryptedStore } from "@/lib/encryptedStorage";

export interface AddressBookContact {
  id: string;
  nickname: string;
  address: string;
  createdAt: number;
  updatedAt: number;
}

const ADDRESS_BOOK_STORAGE_KEY = "finchippay:contacts";
const LEGACY_CONTACTS_STORAGE_KEY = "finchippay-contacts";
const LEGACY_FAVOURITES_STORAGE_KEY = "finchippay:favourites";
const CONTACTS_UPDATED_EVENT = "finchippay:contacts-updated";

interface LegacyContact {
  id?: string;
  name?: string;
  nickname?: string;
  address?: string;
  createdAt?: number;
  updatedAt?: number;
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

export function upsertAddressBookContact(input: { nickname: string; address: string }) {
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
      updatedAt: timestamp,
    };
  } else {
    contacts.unshift({
      id: `${address}:${timestamp}`,
      nickname,
      address,
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
