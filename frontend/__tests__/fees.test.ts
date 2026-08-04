import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFeeStats, estimateTransactionFee, getFeeForTier, formatFeeStroopsToXlm } from "../lib/fees";

const mockFeeStats = {
  min_accepted_fee: 100,
  fee_charged: {
    mode: 100,
    p50: 100,
    p95: 200,
    p99: 500,
  },
  last_ledger: 12345,
  max_fee: { max: 1000 },
};

describe("fees", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getFeeStats", () => {
    it("fetches and returns fee stats from Horizon", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockFeeStats),
      } as Response);

      const stats = await getFeeStats();

      expect(stats.min).toBe(100);
      expect(stats.p50).toBe(100);
      expect(stats.p95).toBe(200);
      expect(stats.p99).toBe(500);
      expect(stats.max).toBe(1000);
    });

    it("caches fee stats for 60 seconds", async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockFeeStats),
      } as Response);

      await getFeeStats();
      await getFeeStats();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws on failed fetch", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        statusText: "Not Found",
      } as Response);

      await expect(getFeeStats()).rejects.toThrow("Failed to fetch fee stats");
    });
  });

  describe("estimateTransactionFee", () => {
    it("calculates fee for single operation", () => {
      const fee = estimateTransactionFee(1, 100);
      expect(parseFloat(fee)).toBe(0.00001);
    });

    it("calculates fee for multiple operations", () => {
      const fee = estimateTransactionFee(5, 200);
      expect(parseFloat(fee)).toBe(0.0001);
    });
  });

  describe("getFeeForTier", () => {
    it("returns p50 for economy tier", () => {
      const stats = { min: 100, mode: 100, p50: 100, p95: 200, p99: 500, lastLedger: 1, max: 1000 };
      expect(getFeeForTier(stats, "economy")).toBe(100);
    });

    it("returns p95 for standard tier", () => {
      const stats = { min: 100, mode: 100, p50: 100, p95: 200, p99: 500, lastLedger: 1, max: 1000 };
      expect(getFeeForTier(stats, "standard")).toBe(200);
    });

    it("returns p99 for priority tier", () => {
      const stats = { min: 100, mode: 100, p50: 100, p95: 200, p99: 500, lastLedger: 1, max: 1000 };
      expect(getFeeForTier(stats, "priority")).toBe(500);
    });
  });

  describe("formatFeeStroopsToXlm", () => {
    it("formats stroops to XLM with 7 decimal places", () => {
      expect(formatFeeStroopsToXlm(100)).toBe("0.0000100");
      expect(formatFeeStroopsToXlm(10000000)).toBe("1.0000000");
    });
  });
});