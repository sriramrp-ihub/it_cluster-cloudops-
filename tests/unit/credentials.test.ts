import { describe, it, expect } from "vitest";
import { generateClaimCredential, generateSalt, hashToken, verifyTokenHash } from "@cloudops/shared";

describe("Credential Security & Hashing", () => {
  it("computes deterministic SHA-256 token hash", () => {
    const token = generateClaimCredential();
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    expect(hash1.length).toBe(64); // 256 bits = 64 hex chars
    expect(hash1).toBe(hash2);
  });

  it("verifies matching token hash using timingSafeEqual", () => {
    const token = generateClaimCredential();
    const salt = generateSalt();
    const hash = hashToken(token, salt);

    expect(verifyTokenHash(token, hash, salt)).toBe(true);
  });

  it("rejects invalid or tampered tokens", () => {
    const token = generateClaimCredential();
    const tampered = token + "x";
    const salt = generateSalt();
    const hash = hashToken(token, salt);

    expect(verifyTokenHash(tampered, hash, salt)).toBe(false);
    expect(verifyTokenHash("completely_wrong_token", hash, salt)).toBe(false);
  });

  it("rejects token when salt differs", () => {
    const token = generateClaimCredential();
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const hash = hashToken(token, salt1);

    expect(verifyTokenHash(token, hash, salt2)).toBe(false);
  });
});
