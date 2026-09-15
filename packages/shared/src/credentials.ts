import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ============================================================================
 * CLOUDOPS CREDENTIAL SEPARATION & STORAGE ARCHITECTURE
 * ============================================================================
 * 
 * CloudOps strictly separates four distinct credential categories, each with
 * different lifetimes, scopes, authority boundaries, and cryptographic storage:
 * 
 * 1. INVITE TOKEN (co_inv_...)
 *    - Purpose: Machine onboarding bootstrap.
 *    - Lifetime: Short-lived (typically 24 hours), single-use.
 *    - Storage: Hashed before persistence. Raw token returned ONCE to human operator.
 *    - Authority: Zero cloud authority. Allows reading onboarding manifest and
 *      submitting a declarative Join Request only.
 * 
 * 2. ONE-TIME CLAIM CREDENTIAL (co_agent_...)
 *    - Purpose: Claiming agent identity after human operator approval.
 *    - Lifetime: Extremely short (e.g. 15 minutes), single-use.
 *    - Entropy: Cryptographically random 256 bits minimum (32 bytes hex).
 *    - Storage: Hashed before persistence. Raw token returned ONCE upon approval.
 *    - Authority: Zero cloud authority. Consumed atomically to initialize the agent
 *      session and issue the first Runtime Agent Credential.
 * 
 * 3. RUNTIME AGENT CREDENTIAL (cred_...)
 *    - Purpose: Ongoing agent authentication to the CloudOps Agent Gateway.
 *    - Lifetime: Medium (e.g. 7-30 days), rotatable without changing agent identity.
 *    - Storage: Hashed before persistence (SHA-256 with optional salt). Raw secret returned
 *      once to the agent during handshake/rotation.
 *    - Authority: Agent-level CloudOps access only. Zero direct cloud authority.
 * 
 * 4. JIT CLOUD CREDENTIALS (AWS STS AssumeRole / Ephemeral Token)
 *    - Purpose: Temporary cloud provider authority for executing authorized tools.
 *    - Lifetime: Ephemeral (typically 5 to 15 minutes).
 *    - Scope: Scoped strictly to the specific authorized operation and target resource.
 *    - Isolation: Strictly server-side inside CloudOps execution boundary.
 *      NEVER exposed to agent reasoning, prompts, ACP payloads, logs, or UI.
 * 
 * ----------------------------------------------------------------------------
 * CRYPTOGRAPHIC STORAGE STRATEGY: PASSWORD HASHING VS TOKEN HASHING
 * ----------------------------------------------------------------------------
 * Industry best practice (NIST SP 800-63B, OWASP, RFC 6750):
 * - Password hashing algorithms (Argon2, bcrypt, PBKDF2) are engineered to defend
 *   against dictionary and brute-force attacks on LOW-ENTROPY human passwords
 *   by introducing artificial computational delay and memory cost.
 * - Machine-generated tokens in CloudOps possess >= 256 bits of cryptographic entropy
 *   generated via CSPRNG (node:crypto). Brute-force dictionary attacks against
 *   256-bit entropy are mathematically impossible (requiring 2^256 operations).
 * - Applying slow password hashing to machine tokens adds dangerous latency to
 *   API handshakes and creates a Denial-of-Service vector against control planes.
 * - Therefore, CloudOps uses fast, collision-resistant cryptographic hashing (SHA-256)
 *   with an optional domain-specific salt for storing random machine tokens.
 * - Constant-time comparison (crypto.timingSafeEqual) is strictly enforced to
 *   prevent timing side-channel attacks.
 * ============================================================================
 */

/**
 * Hash a high-entropy token or credential using SHA-256.
 * The raw token is NEVER stored in the database.
 */
export function hashToken(token: string, salt: string = ""): string {
  const hash = createHash("sha256");
  if (salt) {
    hash.update(salt);
  }
  hash.update(token);
  return hash.digest("hex");
}

/**
 * Constant-time comparison between a provided plaintext token (hashed) and stored hash.
 * Protects against timing side-channel attacks.
 */
export function verifyTokenHash(providedToken: string, storedHash: string, salt: string = ""): boolean {
  const computedHash = hashToken(providedToken, salt);
  const computedBuffer = Buffer.from(computedHash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");

  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(computedBuffer, storedBuffer);
}

/**
 * Generate a random cryptographic salt (16 bytes hex)
 */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}
