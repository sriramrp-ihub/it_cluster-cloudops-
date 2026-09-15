import { generateKeyPairSync, sign, verify } from "node:crypto";
import { SignatureVerificationError } from "@cloudops/shared";

export interface OperatorKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Service for cryptographic operator key generation, digital signing,
 * and server-side signature verification.
 */
export class OperatorSignatureService {
  /**
   * Generates a standard Ed25519 keypair for an operator.
   */
  static generateKeyPair(): OperatorKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    return {
      publicKeyPem: publicKey,
      privateKeyPem: privateKey
    };
  }

  /**
   * Constructs the deterministic canonical sign-string:
   * approvalId:payloadHash:timestamp
   */
  static constructSignPayload(approvalId: string, payloadHash: string, timestamp: number): Buffer {
    return Buffer.from(`${approvalId}:${payloadHash}:${timestamp}`, "utf8");
  }

  /**
   * Operator signs the operation approval payload hash with their private key.
   */
  static signApproval(
    approvalId: string,
    payloadHash: string,
    timestamp: number,
    privateKeyPem: string
  ): string {
    const data = OperatorSignatureService.constructSignPayload(approvalId, payloadHash, timestamp);
    const signature = sign(null, data, privateKeyPem);
    return signature.toString("base64");
  }

  /**
   * Verifies the operator's digital signature server-side before approving or executing.
   */
  static verifyApprovalSignature(
    approvalId: string,
    payloadHash: string,
    timestamp: number,
    signatureBase64: string,
    publicKeyPem: string
  ): boolean {
    try {
      const data = OperatorSignatureService.constructSignPayload(approvalId, payloadHash, timestamp);
      const signature = Buffer.from(signatureBase64, "base64");
      return verify(null, data, publicKeyPem, signature);
    } catch {
      return false;
    }
  }

  /**
   * Enforces that the signature is valid; throws SignatureVerificationError if invalid or forged.
   */
  static assertValidSignature(
    approvalId: string,
    payloadHash: string,
    timestamp: number,
    signatureBase64: string | null | undefined,
    publicKeyPem: string | null | undefined
  ): void {
    if (!signatureBase64 || !publicKeyPem) {
      throw new SignatureVerificationError("Missing required digital operator signature or public key");
    }

    const isValid = OperatorSignatureService.verifyApprovalSignature(
      approvalId,
      payloadHash,
      timestamp,
      signatureBase64,
      publicKeyPem
    );

    if (!isValid) {
      throw new SignatureVerificationError(
        `Digital signature verification failed for approval ${approvalId}: signature is invalid or forged`
      );
    }
  }
}
