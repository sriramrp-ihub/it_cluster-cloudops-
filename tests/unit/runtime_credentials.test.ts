import { describe, it, expect } from "vitest";
import {
  generateRuntimeCredentialToken,
  isRuntimeCredentialToken,
  generateSalt,
  hashToken,
  verifyTokenHash
} from "@cloudops/shared";

describe("Phase 3: Runtime Credentials Cryptographic Unit Tests", () => {
  it("generates runtime credential tokens with 256 bits of entropy and cred_ prefix", () => {
    const token = generateRuntimeCredentialToken();
    expect(token.startsWith("cred_")).toBe(true);
    // cred_ (5 chars) + 32 bytes hex (64 chars) = 69 chars
    expect(token.length).toBe(69);
    expect(isRuntimeCredentialToken(token)).toBe(true);
  });

  it("generates unique tokens across multiple invocations", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateRuntimeCredentialToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("hashes credential token with salt and verifies using constant-time comparison", () => {
    const token = generateRuntimeCredentialToken();
    const salt = generateSalt();
    const hash = hashToken(token, salt);

    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA-256 hex digest
    expect(verifyTokenHash(token, hash, salt)).toBe(true);
  });

  it("fails verification if token, hash, or salt is tampered", () => {
    const token = generateRuntimeCredentialToken();
    const salt = generateSalt();
    const hash = hashToken(token, salt);

    // Tampered token
    const wrongToken = generateRuntimeCredentialToken();
    expect(verifyTokenHash(wrongToken, hash, salt)).toBe(false);

    // Tampered salt
    const wrongSalt = generateSalt();
    expect(verifyTokenHash(token, hash, wrongSalt)).toBe(false);

    // Tampered hash
    const wrongHash = hash.substring(0, 63) + (hash[63] === "0" ? "1" : "0");
    expect(verifyTokenHash(token, wrongHash, salt)).toBe(false);
  });
});
