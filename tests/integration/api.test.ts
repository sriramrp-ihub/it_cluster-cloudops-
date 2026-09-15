import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { ValidationError } from "@cloudops/shared";
import { closeDatabase, runMigrations } from "@cloudops/database";

describe("API Server Integration Tests", () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await runMigrations();
    app = buildApp();
    // Register a test error route to verify global error handling
    app.get("/test/validation-error", async () => {
      throw new ValidationError("Cluster parameter missing", {
        parameter: "cluster",
        secret_token: "co_agent_hidden_value"
      });
    });
    app.get("/test/unhandled-error", async () => {
      throw new Error("Unexpected crash at line 42");
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it("GET /healthz returns 200 OK with process liveness info", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/healthz"
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /readyz returns 200 OK with database connection status when PostgreSQL is healthy", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/readyz"
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ready");
    expect(body.dependencies.database).toBe("connected");
  });

  it("formats domain ValidationError into HTTP 400 with sanitized metadata and no stack trace", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test/validation-error"
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Cluster parameter missing");
    expect(body.error.metadata.parameter).toBe("cluster");
    expect(body.error.metadata.secret_token).toBe("[REDACTED]");
    expect(body.stack).toBeUndefined();
    expect(body.error.stack).toBeUndefined();
  });

  it("safely translates unhandled errors into HTTP 500 without leaking stack traces", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/test/unhandled-error"
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.stack).toBeUndefined();
    expect(body.error.stack).toBeUndefined();
  });

  it("returns structured 404 for unknown routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/unknown/route"
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
