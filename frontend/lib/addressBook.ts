import { isValidStellarAddress } from "@/lib/stellar";

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
const FEDERATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface FederationCacheEntry {
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

function makeContact(input: LegacyContact): AddressBookContact | null {
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const nicknameSource =
    typeof input.nickname === "string" ? input.nickname : typeof input.name === "string" ? input.name : "";
  const nickname = nicknameSource.trim();

  if (!address || !nickname || !isValidStellarAddress(address)) return null;

  return {
    id: input.id || `${address}:${input.createdAt || now()}`,
    nickname,
    address,
    federationAddress: input.federationAddress,
    federationResolved: input.federationResolved || false,
    federationCachedAt: input.federationCachedAt,
    createdAt: typeof input.createdAt === "number" ? input.createdAt : now(),
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : now(),
  };
}

function readContactsFromKey(key: string): AddressBookContact[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacyContact[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(makeContact).filter((contact): contact is AddressBookContact => Boolean(contact));
  } catch {
    return [];
  }
}

function dedupeContacts(contacts: AddressBookContact[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    if (seen.has(contact.address)) return false;
    seen.add(contact.address);
    return true;
  });
}

export function loadAddressBookContacts(): AddressBookContact[] {
  const primaryContacts = readContactsFromKey(ADDRESS_BOOK_STORAGE_KEY);
  const legacyContacts = readContactsFromKey(LEGACY_CONTACTS_STORAGE_KEY);
  const legacyFavourites = readContactsFromKey(LEGACY_FAVOURITES_STORAGE_KEY);
  return dedupeContacts([...primaryContacts, ...legacyContacts, ...legacyFavourites]);
}

export function saveAddressBookContacts(contacts: AddressBookContact[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ADDRESS_BOOK_STORAGE_KEY, JSON.stringify(contacts));
    window.dispatchEvent(new CustomEvent(CONTACTS_UPDATED_EVENT, { detail: contacts }));
  } catch {}
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
  if (typeof window === "undefined") return () => undefined;

  const onContactsUpdated = () => callback(loadAddressBookContacts());
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === ADDRESS_BOOK_STORAGE_KEY ||
      event.key === LEGACY_CONTACTS_STORAGE_KEY ||
      event.key === LEGACY_FAVOURITES_STORAGE_KEY
    ) {
      callback(loadAddressBookContacts());
    }
  };

  window.addEventListener(CONTACTS_UPDATED_EVENT, onContactsUpdated);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(CONTACTS_UPDATED_EVENT, onContactsUpdated);
    window.removeEventListener("storage", onStorage);
  };
}

export function getAddressBookStorageKey() {
  return ADDRESS_BOOK_STORAGE_KEY;
}

export function clearAddressBook() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(ADDRESS_BOOK_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_CONTACTS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_FAVOURITES_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(CONTACTS_UPDATED_EVENT, { detail: [] }));
  } catch {}
}

// ─── Federation resolution with caching ──────────────────────────────────

function getFederationCache(): Record<string, FederationCacheEntry> {
  try {
    const raw = window.localStorage.getItem(FEDERATION_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFederationCache(cache: Record<string, FederationCacheEntry>) {
  try {
    window.localStorage.setItem(FEDERATION_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function getCachedFederationAddress(federationAddress: string): string | null {
  const cache = getFederationCache();
  const entry = cache[federationAddress.trim().toLowerCase()];
  if (!entry) return null;
  if (now() - entry.resolvedAt > FEDERATION_CACHE_TTL_MS) return null;
  return entry.address;
}

export function setCachedFederationAddress(federationAddress: string, stellarAddress: string) {
  const cache = getFederationCache();
  cache[federationAddress.trim().toLowerCase()] = {
    address: stellarAddress,
    resolvedAt: now(),
  };
  saveFederationCache(cache);
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
  try {
    window.localStorage.removeItem(FEDERATION_CACHE_KEY);
  } catch {}
}
