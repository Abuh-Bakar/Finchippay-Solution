/**
 * src/routes/health.js
 * Health check endpoints used by CI, load balancers, and Kubernetes probes.
 */

"use strict";

const express = require("express");
const {
  checkDependencies,
  getLivenessState,
  getStartupState,
} = require("../services/healthService");
const { verifyJWT, requireAdmin } = require("../middleware/auth");

const router = express.Router();

function sendLive(_req, res) {
  res.json(getLivenessState());
}

router.get("/", sendLive);
router.get("/live", sendLive);

router.get("/ready", async (_req, res, next) => {
  try {
    const { healthy, summary, dependencies } = await checkDependencies();
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ready" : "not_ready",
      checks: dependencies,
      summary,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/started", (_req, res) => {
  const startup = getStartupState();
  res.status(startup.initialized ? 200 : 503).json(startup);
});

router.get("/dependencies", verifyJWT, requireAdmin, async (_req, res, next) => {
  try {
    const { summary, dependencies } = await checkDependencies();
    res.json({
      status: summary,
      checks: dependencies,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;