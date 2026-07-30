import { isValidStellarAddress } from "@/lib/stellar";

const FEDERATION_CACHE_KEY = "finchippay:federation-cache";
const FEDERATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface FederationCacheEntry {
  address: string;
  resolvedAt: number;
}

function now() {
  return Date.now();
}

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
