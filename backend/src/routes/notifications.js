/**
 * src/routes/notifications.js
 * Email notification preference management API endpoints.
 */

"use strict";

const express = require("express");
const router = express.Router();
const notificationService = require("../services/notificationService");
const {
  formatErrorResponse,
  ERROR_CODES,
} = require("../../../shared/errorCodes");
const { validate } = require("../validation/middleware");
const {
  registerEmailSchema,
  updateEmailSchema,
  publicKeyParamSchema,
  emailEventsQuerySchema,
} = require("../validation/schemas");

/**
 * POST /api/notifications/email
 * Register an email for notification preferences for a Stellar account.
 *
 * Body: { publicKey: "G...", email: "user@example.com", events?: string[] }
 */
router.post(
  "/email",
  validate(registerEmailSchema),
  async (req, res, next) => {
    try {
      const { publicKey, email, events } = req.validated;
      const preference = await notificationService.registerEmail(
        publicKey,
        email,
        { events },
      );
      return res.status(201).json({ success: true, preference });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/notifications/email/:publicKey
 * Update email notification preferences for a Stellar account.
 *
 * Body: { email?: string, events?: string[] }
 */
router.put(
  "/email/:publicKey",
  validate(publicKeyParamSchema, "params"),
  validate(updateEmailSchema),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const { email, events } = req.validated;

      // Fetch existing preference
      const existing = await notificationService.getEmailPreference(publicKey);
      if (!existing) {
        return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "notification_preference",
            publicKey,
          }),
        );
      }

      const preference = await notificationService.registerEmail(
        publicKey,
        email || existing.email,
        { events: events || existing.events },
      );
      return res.json({ success: true, preference });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/notifications/email/:publicKey
 * Get email notification preferences for a Stellar account.
 */
router.get(
  "/email/:publicKey",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const preference = await notificationService.getEmailPreference(publicKey);
      if (!preference) {
        return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "notification_preference",
            publicKey,
          }),
        );
      }
      return res.json({ success: true, preference });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/notifications/email/:publicKey
 * Delete email notification preferences for a Stellar account.
 */
router.delete(
  "/email/:publicKey",
  validate(publicKeyParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const deleted = await notificationService.deleteEmailPreference(publicKey);
      if (!deleted) {
        return res.status(ERROR_CODES.RES_NOT_FOUND.httpStatus).json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "notification_preference",
            publicKey,
          }),
        );
      }
      return res.json({
        success: true,
        message: `Notification preference for ${publicKey} deleted`,
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
