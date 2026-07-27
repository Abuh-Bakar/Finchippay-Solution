const pino = require("pino");

const STELLAR_SECRET_KEY_PATTERN = /S[A-Z2-7]{55}/g;
const REDACTED = "[REDACTED_STELLAR_SECRET]";

function redactSecrets(obj) {
  if (typeof obj === "string") return obj.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED);
  if (obj instanceof Error) {
    obj.message = obj.message.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED);
    if (obj.stack) obj.stack = obj.stack.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED);
    return obj;
  }
  if (obj && typeof obj === "object") {
    try {
      const str = JSON.stringify(obj);
      if (STELLAR_SECRET_KEY_PATTERN.test(str)) {
        return JSON.parse(str.replace(STELLAR_SECRET_KEY_PATTERN, REDACTED));
      }
    } catch {}
  }
  return obj;
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: (err) => redactSecrets(err),
    error: (err) => redactSecrets(err),
    msg: (msg) => redactSecrets(msg),
  },
  hooks: {
    logMethod(inputArgs, method) {
      const args = inputArgs.map((arg) => redactSecrets(arg));
      return method.apply(this, args);
    },
  },
});

module.exports = logger;
