import pino, { Logger, LoggerOptions, DestinationStream } from "pino";

/**
 * List of sensitive paths and property names automatically redacted by Pino.
 */
export const REDACTED_PATHS = [
  "authorization",
  "headers.authorization",
  "*.authorization",
  "req.headers.authorization",
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "credential",
  "*.credential",
  "credentials",
  "*.credentials",
  "raw_credential",
  "*.raw_credential",
  "raw_token",
  "*.raw_token",
  "invite_token",
  "*.invite_token",
  "claim_token",
  "*.claim_token",
  "accessKeyId",
  "*.accessKeyId",
  "secretAccessKey",
  "*.secretAccessKey",
  "sessionToken",
  "*.sessionToken",
  "key",
  "*.key",
  "apiKey",
  "*.apiKey",
  "api_key",
  "*.api_key",
  "client_secret",
  "*.client_secret"
];

/**
 * Regex patterns for redacting raw tokens appearing in arbitrary log strings.
 */
const TOKEN_PATTERNS = [
  /co_inv_[0-9a-fA-F]+/g,
  /co_agent_[0-9a-fA-F]+/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g
];

/**
 * Sanitize strings to ensure raw tokens embedded in messages are never logged.
 */
export function sanitizeLogString(str: string): string {
  let sanitized = str;
  for (const pattern of TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

/**
 * Create a configured Pino logger with mandatory secret redaction.
 */
export function createLogger(
  name: string = "cloudops",
  customOptions?: LoggerOptions,
  destination?: DestinationStream
): Logger {
  const isDev = process.env["NODE_ENV"] === "development";
  const logLevel = process.env["LOG_LEVEL"] || process.env["API_LOG_LEVEL"] || (isDev ? "debug" : "info");

  const options: LoggerOptions = {
    name,
    level: logLevel,
    redact: {
      paths: REDACTED_PATHS,
      censor: "[REDACTED]"
    },
    formatters: {
      level: (label) => ({ level: label })
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...customOptions
  };

  if (destination) {
    return pino(options, destination);
  }

  return pino(options);
}

/**
 * Global default CloudOps logger instance
 */
export const logger = createLogger("cloudops-core");
