const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";

let transportConfig = undefined;
if (!isProduction) {
  try {
    require.resolve("pino-pretty");
    transportConfig = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    };
  } catch (_) {
    // pino-pretty not installed — fall back to JSON output in development too.
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => {
      return { service: "finchippay-backend", ...bindings };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "privateKey",
      "secret",
      "password",
      "token",
      "signature",
      "jwt",
      "authorization",
      "apiKey",
      "api_key",
      "accessToken",
      "access_token",
      "refreshToken",
      "refresh_token",
    ],
    censor: "[REDACTED]",
  },
  transport: transportConfig,
});

module.exports = logger;
