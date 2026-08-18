/**
 * @file lib/api.ts
 * @description API utilities for correlation-ID and trace context propagation.
 */

import { withCorrelation } from "./correlation";

/**
 * Generates a standard W3C traceparent header.
 * Format: 00-traceid-parentid-traceflags
 */
export function generateTraceParent(): string {
  const version = "00";
  // Generate random 16 bytes (32 hex characters) trace ID
  const traceId = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
  // Generate random 8 bytes (16 hex characters) parent ID (span ID)
  const parentId = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
  const traceFlags = "01"; // Sampled
  return `${version}-${traceId}-${parentId}-${traceFlags}`;
}

/**
 * A wrapper around the native fetch API that automatically adds
 * traceparent headers for outgoing request tracing.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("traceparent")) {
    headers.set("traceparent", generateTraceParent());
  }
  return withCorrelation(fetch)(input, {
    ...init,
    headers,
  });
}

// Automatically patch global fetch for backend API calls made outside apiFetch.
// Uses a self-executing function to avoid top-level typeof checks that conflict
// with certain tsconfig lib configurations.
(function patchGlobalFetch() {
  const globalObj = (typeof window !== "undefined" ? window : globalThis) as typeof globalThis & {
    __correlationFetchPatched?: boolean;
  };

  if (globalObj && !globalObj.__correlationFetchPatched) {
    const originalFetch = globalObj.fetch?.bind(globalObj);
    if (originalFetch) {
      const correlatedFetch = withCorrelation(originalFetch);
      globalObj.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
        const urlStr =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;

        // Only inject traceparent headers for relative paths or API endpoints
        const isBackendApi = urlStr.includes("/api/") || !urlStr.startsWith("http");

        if (isBackendApi) {
          const headers = new Headers(init?.headers);
          if (!headers.has("traceparent")) {
            headers.set("traceparent", generateTraceParent());
          }
          return correlatedFetch(input, {
            ...init,
            headers,
          });
        }

        return originalFetch(input, init);
      };
      globalObj.__correlationFetchPatched = true;
    }
  }
})();
