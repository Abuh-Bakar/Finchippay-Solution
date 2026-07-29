/**
 * src/services/healthService.js
 * Health, readiness, startup, and dependency probes for operational endpoints.
 */

"use strict";

const fs = require("fs");
const https = require("https");
const http = require("http");
const logger = require("../utils/logger");

const HEALTH_TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT_MS, 10) || 5_000;
const HEALTH_EVENT_LOOP_LAG_MS =
  parseInt(process.env.HEALTH_EVENT_LOOP_LAG_MS, 10) || 100;
const HEALTH_MEMORY_RSS_BYTES =
  parseInt(process.env.HEALTH_MEMORY_RSS_BYTES, 10) || 500 * 1024 * 1024;
const HEALTH_DISK_USED_RATIO =
  Number.parseFloat(process.env.HEALTH_DISK_USED_RATIO || "0.9") || 0.9;

let startupComplete = false;
let startupCompletedAt = null;
let startupStartedAt = Date.now();
let shuttingDown = false;

function normalizeStatus(ok, degraded = false) {
  if (ok) return "healthy";
  return degraded ? "degraded" : "unhealthy";
}

function markStartupComplete() {
  startupComplete = true;
  startupCompletedAt = Date.now();
}

function markShuttingDown() {
  shuttingDown = true;
}

function getStartupState() {
  return {
    status: startupComplete ? "started" : "starting",
    initialized: startupComplete,
    initDuration: startupComplete
      ? startupCompletedAt - startupStartedAt
      : Date.now() - startupStartedAt,
  };
}

function getLivenessState() {
  return {
    status: "alive",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Issue a plain HTTP(S) GET to `url` and resolve with { latencyMs, ok }.
 * Does not throw; failures are returned as { ok: false, error }.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string }>}
 */
function probeGet(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const mod = url.startsWith("https") ? https : http;

    const req = mod.get(url, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
      res.resume();
      res.on("end", () => {
        resolve({ ok: res.statusCode < 500, latencyMs: Date.now() - start });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: `timed out after ${HEALTH_TIMEOUT_MS} ms`,
      });
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message,
      });
    });
  });
}

/**
 * Issue a minimal JSON-RPC POST to the Soroban RPC URL to call getHealth.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string }>}
 */
function probeSorobanRpc(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getHealth",
      params: {},
    });
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname || "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: HEALTH_TIMEOUT_MS,
    };

    const req = mod.request(options, (res) => {
      res.resume();
      res.on("end", () => {
        resolve({ ok: res.statusCode < 500, latencyMs: Date.now() - start });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: `timed out after ${HEALTH_TIMEOUT_MS} ms`,
      });
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        latencyMs: Date.now() - start,
        error: err.message,
      });
    });

    req.write(body);
    req.end();
  });
}

async function checkPostgres() {
  const start = Date.now();
  try {
    const db = require("../db");
    await db.raw("select 1");
    return {
      status: "healthy",
      latency: Date.now() - start,
      message: "PostgreSQL query succeeded",
    };
  } catch (err) {
    return {
      status: "unhealthy",
      latency: Date.now() - start,
      message: err.message,
    };
  }
}

async function checkRedis() {
  const start = Date.now();
  try {
    const { getRedisStatus } = require("./cacheService");
    const redisStatus = getRedisStatus();
    const required = Boolean(process.env.REDIS_URL);
    const healthy = redisStatus === "connected" || (!required && redisStatus === "disabled");
    return {
      status: normalizeStatus(healthy, !required),
      latency: Date.now() - start,
      message: required
        ? `Redis status is ${redisStatus}`
        : "Redis is not configured; LRU cache fallback is active",
    };
  } catch (err) {
    return {
      status: "unhealthy",
      latency: Date.now() - start,
      message: err.message,
    };
  }
}

async function checkHorizon() {
  const horizonUrl =
    process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  const result = await probeGet(horizonUrl);
  if (!result.ok) {
    logger.warn({ error: result.error }, "health: Horizon unreachable");
  }
  return {
    status: normalizeStatus(result.ok),
    latency: result.latencyMs,
    message: result.ok ? "Horizon root endpoint responded" : result.error,
  };
}

async function checkSorobanRpc() {
  const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || null;
  if (!sorobanRpcUrl) {
    return {
      status: "degraded",
      latency: 0,
      message: "SOROBAN_RPC_URL is not configured",
    };
  }

  const result = await probeSorobanRpc(sorobanRpcUrl);
  if (!result.ok) {
    logger.warn({ error: result.error }, "health: Soroban RPC unreachable");
  }
  return {
    status: normalizeStatus(result.ok),
    latency: result.latencyMs,
    message: result.ok ? "Soroban RPC getHealth responded" : result.error,
  };
}

function checkDiskSpace() {
  try {
    if (typeof fs.statfsSync !== "function") {
      return {
        status: "degraded",
        latency: 0,
        message: "Disk usage probe is unavailable on this Node.js runtime",
      };
    }
    const start = Date.now();
    const stats = fs.statfsSync(process.cwd());
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const usedRatio = total > 0 ? (total - free) / total : 0;
    return {
      status: normalizeStatus(usedRatio < HEALTH_DISK_USED_RATIO),
      latency: Date.now() - start,
      message: `Disk usage ${(usedRatio * 100).toFixed(1)}%`,
    };
  } catch (err) {
    return { status: "degraded", latency: 0, message: err.message };
  }
}

function checkMemoryUsage() {
  const rss = process.memoryUsage().rss;
  return {
    status: normalizeStatus(rss < HEALTH_MEMORY_RSS_BYTES),
    latency: 0,
    message: `RSS memory ${rss} bytes`,
  };
}

function checkEventLoop() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const latency = Number(process.hrtime.bigint() - start) / 1_000_000;
      resolve({
        status: normalizeStatus(latency < HEALTH_EVENT_LOOP_LAG_MS),
        latency: Math.round(latency),
        message: `Event loop lag ${latency.toFixed(1)} ms`,
      });
    });
  });
}

/**
 * Run all dependency probes in parallel.
 *
 * @returns {Promise<{
 *   healthy: boolean,
 *   summary: string,
 *   dependencies: Record<string, { status: string, latency?: number, message?: string }>
 * }>}
 */
async function checkDependencies() {
  const [postgres, redis, horizon, sorobanRpc, diskSpace, memory, eventLoop] =
    await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkHorizon(),
      checkSorobanRpc(),
      Promise.resolve(checkDiskSpace()),
      Promise.resolve(checkMemoryUsage()),
      checkEventLoop(),
    ]);

  const dependencies = {
    postgres,
    redis,
    horizon,
    soroban_rpc: sorobanRpc,
    disk_space: diskSpace,
    memory,
    event_loop: eventLoop,
  };

  if (shuttingDown) {
    dependencies.shutdown = {
      status: "unhealthy",
      latency: 0,
      message: "Process is draining connections for shutdown",
    };
  }

  const critical = [dependencies.postgres, dependencies.redis, dependencies.horizon];
  const criticalHealthy = critical.every((d) => d.status !== "unhealthy");
  const anyDegraded = Object.values(dependencies).some(
    (d) => d.status === "degraded",
  );
  const healthy = criticalHealthy && !shuttingDown;
  const summary = !criticalHealthy || shuttingDown
    ? "critical_failure"
    : anyDegraded
      ? "degraded"
      : "all_healthy";

  return { healthy, summary, dependencies };
}

module.exports = {
  checkDependencies,
  getLivenessState,
  getStartupState,
  markShuttingDown,
  markStartupComplete,
};