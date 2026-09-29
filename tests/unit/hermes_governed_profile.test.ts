import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile
}));

vi.mock("../../packages/runtime/src/audit.js", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined)
}));

import {
  HermesProfileService,
  GOVERNED_TOOLSETS_TO_DISABLE,
  CLOUDOPS_MCP_SERVER_NAME,
  GOVERNED_MAX_TURNS,
  GOVERNED_FALLBACK_PROVIDERS
} from "@cloudops/runtime";

/**
 * ADR-0007 Phase C1a: the full list of guardrail/resilience/compaction
 * config keys `configureInvestigationGuardrails()` sets on every
 * successfully locked-down profile, in the order it sets them. Live-verified
 * this session against a disposable scratch Hermes profile (created, each
 * key set and independently confirmed present in that profile's own
 * config.yaml, then the scratch profile deleted).
 */
const ALL_GUARDRAIL_CONFIG_KEYS = [
  "agent.max_turns",
  "tool_loop_guardrails.hard_stop_enabled",
  "fallback_providers",
  "compression.enabled",
  "compression.threshold",
  "compression.target_ratio",
  "compression.protect_last_n",
  "compression.protect_first_n",
  "compression.abort_on_summary_failure",
  "compression.in_place"
] as const;

// ── Fixtures: real CLI output, live-verified against `hermes` v0.18.2 this
// session (see ADR-0008's companion audit) — not guessed. ──────────────────

const TOOLS_LIST_ALL_LOCKED_DOWN = `Built-in toolsets (cli):
  ✓ enabled  web  🔍 Web Search & Scraping
  ✗ disabled  browser  🌐 Browser Automation
  ✗ disabled  terminal  💻 Terminal & Processes
  ✗ disabled  file  📁 File Operations
  ✗ disabled  code_execution  ⚡ Code Execution
  ✓ enabled  vision  👁️  Vision / Image Analysis
  ✓ enabled  image_gen  🎨 Image Generation
  ✓ enabled  tts  🔊 Text-to-Speech
  ✓ enabled  skills  📚 Skills
  ✓ enabled  todo  📋 Task Planning
  ✓ enabled  memory  💾 Memory
  ✓ enabled  session_search  🔎 Session Search
  ✓ enabled  clarify  ❓ Clarifying Questions
  ✗ disabled  delegation  👥 Task Delegation
  ✗ disabled  cronjob  ⏰ Cron Jobs
  ✗ disabled  computer_use  🖱️  Computer Use (macOS/Windows/Linux)
`;

const TOOLS_LIST_DRIFTED = TOOLS_LIST_ALL_LOCKED_DOWN.replace(
  "✗ disabled  terminal  💻 Terminal & Processes",
  "✓ enabled  terminal  💻 Terminal & Processes"
);

const MCP_LIST_EMPTY = `
  No MCP servers configured.

  Add one with:
    hermes mcp add <name> --url <endpoint>
    hermes mcp add <name> --command <cmd> --args <args...>
`;

function mcpListWith(servers: Array<{ name: string; enabled: boolean }>): string {
  const rows = servers
    .map((s) => `  ${s.name} http://127.0.0.1:3000/v1/mcp/sse all ${s.enabled ? "✓ enabled" : "✗ disabled"}`)
    .join("\n");
  return `\n  MCP Servers:\n\n  Name             Transport                      Tools        Status\n  ──────────────── ────────────────────────────── ──────────── ──────────\n${rows}\n\n`;
}

const MCP_TEST_CONNECTED = `  Testing 'cloudops-control-plane'...\n  Transport: HTTP → http://localhost:3000/v1/mcp/sse\n  ✓ Connected (120ms)\n  ✓ Tools discovered: 5\n`;
const MCP_TEST_FAILED = `  Testing 'cloudops-control-plane'...\n  ✗ Connection failed (5000ms): timeout\n`;

interface Scenario {
  profileExists: boolean;
  toolsListStdout: string;
  mcpListStdout: string;
  mcpAddSucceeds: boolean;
  mcpTestStdout: string;
  /**
   * ADR-0008 Phase B (§4.3): whether `hermes config set ...` echoes back the
   * live-verified `✓ Set ... in .../config.yaml` confirmation. Defaults to
   * true so every existing Phase A scenario (none of which override this)
   * exercises a realistic successful guardrail-configuration step too,
   * without needing to touch any of those tests' own assertions.
   */
  configSetSucceeds: boolean;
}

function defaultScenario(): Scenario {
  return {
    profileExists: false,
    toolsListStdout: TOOLS_LIST_ALL_LOCKED_DOWN,
    mcpListStdout: MCP_LIST_EMPTY,
    mcpAddSucceeds: true,
    mcpTestStdout: MCP_TEST_CONNECTED,
    configSetSucceeds: true
  };
}

/**
 * Routes the mocked `execFile` by inspecting the Hermes CLI subcommand being
 * invoked, mirroring exactly what HermesProfileService's real `runHermes()`
 * sends. `mcp list` is stateful across a single provisioning run so that
 * "clear existing servers, then add ours, then re-list" behaves like the
 * real CLI: after any `mcp add`/`mcp remove` call, the registered set
 * mutates for subsequent `mcp list` calls in the same test.
 */
function wireExecFile(scenario: Scenario) {
  let registeredServers: Array<{ name: string; enabled: boolean }> | null = null;
  // Mutable, unlike `scenario.profileExists` (the test's starting
  // condition) — flips to true after a successful `profile create`, exactly
  // like the real CLI, so a re-verification `profile show` right after
  // creation correctly reports the profile now exists.
  let profileExists = scenario.profileExists;

  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
    const fakeChild = { stdin: { write: vi.fn(), end: vi.fn() } };

    const respond = (code: number, stdout: string, stderr = "") => {
      if (code === 0) {
        cb(null, stdout, stderr);
      } else {
        const err: any = new Error(`Command failed with exit code ${code}`);
        err.code = code;
        cb(err, stdout, stderr);
      }
    };

    queueMicrotask(() => {
      if (args.includes("show")) {
        respond(profileExists ? 0 : 1, profileExists ? "Profile: x\n" : "Error: Profile does not exist.\n");
      } else if (args.includes("create")) {
        profileExists = true;
        respond(0, "Profile created\n");
      } else if (args.includes("delete")) {
        profileExists = false;
        respond(0, "Profile deleted\n");
      } else if (args.includes("disable")) {
        respond(0, `✓ Disabled: ${GOVERNED_TOOLSETS_TO_DISABLE.join(", ")}\n`);
      } else if (args.includes("list") && args.includes("tools")) {
        respond(0, scenario.toolsListStdout);
      } else if (args.includes("list") && args.includes("mcp")) {
        if (registeredServers === null) {
          respond(0, scenario.mcpListStdout);
        } else {
          respond(0, registeredServers.length === 0 ? MCP_LIST_EMPTY : mcpListWith(registeredServers));
        }
      } else if (args.includes("remove")) {
        if (registeredServers === null) {
          // Seed from the initial scenario the first time something removes.
          registeredServers = [];
        }
        respond(0, "Removed\n");
      } else if (args.includes("add")) {
        registeredServers = scenario.mcpAddSucceeds ? [{ name: CLOUDOPS_MCP_SERVER_NAME, enabled: true }] : [];
        respond(0, scenario.mcpAddSucceeds ? `Saved '${CLOUDOPS_MCP_SERVER_NAME}'\n` : "Failed to connect: timeout\n");
      } else if (args.includes("test")) {
        respond(0, scenario.mcpAddSucceeds ? scenario.mcpTestStdout : MCP_TEST_FAILED);
      } else if (args.includes("config") && args.includes("set")) {
        const key = args[args.indexOf("set") + 1];
        respond(
          0,
          scenario.configSetSucceeds
            ? `✓ Set ${key} in ~/.hermes/profiles/${args[1]}/config.yaml\n`
            : "Error: could not write config file\n"
        );
      } else {
        respond(0, "");
      }
    });

    return fakeChild;
  });
}

function createDbMock(selectResult: { hermes_profile_name: string | null } | undefined) {
  const selectChain: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    executeTakeFirst: vi.fn().mockResolvedValue(selectResult)
  };
  const updateChain: any = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined)
  };
  return {
    selectFrom: vi.fn().mockReturnValue(selectChain),
    updateTable: vi.fn().mockReturnValue(updateChain),
    _selectChain: selectChain,
    _updateChain: updateChain
  } as any;
}

function createCredentialServiceMock(secret = "cred_test_secret_1234") {
  return {
    issueInitialCredential: vi.fn().mockResolvedValue({ credentialId: "cred_id_1", secret, expiresAt: new Date() })
  } as any;
}

describe("HermesProfileService (ADR-0008 Phase A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("provisionProfile", () => {
    it("locks down every governed toolset and registers CloudOps's own MCP server, verifying both independently", async () => {
      const scenario = defaultScenario();
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const credentialService = createCredentialServiceMock();
      const svc = new HermesProfileService({ db, credentialService, hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_test_001");

      expect(result.governanceStatus).toBe("LOCKED_DOWN");
      expect(result.mcpRegistered).toBe(true);
      expect(result.disabledToolsets).toEqual(expect.arrayContaining([...GOVERNED_TOOLSETS_TO_DISABLE]));
      expect(result.errors).toEqual([]);
      expect(result.hermesProfileName).toBe("ag_test_001");

      // Real credential minted and used to authenticate the MCP registration —
      // never an invented auth path.
      expect(credentialService.issueInitialCredential).toHaveBeenCalledWith("ten_test", "ag_test_001");

      // Persisted the successful outcome.
      expect(db._updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          hermes_profile_name: "ag_test_001",
          governance_status: "LOCKED_DOWN",
          mcp_registered: true
        })
      );

      // Toolset disable was actually invoked with the exact governed list.
      const disableCall = mockExecFile.mock.calls.find((c) => c[1].includes("disable"));
      expect(disableCall![1]).toEqual(["-p", "ag_test_001", "tools", "disable", ...GOVERNED_TOOLSETS_TO_DISABLE]);
    });

    it("creates the profile first when it doesn't already exist", async () => {
      const scenario = defaultScenario();
      scenario.profileExists = false;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      await svc.provisionProfile("ten_test", "ag_test_002");

      const createCall = mockExecFile.mock.calls.find((c) => c[1].includes("create"));
      expect(createCall![1]).toEqual(["profile", "create", "ag_test_002", "--clone", "--no-alias"]);
    });

    it("skips profile creation when the profile already exists (idempotent re-provisioning)", async () => {
      const scenario = defaultScenario();
      scenario.profileExists = true;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      await svc.provisionProfile("ten_test", "ag_test_003");

      const createCall = mockExecFile.mock.calls.find((c) => c[1].includes("create"));
      expect(createCall).toBeUndefined();
    });

    it("strips any MCP server inherited from --clone before registering its own", async () => {
      const scenario = defaultScenario();
      scenario.mcpListStdout = mcpListWith([{ name: "some-other-server", enabled: true }]);
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_test_004");

      const removeCall = mockExecFile.mock.calls.find((c) => c[1].includes("remove"));
      expect(removeCall![1]).toEqual(["-p", "ag_test_004", "mcp", "remove", "some-other-server"]);
      expect(result.governanceStatus).toBe("LOCKED_DOWN");
    });

    it("fails closed when a native toolset is still enabled after the disable command", async () => {
      const scenario = defaultScenario();
      scenario.toolsListStdout = TOOLS_LIST_DRIFTED;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_test_005");

      expect(result.governanceStatus).toBe("FAILED");
      expect(result.errors.some((e) => e.includes("terminal"))).toBe(true);
      expect(db._updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ governance_status: "FAILED" })
      );
    });

    it("fails closed when the MCP server is unreachable and does not leave it registered", async () => {
      const scenario = defaultScenario();
      scenario.mcpAddSucceeds = false;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_test_006");

      expect(result.governanceStatus).toBe("FAILED");
      expect(result.mcpRegistered).toBe(false);
      expect(result.errors.some((e) => e.includes(CLOUDOPS_MCP_SERVER_NAME))).toBe(true);
    });

    it("fails closed when profile creation itself fails, without attempting toolset/MCP steps", async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
        const fakeChild = { stdin: { write: vi.fn(), end: vi.fn() } };
        queueMicrotask(() => {
          if (args.includes("show")) {
            const err: any = new Error("exit 1");
            err.code = 1;
            cb(err, "Error: Profile does not exist.\n", "");
          } else if (args.includes("create")) {
            const err: any = new Error("exit 1");
            err.code = 1;
            cb(err, "", "permission denied\n");
          } else {
            cb(null, "", "");
          }
        });
        return fakeChild;
      });

      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_test_007");

      expect(result.governanceStatus).toBe("FAILED");
      const toolsCall = mockExecFile.mock.calls.find((c) => c[1].includes("disable"));
      expect(toolsCall).toBeUndefined();
    });

    it("throws RuntimeUnavailableError-shaped failure closed when the hermes binary itself cannot be spawned", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        const fakeChild = { stdin: { write: vi.fn(), end: vi.fn() } };
        queueMicrotask(() => {
          const err: any = new Error("spawn hermes-fake ENOENT");
          err.code = "ENOENT";
          cb(err, "", "");
        });
        return fakeChild;
      });

      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_test_008");

      expect(result.governanceStatus).toBe("FAILED");
      expect(result.errors.some((e) => e.includes("ENOENT") || e.includes("Hermes CLI invocation failed"))).toBe(true);
    });
  });

  describe("verifyGovernance", () => {
    it("returns PENDING without invoking the CLI when no profile has been provisioned yet", async () => {
      const db = createDbMock({ hermes_profile_name: null });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.verifyGovernance("ten_test", "ag_never_provisioned");

      expect(result.governanceStatus).toBe("PENDING");
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("re-confirms LOCKED_DOWN when both invariants independently still hold", async () => {
      const scenario = defaultScenario();
      scenario.mcpListStdout = mcpListWith([{ name: CLOUDOPS_MCP_SERVER_NAME, enabled: true }]);
      wireExecFile(scenario);
      const db = createDbMock({ hermes_profile_name: "ag_already_provisioned" });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.verifyGovernance("ten_test", "ag_already_provisioned");

      expect(result.governanceStatus).toBe("LOCKED_DOWN");
      expect(result.toolsetsLockedDown).toBe(true);
      expect(result.mcpRegistered).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("catches drift: a native toolset re-enabled out of band flips governance back to FAILED", async () => {
      const scenario = defaultScenario();
      scenario.toolsListStdout = TOOLS_LIST_DRIFTED;
      scenario.mcpListStdout = mcpListWith([{ name: CLOUDOPS_MCP_SERVER_NAME, enabled: true }]);
      wireExecFile(scenario);
      const db = createDbMock({ hermes_profile_name: "ag_drifted" });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.verifyGovernance("ten_test", "ag_drifted");

      expect(result.governanceStatus).toBe("FAILED");
      expect(result.enabledNativeToolsets).toContain("terminal");
    });

    it("catches drift: an extra MCP server registered out of band flips governance back to FAILED", async () => {
      const scenario = defaultScenario();
      scenario.mcpListStdout = mcpListWith([
        { name: CLOUDOPS_MCP_SERVER_NAME, enabled: true },
        { name: "sneaky-extra-server", enabled: true }
      ]);
      wireExecFile(scenario);
      const db = createDbMock({ hermes_profile_name: "ag_extra_server" });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.verifyGovernance("ten_test", "ag_extra_server");

      expect(result.governanceStatus).toBe("FAILED");
      expect(result.mcpRegistered).toBe(false);
      expect(result.mcpServers).toContain("sneaky-extra-server");
    });
  });

  describe("provisionProfile guardrail configuration (ADR-0008 Phase B §4.3)", () => {
    it("sets agent.max_turns and tool_loop_guardrails.hard_stop_enabled on every successfully locked-down profile", async () => {
      const scenario = defaultScenario();
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_guardrail_001");

      expect(result.governanceStatus).toBe("LOCKED_DOWN");
      expect(result.guardrailWarnings).toEqual([]);

      // Filter specifically to the two guardrail keys — provisioning also
      // issues two OTHER `config set` calls for the MCP transport fix
      // (mcp_servers.<name>.transport / .enabled, see provisionProfile's
      // MCP registration step), which aren't guardrails and are asserted on
      // separately below.
      const configSetCalls = mockExecFile.mock.calls.filter(
        (c) => c[1].includes("config") && c[1].includes("set") && (c[1].includes("agent.max_turns") || c[1].includes("tool_loop_guardrails.hard_stop_enabled"))
      );
      expect(configSetCalls).toHaveLength(2);
      const flatArgs = configSetCalls.map((c) => c[1] as string[]);
      expect(flatArgs).toContainEqual([
        "-p",
        "ag_guardrail_001",
        "config",
        "set",
        "agent.max_turns",
        String(GOVERNED_MAX_TURNS)
      ]);
      expect(flatArgs).toContainEqual([
        "-p",
        "ag_guardrail_001",
        "config",
        "set",
        "tool_loop_guardrails.hard_stop_enabled",
        "true"
      ]);
    });

    it("ADR-0007 Phase C1a: sets the fallback_providers and compression.* config keys on every successfully locked-down profile", async () => {
      const scenario = defaultScenario();
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_c1a_001");

      expect(result.governanceStatus).toBe("LOCKED_DOWN");
      expect(result.guardrailWarnings).toEqual([]);

      // fallback_providers ships as a documented no-op (empty array) — never
      // a fabricated plausible-looking provider name (CO-026 anti-fabrication
      // convention).
      expect(GOVERNED_FALLBACK_PROVIDERS).toEqual([]);

      const configSetCalls = mockExecFile.mock.calls.filter(
        (c) => c[1].includes("config") && c[1].includes("set")
      );
      const flatArgs = configSetCalls.map((c) => c[1] as string[]);

      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "fallback_providers", "[]"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.enabled", "true"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.threshold", "0.6"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.target_ratio", "0.2"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.protect_last_n", "20"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.protect_first_n", "3"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.abort_on_summary_failure", "true"]);
      expect(flatArgs).toContainEqual(["-p", "ag_c1a_001", "config", "set", "compression.in_place", "false"]);

      // All 10 guardrail/resilience/compaction keys were attempted (2 from
      // Phase B + 8 new Phase C1a ones), distinct from the 2 unconditional
      // MCP-transport-fix config-set calls made during registration.
      const guardrailKeyCalls = configSetCalls.filter((c) =>
        (ALL_GUARDRAIL_CONFIG_KEYS as readonly string[]).includes(c[1][c[1].indexOf("set") + 1])
      );
      expect(guardrailKeyCalls).toHaveLength(ALL_GUARDRAIL_CONFIG_KEYS.length);
    });

    it("ADR-0007 Phase C1a: a fallback_providers/compression.* config-set failure is non-fatal — governance_status stays LOCKED_DOWN", async () => {
      const scenario = defaultScenario();
      scenario.configSetSucceeds = false;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_c1a_002");

      expect(result.governanceStatus).toBe("LOCKED_DOWN");
      expect(result.mcpRegistered).toBe(true);
      expect(result.errors).toEqual([]);

      expect(result.guardrailWarnings.length).toBe(ALL_GUARDRAIL_CONFIG_KEYS.length);
      expect(result.guardrailWarnings.some((w) => w.includes("fallback_providers"))).toBe(true);
      expect(result.guardrailWarnings.some((w) => w.includes("compression.enabled"))).toBe(true);
      expect(result.guardrailWarnings.some((w) => w.includes("compression.abort_on_summary_failure"))).toBe(true);
    });

    it("does not fail provisioning when the guardrail config-set calls fail — governance_status stays LOCKED_DOWN", async () => {
      const scenario = defaultScenario();
      scenario.configSetSucceeds = false;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_guardrail_002");

      // The security-critical invariants (toolset lockdown, MCP-only
      // registration) are unaffected by a guardrail config-set failure —
      // this is the entire point of keeping it a separate, non-fatal step.
      expect(result.governanceStatus).toBe("LOCKED_DOWN");
      expect(result.mcpRegistered).toBe(true);
      expect(result.errors).toEqual([]);

      // The failure is still visible, just in its own bucket, never mixed
      // into `errors` (which reporting code may reasonably read as "why did
      // this fail closed"). Now 10 keys total (2 Phase B + 8 Phase C1a) since
      // every one of them shares the same non-fatal config-set failure mode.
      expect(result.guardrailWarnings.length).toBe(ALL_GUARDRAIL_CONFIG_KEYS.length);
      expect(result.guardrailWarnings.some((w) => w.includes("agent.max_turns"))).toBe(true);
      expect(result.guardrailWarnings.some((w) => w.includes("hard_stop_enabled"))).toBe(true);

      expect(db._updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ governance_status: "LOCKED_DOWN" })
      );
    });

    it("skips guardrail configuration entirely when the base lockdown already failed", async () => {
      const scenario = defaultScenario();
      scenario.mcpAddSucceeds = false;
      wireExecFile(scenario);
      const db = createDbMock(undefined);
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.provisionProfile("ten_test", "ag_guardrail_003");

      expect(result.governanceStatus).toBe("FAILED");
      expect(result.guardrailWarnings).toEqual([]);
      // The MCP transport-fix config-set calls (transport/enabled) still run
      // unconditionally as part of the registration attempt itself — see
      // provisionProfile's MCP registration step — but the investigation
      // guardrail keys specifically must never be touched once the base
      // lockdown has already failed.
      const guardrailConfigSetCalls = mockExecFile.mock.calls.filter(
        (c) => c[1].includes("config") && c[1].includes("set") && (c[1].includes("agent.max_turns") || c[1].includes("tool_loop_guardrails.hard_stop_enabled"))
      );
      expect(guardrailConfigSetCalls).toHaveLength(0);
    });
  });

  describe("deprovisionProfile", () => {
    it("deletes the profile when one is on record and exists", async () => {
      wireExecFile({ ...defaultScenario(), profileExists: true });
      const db = createDbMock({ hermes_profile_name: "ag_to_delete" });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.deprovisionProfile("ten_test", "ag_to_delete");

      expect(result.deleted).toBe(true);
      const deleteCall = mockExecFile.mock.calls.find((c) => c[1].includes("delete"));
      expect(deleteCall![1]).toEqual(["profile", "delete", "ag_to_delete", "-y"]);
    });

    it("is a no-op when the agent never had a Hermes profile provisioned", async () => {
      wireExecFile(defaultScenario());
      const db = createDbMock({ hermes_profile_name: null });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.deprovisionProfile("ten_test", "ag_never_provisioned");

      expect(result.deleted).toBe(false);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("is non-fatal (does not throw) when the Hermes CLI fails during teardown", async () => {
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
        const fakeChild = { stdin: { write: vi.fn(), end: vi.fn() } };
        queueMicrotask(() => {
          const err: any = new Error("spawn hermes-fake ENOENT");
          err.code = "ENOENT";
          cb(err, "", "");
        });
        return fakeChild;
      });
      const db = createDbMock({ hermes_profile_name: "ag_broken_teardown" });
      const svc = new HermesProfileService({ db, credentialService: createCredentialServiceMock(), hermesBin: "hermes-fake" });

      const result = await svc.deprovisionProfile("ten_test", "ag_broken_teardown");

      expect(result.deleted).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
