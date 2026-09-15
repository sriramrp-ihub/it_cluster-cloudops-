import { describe, it, expect } from "vitest";
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  PolicyDenialError,
  ApprovalRequiredError,
  RuntimeUnavailableError,
  CloudAdapterError,
  NotFoundError,
  ConflictError,
  InternalError,
  formatErrorResponse
} from "@cloudops/shared";

describe("CloudOps Structured Error Hierarchy", () => {
  it("maps error classes to corresponding HTTP status codes and error codes", () => {
    expect(new ValidationError("bad input").statusCode).toBe(400);
    expect(new ValidationError("bad input").code).toBe("VALIDATION_ERROR");

    expect(new AuthenticationError("invalid token").statusCode).toBe(401);
    expect(new AuthenticationError("invalid token").code).toBe("AUTHENTICATION_ERROR");

    expect(new AuthorizationError("forbidden").statusCode).toBe(403);
    expect(new AuthorizationError("forbidden").code).toBe("AUTHORIZATION_ERROR");

    expect(new NotFoundError("not found").statusCode).toBe(404);
    expect(new NotFoundError("not found").code).toBe("NOT_FOUND");

    expect(new ConflictError("conflict").statusCode).toBe(409);
    expect(new ConflictError("conflict").code).toBe("CONFLICT");

    expect(new PolicyDenialError("policy denied").statusCode).toBe(403);
    expect(new PolicyDenialError("policy denied").code).toBe("POLICY_DENIAL");

    expect(new ApprovalRequiredError("needs human approval").statusCode).toBe(428);
    expect(new ApprovalRequiredError("needs human approval").code).toBe("APPROVAL_REQUIRED");

    expect(new RuntimeUnavailableError("hermes unreachable").statusCode).toBe(503);
    expect(new RuntimeUnavailableError("hermes unreachable").code).toBe("AGENT_RUNTIME_UNAVAILABLE");

    expect(new CloudAdapterError("AWS ECS failure").statusCode).toBe(502);
    expect(new CloudAdapterError("AWS ECS failure").code).toBe("CLOUD_ADAPTER_ERROR");

    expect(new InternalError("system crash").statusCode).toBe(500);
    expect(new InternalError("system crash").code).toBe("INTERNAL_ERROR");
  });

  it("serializes errors without stack traces", () => {
    const err = new ValidationError("Invalid ECS cluster name", { field: "cluster" });
    const json = err.toJSON();

    expect(json.error).toBeDefined();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Invalid ECS cluster name");
    expect(json.error.metadata).toEqual({ field: "cluster" });
    expect((json as any).stack).toBeUndefined();
    expect((json.error as any).stack).toBeUndefined();

    // Check JSON.stringify output does not contain file paths or stack trace words
    const stringified = JSON.stringify(json);
    expect(stringified).not.toContain("Error:");
    expect(stringified).not.toContain(".ts:");
  });

  it("automatically redacts sensitive keys embedded in error metadata", () => {
    const err = new AuthenticationError("Failed authentication", {
      agentId: "ag_test",
      raw_token: "co_agent_supersecret12345",
      password: "mySecretPassword!",
      authorization: "Bearer sensitive_token",
      nested: {
        secretKey: "aws_secret_key"
      }
    });

    const json = err.toJSON();
    const meta = json.error.metadata as any;

    expect(meta.agentId).toBe("ag_test");
    expect(meta.raw_token).toBe("[REDACTED]");
    expect(meta.password).toBe("[REDACTED]");
    expect(meta.authorization).toBe("[REDACTED]");
    expect(meta.nested.secretKey).toBe("[REDACTED]");
  });

  it("safely formats unhandled non-CloudOps errors into 500 without stack leakage", () => {
    const rawError = new Error("Database query timeout at /internal/db/client.ts:89");
    const { statusCode, payload } = formatErrorResponse(rawError);

    expect(statusCode).toBe(500);
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(payload.error.message).toBe("Database query timeout at /internal/db/client.ts:89");
    expect((payload as any).stack).toBeUndefined();
  });
});
