/**
 * CloudOps Structured Error Hierarchy.
 * 
 * Provides stable error codes, HTTP status mapping, safe JSON serialization,
 * and guaranteed exclusion of internal stack traces in client responses.
 */

export interface SerializedError {
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorResponseEnvelope {
  error: SerializedError;
}

export abstract class CloudOpsError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public readonly metadata: Record<string, unknown>;

  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.metadata = metadata;
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Produce a client-safe serialized representation.
   * Internal stack traces and internal secrets are NEVER included.
   */
  public toJSON(): ErrorResponseEnvelope {
    const serialized: SerializedError = {
      code: this.code,
      message: this.message
    };
    if (Object.keys(this.metadata).length > 0) {
      serialized.metadata = this.sanitizeMetadata(this.metadata);
    }
    return { error: serialized };
  }

  private sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = new Set([
      "password", "secret", "token", "credential", "authorization",
      "accesskey", "secretkey", "sessiontoken", "key"
    ]);

    for (const [key, value] of Object.entries(meta)) {
      const lower = key.toLowerCase();
      if (Array.from(sensitiveKeys).some(s => lower.includes(s))) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

/** 400 Bad Request: Input validation failures */
export class ValidationError extends CloudOpsError {
  public readonly code = "VALIDATION_ERROR";
  public readonly statusCode = 400;
}

/** 401 Unauthorized: Authentication failures (invalid/expired credentials, failed handshake) */
export class AuthenticationError extends CloudOpsError {
  public readonly code = "AUTHENTICATION_ERROR";
  public readonly statusCode = 401;
}

/** 403 Forbidden: Capability authorization or permission failures */
export class AuthorizationError extends CloudOpsError {
  public readonly code = "AUTHORIZATION_ERROR";
  public readonly statusCode = 403;
}

/** 404 Not Found: Entity not found */
export class NotFoundError extends CloudOpsError {
  public readonly code = "NOT_FOUND";
  public readonly statusCode = 404;
}

/** 409 Conflict: Concurrent modification, duplicate registration, or consumed tokens */
export class ConflictError extends CloudOpsError {
  public readonly code = "CONFLICT";
  public readonly statusCode = 409;
}

/** 403 Forbidden: Operation denied by deterministic policy engine */
export class PolicyDenialError extends CloudOpsError {
  public readonly code = "POLICY_DENIAL";
  public readonly statusCode = 403;
}

/** 
 * 428 Precondition Required / Structured response: Operation requires human approval 
 * before cloud execution can proceed.
 */
export class ApprovalRequiredError extends CloudOpsError {
  public readonly code = "APPROVAL_REQUIRED";
  public readonly statusCode = 428;
}

/** 503 Service Unavailable: Agent runtime is not running, disconnected, or unreachable */
export class RuntimeUnavailableError extends CloudOpsError {
  public readonly code = "AGENT_RUNTIME_UNAVAILABLE";
  public readonly statusCode = 503;
}

/** 502 Bad Gateway / 503: Cloud provider adapter error (AWS/Azure/GCP API failure) */
export class CloudAdapterError extends CloudOpsError {
  public readonly code = "CLOUD_ADAPTER_ERROR";
  public readonly statusCode = 502;
}

/** 403 Forbidden: Operation violates fundamental governance policy */
export class PolicyViolationError extends CloudOpsError {
  public readonly code = "POLICY_VIOLATION";
  public readonly statusCode = 403;
}

/** 401 Unauthorized: Digital operator signature is missing, forged, or invalid */
export class SignatureVerificationError extends CloudOpsError {
  public readonly code = "INVALID_SIGNATURE";
  public readonly statusCode = 401;
}

/** 409 Conflict: Mutation is already executing or has completed with the given idempotency key */
export class IdempotencyConflictError extends CloudOpsError {
  public readonly code = "IDEMPOTENCY_CONFLICT";
  public readonly statusCode = 409;
}

/** 500 Internal Server Error: Unhandled system error */
export class InternalError extends CloudOpsError {
  public readonly code = "INTERNAL_ERROR";
  public readonly statusCode = 500;
}

/**
 * Format any unknown caught error into a safe client response envelope
 */
export function formatErrorResponse(error: unknown): { statusCode: number; payload: ErrorResponseEnvelope } {
  if (error instanceof CloudOpsError) {
    return {
      statusCode: error.statusCode,
      payload: error.toJSON()
    };
  }

  // Generic unhandled error: do not expose internal exception details to client
  const fallbackMessage = error instanceof Error ? error.message : "An unexpected internal error occurred";
  return {
    statusCode: 500,
    payload: {
      error: {
        code: "INTERNAL_ERROR",
        message: fallbackMessage
      }
    }
  };
}
