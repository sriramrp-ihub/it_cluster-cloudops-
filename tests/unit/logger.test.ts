import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger, sanitizeLogString } from "@cloudops/shared";

describe("Pino Structured Logging & Secret Redaction", () => {
  it("automatically redacts sensitive keys from structured log objects", () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      }
    });

    const testLogger = createLogger("test-logger", {
      level: "debug"
    }, stream as any);

    testLogger.info({
      agentId: "ag_12345",
      token: "secret_token_value_abc",
      password: "my_plain_text_password",
      authorization: "Bearer supersecretbearer123",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      sessionToken: "AQoDYXdzEJr1111111111111111",
      safeParam: "allowed_value"
    }, "Agent authentication attempt");

    expect(logs.length).toBeGreaterThan(0);
    const logOutput = logs.join("");
    const parsed = JSON.parse(logOutput);

    // Verify allowed parameters remain intact
    expect(parsed.agentId).toBe("ag_12345");
    expect(parsed.safeParam).toBe("allowed_value");

    // Verify secrets are redacted
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.password).toBe("[REDACTED]");
    expect(parsed.authorization).toBe("[REDACTED]");
    expect(parsed.secretAccessKey).toBe("[REDACTED]");
    expect(parsed.sessionToken).toBe("[REDACTED]");

    // Verify raw secret values do not appear anywhere in the output string
    expect(logOutput).not.toContain("secret_token_value_abc");
    expect(logOutput).not.toContain("my_plain_text_password");
    expect(logOutput).not.toContain("supersecretbearer123");
    expect(logOutput).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
  });

  it("sanitizes raw tokens from string messages using sanitizeLogString", () => {
    const rawMsg = "Received request with token co_inv_1234567890abcdef12345678 and claim co_agent_fedcba98765432101234567890abcdef0123456789abcdef0123456789abcdef";
    const sanitized = sanitizeLogString(rawMsg);

    expect(sanitized).not.toContain("co_inv_1234567890abcdef12345678");
    expect(sanitized).not.toContain("co_agent_fedcba98765432101234567890abcdef0123456789abcdef0123456789abcdef");
    expect(sanitized).toContain("[REDACTED]");
  });
});
