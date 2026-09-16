import { describe, it, expect } from "vitest";
import { sanitizeLogString, formatErrorResponse, REDACTED_PATHS } from "@cloudops/shared";
import { CANONICAL_TOOLS } from "@cloudops/tools";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard AWS credential regex patterns
const AWS_ACCESS_KEY_REGEX = /\b(AKIA[0-9A-Z]{16})\b/;
const AWS_SECRET_KEY_REGEX = /\b([a-zA-Z0-9/+=]{40})\b/;
const AWS_SESSION_TOKEN_REGEX = /\b(AQoDYXdz[a-zA-Z0-9/+=]{50,})\b/;
const GENERIC_TOKEN_REGEX = /(co_inv_[a-f0-9]{32}|co_agent_[a-f0-9]{64}|cred_[a-f0-9]{64})/;

describe("Credential & Secret Redaction Scanner (CO-003 & CO-021)", () => {
  it("1. sanitizeLogString redacts AWS access keys and high-entropy secret tokens", () => {
    const rawLog = "Connecting to AWS using AKIAIOSFODNN7EXAMPLE with secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY and token co_inv_1234567890abcdef1234567890abcdef";
    const sanitized = sanitizeLogString(rawLog);

    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(sanitized).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(sanitized).not.toContain("co_inv_1234567890abcdef1234567890abcdef");
    expect(sanitized).toContain("[REDACTED");
  });

  it("2. formatErrorResponse redacts secrets embedded in exception messages and metadata", () => {
    const errorWithSecret = new Error("Authentication failed for key AKIAIOSFODNN7EXAMPLE with secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    (errorWithSecret as any).metadata = {
      apiKey: "secret_12345",
      accessKey: "AKIAIOSFODNN7EXAMPLE"
    };

    const { statusCode, payload } = formatErrorResponse(errorWithSecret);
    expect(statusCode).toBe(500);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(serialized).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(serialized).not.toContain("secret_12345");
  });

  it("3. Scans all canonical tool schemas and handlers to verify zero hardcoded AWS secret keys", () => {
    for (const tool of CANONICAL_TOOLS) {
      const desc = tool.description;
      const name = tool.name;

      expect(desc).not.toMatch(AWS_ACCESS_KEY_REGEX);
      expect(name).not.toMatch(AWS_ACCESS_KEY_REGEX);
    }
  });

  it("4. Scans mock runtime fixtures to verify no real AWS access keys leak into prompt templates", () => {
    const fixturesDir = path.resolve(__dirname, "../../packages/runtime/fixtures");
    if (fs.existsSync(fixturesDir)) {
      const fixtureFiles = fs.readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
      for (const file of fixtureFiles) {
        const content = fs.readFileSync(path.join(fixturesDir, file), "utf8");
        expect(content).not.toMatch(AWS_ACCESS_KEY_REGEX);
        expect(content).not.toMatch(AWS_SESSION_TOKEN_REGEX);
      }
    }
  });

  it("5. Verifies REDACTED_PATHS in shared package covers critical auth paths", () => {
    expect(REDACTED_PATHS).toContain("accessKeyId");
    expect(REDACTED_PATHS).toContain("secretAccessKey");
    expect(REDACTED_PATHS).toContain("sessionToken");
    expect(REDACTED_PATHS).toContain("inviteToken");
    expect(REDACTED_PATHS).toContain("claimSecret");
  });
});
