"use strict";

const crypto = require("crypto");
const { Horizon } = require("@stellar/stellar-sdk");
const logger = require("../utils/logger");
const metrics = require("./metricsService");
const { getRequestIdHeader } = require("../utils/correlationId");
require("dotenv").config();

function getCache() {
  try { return require("./cacheService"); } catch { return null; }
}

const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);
const webhooks = new Map();
let nextId = 1;
const activeStreams = new Map();

function registerWebhook(publicKey, url, secret) {
  const id = String(nextId++);
  const webhook = { id, publicKey, url, secret, createdAt: new Date().toISOString() };
  webhooks.set(id, webhook);
  startMonitoring(webhook);
  logger.info({ type: "webhook_registered", id, publicKey, url });
  return { id, publicKey, url, createdAt: webhook.createdAt };
}

function getWebhooksByPublicKey(publicKey) {
  return Array.from(webhooks.values()).filter((w) => w.publicKey === publicKey).map(({ id, publicKey: pk, url, createdAt }) => ({ id, publicKey: pk, url, createdAt }));
}

function deleteWebhook(id) {
  const webhook = webhooks.get(id);
  const publicKey = webhook ? webhook.publicKey : null;
  const exists = webhooks.has(id);
  if (exists) {
    webhooks.delete(id);
    logger.info({ type: "webhook_deleted", id });
    const remaining = Array.from(webhooks.values()).filter(w => w.publicKey === publicKey);
    if (remaining.length === 0 && publicKey && activeStreams.has(publicKey)) {
      activeStreams.get(publicKey)();
      activeStreams.delete(publicKey);
      metrics.activeWebhookStreams.set(activeStreams.size);
      logger.info({ type: "horizon_monitoring_stopped", publicKey });
    }
  }
  return exists;
}

function signPayload(secret, payload) {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

async function deliverWebhook(webhook, payload) {
  const signature = signPayload(webhook.secret, payload);
  try {
    const res = await fetch(webhook.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, ...getRequestIdHeader() }, body: JSON.stringify(payload) });
    if (!res.ok) { logger.error({ type: "webhook_delivery_failed", id: webhook.id, status: res.status, url: webhook.url }); }
    else { logger.info({ type: "webhook_delivered", id: webhook.id, url: webhook.url }); }
  } catch (err) { logger.error({ type: "webhook_delivery_error", id: webhook.id, url: webhook.url, error: err.message }); }
}

function startMonitoring(webhook) {
  metrics.horizonRequestsTotal.inc({ operation: "startSSE", status: "success" });
  if (activeStreams.has(webhook.publicKey)) return;
  const closeStream = server.payments().forAccount(webhook.publicKey).cursor("now").stream({
    onmessage: async (payment) => {
      if (payment.type !== "payment" || payment.to !== webhook.publicKey) return;
      try { const cache = getCache(); if (cache) { await cache.del("account:" + webhook.publicKey); await cache.delPattern("payments:" + webhook.publicKey + ":*"); } } catch {}
      const payload = { event: "payment.received", publicKey: webhook.publicKey, payment: { id: payment.id, from: payment.from, to: payment.to, amount: payment.amount, asset: payment.asset_type === "native" ? "XLM" : payment.asset_code, createdAt: payment.created_at } };
      const hooks = getWebhooksByPublicKey(webhook.publicKey);
      await Promise.allSettled(hooks.map((h) => deliverWebhook(h, payload)));
    },
    onerror: (err) => { logger.error({ type: "horizon_sse_error", publicKey: webhook.publicKey, error: err.message }); metrics.horizonRequestsTotal.inc({ operation: "sse", status: "error" }); activeStreams.delete(webhook.publicKey); metrics.activeWebhookStreams.set(activeStreams.size); },
  });
  activeStreams.set(webhook.publicKey, closeStream);
  metrics.activeWebhookStreams.set(activeStreams.size);
  logger.info({ type: "horizon_monitoring_started", publicKey: webhook.publicKey });
}

module.exports = { registerWebhook, getWebhooksByPublicKey, deleteWebhook, signPayload };
