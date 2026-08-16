/**
 * @file lib/api.ts
 * @description API utilities and traceparent context propagation for frontend HTTP requests.
 */

/**
 * Generates a standard W3C traceparent header.
 * Format: 00-traceid-parentid-traceflags
 */
export function generateTraceParent(): string {
  const version = "00";
  // Generate random 16 bytes (32 hex characters) trace ID
  const traceId = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
  // Generate random 8 bytes (16 hex characters) parent ID (span ID)
  const parentId = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
  const traceFlags = "01"; // Sampled
  return `${version}-${traceId}-${parentId}-${traceFlags}`;
}

/**
 * A wrapper around the native fetch API that automatically adds
 * traceparent headers for outgoing request tracing.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("traceparent")) {
    headers.set("traceparent", generateTraceParent());
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

import { FinchippayClient, ApiHttpError, type FinchippayClientOptions } from "@finchippay/sdk";
import { ensureAccessToken } from "./auth";

export * from "@finchippay/sdk";
export { FinchippayClient, ApiHttpError };

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Shared, authenticated FinchippayClient instance dogfooded by all frontend modules.
 * Automatically injects W3C traceparent headers and handles token management.
 */
export const apiClient = new FinchippayClient({
  baseUrl: API_BASE_URL,
  fetch: apiFetch,
  getAuthToken: () => ensureAccessToken(),
});
