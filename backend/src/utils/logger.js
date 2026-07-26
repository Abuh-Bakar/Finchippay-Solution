const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "finchippay-backend" },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  mixin() {
    // dynamically require to avoid circular dependency
    const { getRequestId } = require("./correlationId");
    const correlationId = getRequestId();
    return correlationId ? { correlationId } : {};
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["privateKey", "secret", "password", "token", "signature"],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        },
      }),
});

module.exports = logger;
