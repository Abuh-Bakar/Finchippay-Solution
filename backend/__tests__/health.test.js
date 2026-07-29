/**
 * __tests__/health.test.js
 * Unit tests for liveness, readiness, startup, and dependency probes.
 */

"use strict";

const request = require("supertest");

jest.mock("../src/services/healthService", () => ({
  checkDependencies: jest.fn(),
  getLivenessState: jest.fn(),
  getStartupState: jest.fn(),
  markStartupComplete: jest.fn(),
  markShuttingDown: jest.fn(),
}));

jest.mock("../src/middleware/auth", () => ({
  verifyJWT: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
}));

const {
  checkDependencies,
  getLivenessState,
  getStartupState,
} = require("../src/services/healthService");
const app = require("../src/server");

describe("health probes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getLivenessState.mockReturnValue({
      status: "alive",
      uptime: 12,
      timestamp: "2026-07-29T00:00:00.000Z",
    });
    getStartupState.mockReturnValue({
      status: "started",
      initialized: true,
      initDuration: 42,
    });
  });

  describe("GET /health/live", () => {
    it("returns liveness without dependency I/O", async () => {
      const res = await request(app).get("/health/live");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("alive");
      expect(checkDependencies).not.toHaveBeenCalled();
    });

    it("keeps /health as a liveness alias", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("alive");
    });
  });

  describe("GET /health/ready", () => {
    it("returns ready with dependency checks and all_healthy summary", async () => {
      checkDependencies.mockResolvedValue({
        healthy: true,
        summary: "all_healthy",
        dependencies: {
          postgres: { status: "healthy", latency: 4, message: "ok" },
          redis: { status: "healthy", latency: 1, message: "ok" },
          horizon: { status: "healthy", latency: 45, message: "ok" },
        },
      });

      const res = await request(app).get("/api/health/ready");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.summary).toBe("all_healthy");
      expect(res.body.checks.postgres.status).toBe("healthy");
    });

    it("returns not_ready when a critical dependency fails", async () => {
      checkDependencies.mockResolvedValue({
        healthy: false,
        summary: "critical_failure",
        dependencies: {
          postgres: { status: "unhealthy", latency: 10, message: "down" },
          redis: { status: "healthy", latency: 1, message: "ok" },
          horizon: { status: "healthy", latency: 45, message: "ok" },
        },
      });

      const res = await request(app).get("/api/health/ready");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("not_ready");
      expect(res.body.summary).toBe("critical_failure");
      expect(res.body.checks.postgres.message).toBe("down");
    });
  });

  describe("GET /health/started", () => {
    it("returns startup state after initialization", async () => {
      const res = await request(app).get("/api/health/started");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("started");
      expect(res.body.initDuration).toBe(42);
    });

    it("returns 503 while initialization is incomplete", async () => {
      getStartupState.mockReturnValue({
        status: "starting",
        initialized: false,
        initDuration: 5,
      });

      const res = await request(app).get("/api/health/started");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("starting");
    });
  });

  describe("GET /health/dependencies", () => {
    it("returns detailed dependency status for admins", async () => {
      checkDependencies.mockResolvedValue({
        healthy: true,
        summary: "degraded",
        dependencies: {
          postgres: { status: "healthy", latency: 4, message: "ok" },
          soroban_rpc: {
            status: "degraded",
            latency: 0,
            message: "not configured",
          },
        },
      });

      const res = await request(app).get("/api/health/dependencies");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("degraded");
      expect(res.body.checks.soroban_rpc.status).toBe("degraded");
      expect(res.body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});