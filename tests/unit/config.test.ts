import { describe, it, expect } from "vitest";
import { loadConfig } from "../../apps/api/src/config.js";

describe("Environment Configuration Validation", () => {
  it("loads valid configuration with defaults", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      API_PORT: "4000",
      DATABASE_URL: "postgres://localhost:5432/cloudops"
    });

    expect(cfg.NODE_ENV).toBe("test");
    expect(cfg.API_PORT).toBe(4000);
    expect(cfg.DATABASE_URL).toBe("postgres://localhost:5432/cloudops");
    expect(cfg.API_LOG_LEVEL).toBe("info");
  });

  it("fails on invalid log level", () => {
    expect(() => {
      loadConfig({
        API_LOG_LEVEL: "invalid_level" as any
      });
    }).toThrow(/Configuration validation failed/);
  });
});
