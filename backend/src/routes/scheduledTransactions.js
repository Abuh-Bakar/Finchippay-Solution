/**
 * src/routes/scheduledTransactions.js
 * CRUD + execution routes for cron-based scheduled Stellar transactions.
 */
"use strict";
const express = require("express");
const router = express.Router();
const scheduledTransactionService = require("../services/scheduledTransactionService");
const { validate } = require("../validation/middleware");
const {
  scheduleTransactionSchema,
  loosePublicKeyParamSchema,
  idParamSchema,
} = require("../validation/schemas");
const { formatErrorResponse, ERROR_CODES } = require("../../../shared/errorCodes");

/**
 * POST /api/scheduled-txns
 * Schedules a new transaction for future submission.
 * Body: { signedXDR: string, submitAt: string (ISO 8601), publicKey: string }
 */
router.post("/", validate(scheduleTransactionSchema), (req, res, next) => {
  try {
    const { signedXDR, submitAt, publicKey } = req.validated;
    const schedule = scheduledTransactionService.createSchedule({
      signedXDR,
      submitAt,
      publicKey,
    });
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scheduled-txns/pending/:id/submit
 * Submit a signed XDR for a pending scheduled transaction execution.
 */
router.post("/pending/:id/submit", async (req, res, next) => {
  try {
    const { signedXDR } = req.body;
    if (!signedXDR) {
      return res
        .status(ERROR_CODES.VAL_MISSING_FIELD.httpStatus)
        .json(formatErrorResponse("VAL_MISSING_FIELD", { fields: ["signedXDR"] }));
    }
    const result = await scheduledTransactionService.submitPendingExecution(
      req.params.id,
      signedXDR,
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scheduled-txns/:publicKey
 * Lists all pending scheduled transactions for a given public key.
 */
router.get(
  "/:publicKey",
  validate(loosePublicKeyParamSchema, "params"),
  (req, res, next) => {
    try {
      const { publicKey } = req.validated;
      const transactions =
        scheduledTransactionService.listSchedules(publicKey);
      res.json(transactions);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * DELETE /api/scheduled-txns/:id
 * Cancels (deletes) a scheduled transaction.
 */
router.delete("/:id", validate(idParamSchema, "params"), (req, res, next) => {
  try {
    const { id } = req.validated;
    const cancelled = scheduledTransactionService.deleteSchedule(id);
    if (cancelled) {
      res.json({ message: `Transaction ${id} cancelled successfully.` });
    } else {
      res
        .status(ERROR_CODES.RES_NOT_FOUND.httpStatus)
        .json(
          formatErrorResponse("RES_NOT_FOUND", {
            resourceType: "scheduledTransaction",
            id,
          }),
        );
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
