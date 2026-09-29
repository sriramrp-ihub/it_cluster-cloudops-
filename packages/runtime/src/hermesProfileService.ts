import { execFile } from "node:child_process";
import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  RuntimeUnavailableError,
  logger,
  type AgentGovernanceStatus,
  type AgentId
} from "@cloudops/shared";
import { RuntimeCredentialService } from "./credentialService.js";
import { recordAuditEvent } from "./audit.js";

/**
 * ADR-0008 (Governed Runtime — MCP-Only Execution Boundary), Phase A.
 *
 * Every native Hermes toolset that executes in-process on this host, with no
 * MCP message and nothing for PolicyEngine to intercept — confirmed live via
 * `hermes tools list` during the capability audit this ADR records. These
 * are the ones that must be explicitly, permanently disabled per agent
 * profile; NOT an exhaustive list of every toolset Hermes ships (e.g. `web`,
 * `memory`, `vision` stay enabled — they're model-capability toolsets, not
 * host-execution ones, and are out of this ADR's stated scope).
 */
export const GOVERNED_TOOLSETS_TO_DISABLE = [
  "terminal",
  "file",
  "code_execution",
  "browser",
  "computer_use",
  "delegation",
  "cronjob"
] as const;

/** The one MCP server every governed profile is allowed to have. */
export const CLOUDOPS_MCP_SERVER_NAME = "cloudops-control-plane";

/**
 * ADR-0008 Phase B (§4.3): bounded turn budget for autonomous, unattended
 * investigation loops. Hermes's own global default (`agent.max_turns: 90`,
 * per the installed CLI's `hermes_cli/config.py` `DEFAULT_CONFIG`, live-read
 * during the Phase B design session) is sized for interactive human
 * sessions; an unattended adaptive investigation should be bounded tighter —
 * generous enough for a real multi-tool investigation, small enough to bound
 * worst-case cost/latency. This is a product/ops tuning call, not a security
 * invariant (see GOVERNED_TOOLSETS_TO_DISABLE above for the actual security
 * boundary), which is why a failure to set it never flips governance_status.
 */
export const GOVERNED_MAX_TURNS = 20;

export interface HermesProfileServiceConfig {
  hermesBin?: string | undefined;
  /** Base URL CloudOps's own API (and its /v1/mcp/sse route) is reachable at from this host. */
  mcpBaseUrl?: string | undefined;
  cliTimeoutMs?: number | undefined;
  credentialService?: RuntimeCredentialService | undefined;
  db?: Kysely<DatabaseSchema> | undefined;
}

export interface ProvisionGovernedProfileResult {
  agentId: string;
  hermesProfileName: string;
  governanceStatus: AgentGovernanceStatus;
  mcpRegistered: boolean;
  disabledToolsets: string[];
  verifiedAt: Date;
  errors: string[];
  /**
   * ADR-0008 Phase B (§4.3): non-fatal issues from setting the investigation
   * turn-budget/hard-stop guardrails. Deliberately a SEPARATE field from
   * `errors` — a guardrail config-set failure must never be able to flip
   * `governanceStatus` to FAILED (it's a cost/quality knob, not a security
   * invariant), so it's never mixed into the array that reporting code might
   * reasonably treat as "why did this fail closed". Empty whenever every
   * guardrail setting was confirmed applied (or guardrail configuration
   * wasn't attempted at all, e.g. because the security-critical lockdown
   * steps above already failed).
   */
  guardrailWarnings: string[];
}

export interface VerifyGovernanceResult {
  agentId: string;
  hermesProfileName: string | null;
  governanceStatus: AgentGovernanceStatus;
  toolsetsLockedDown: boolean;
  enabledNativeToolsets: string[];
  mcpRegistered: boolean;
  mcpServers: string[];
  verifiedAt: Date;
  errors: string[];
}

export interface DeprovisionGovernedProfileResult {
  agentId: string;
  hermesProfileName: string | null;
  deleted: boolean;
  error?: string | undefined;
}

interface HermesCliResult {
  stdout: string;
  stderr: string;
  /** Process exit code. Hermes's own subcommands consistently exit 0 even on a "logical" failure (server unreachable, profile not found) — callers must parse stdout, not branch on this, except for `profile show`'s existence check. */
  code: number;
}

interface ToolsetLine {
  name: string;
  enabled: boolean;
}

interface McpServerLine {
  name: string;
  enabled: boolean;
}

/**
 * Drives the real, live-verified `hermes` CLI (see ADR-0008 and its
 * companion capability audit) to provision, lock down, re-verify, and tear
 * down one isolated Hermes profile per onboarded agent.
 *
 * Every mutating step here is followed by an independent re-check parsed
 * from a fresh CLI call — provisioning-time success is never trusted on its
 * own, per the ADR's fail-closed requirement. `verifyGovernance()` re-runs
 * the exact same checks on demand (e.g. from diagnostics) so drift after
 * provisioning (a toolset re-enabled, an extra MCP server added out of
 * band) is caught too, not just the initial provisioning attempt.
 */
export class HermesProfileService {
  private readonly hermesBin: string;
  private readonly mcpBaseUrl: string;
  private readonly cliTimeoutMs: number;
  private readonly credentialService: RuntimeCredentialService;
  private readonly db: Kysely<DatabaseSchema>;

  constructor(config: HermesProfileServiceConfig = {}) {
    this.hermesBin = config.hermesBin || process.env.HERMES_BIN || "hermes";
    this.mcpBaseUrl =
      config.mcpBaseUrl ||
      process.env.CLOUDOPS_INTERNAL_API_URL ||
      `http://localhost:${process.env.API_PORT || 3000}`;
    this.cliTimeoutMs = config.cliTimeoutMs ?? 30000;
    this.credentialService = config.credentialService || new RuntimeCredentialService();
    this.db = config.db || getDatabase();
  }

  /**
   * The Hermes profile name for a given agent. Hermes profile names accept
   * dashes/underscores in practice (live-verified — `hermes profile
   * create`'s own `--help` claims "lowercase, alphanumeric" but a name with
   * dashes was accepted without error), so the agent's own `ag_<uuid>` ID is
   * used directly rather than inventing a second identifier to track.
   */
  public profileNameFor(agentId: string): string {
    return agentId;
  }

  private get mcpSseUrl(): string {
    return `${this.mcpBaseUrl.replace(/\/+$/, "")}/v1/mcp/sse`;
  }

  // ── CLI plumbing ──────────────────────────────────────────────────────

  /**
   * Runs `hermes [-p <profile>] <args>`. Never throws for a clean process
   * exit (even non-zero) — Hermes's own subcommands print failures as text
   * and still exit 0 in every case observed during the live audit, so exit
   * code alone can't distinguish success from failure. Only throws
   * (RuntimeUnavailableError) when the CLI itself couldn't be run at all:
   * binary missing, killed by timeout, etc.
   */
  private runHermes(
    profileName: string | undefined,
    args: string[],
    opts?: { stdin?: string | undefined; timeoutMs?: number | undefined }
  ): Promise<HermesCliResult> {
    const fullArgs = profileName ? ["-p", profileName, ...args] : args;
    return new Promise<HermesCliResult>((resolve, reject) => {
      const child = execFile(
        this.hermesBin,
        fullArgs,
        {
          timeout: opts?.timeoutMs ?? this.cliTimeoutMs,
          maxBuffer: 5 * 1024 * 1024,
          env: { ...process.env }
        },
        (err: any, stdout, stderr) => {
          const stdoutStr = stdout?.toString() ?? "";
          const stderrStr = stderr?.toString() ?? "";
          if (err) {
            // A real CLI exit-with-error has a numeric exit code — Hermes's
            // own subcommands consistently exit 0 even on a "logical"
            // failure (server unreachable, profile not found), so a
            // numeric code here means the process itself couldn't run
            // cleanly. Still treat it as an ordinary, parseable result
            // rather than throwing: `profile show` on a missing profile is
            // exactly this shape, and callers branch on stdout content, not
            // this promise rejecting.
            if (typeof err.code === "number") {
              resolve({ stdout: stdoutStr, stderr: stderrStr, code: err.code });
              return;
            }
            // Spawn-level failure: binary missing (ENOENT), killed by
            // timeout (code null, signal set), etc. — genuinely unrecoverable.
            reject(
              new RuntimeUnavailableError(
                `Hermes CLI invocation failed (${[this.hermesBin, ...fullArgs].join(" ")}): ${err?.message || err}`
              )
            );
            return;
          }
          resolve({ stdout: stdoutStr, stderr: stderrStr, code: 0 });
        }
      );

      if (child.stdin) {
        if (opts?.stdin !== undefined) {
          child.stdin.write(opts.stdin);
        }
        child.stdin.end();
      }
    });
  }

  private async profileExists(profileName: string): Promise<boolean> {
    const result = await this.runHermes(undefined, ["profile", "show", profileName]);
    if (result.code === 0) return true;
    if (/does not exist/i.test(result.stdout) || /does not exist/i.test(result.stderr)) return false;
    // Unexpected failure shape — fail closed rather than silently assuming "doesn't exist".
    throw new RuntimeUnavailableError(
      `Could not determine whether Hermes profile '${profileName}' exists: ${result.stdout || result.stderr}`
    );
  }

  private parseToolsList(stdout: string): ToolsetLine[] {
    const lines: ToolsetLine[] = [];
    const lineRe = /[✓✗]\s+(enabled|disabled)\s+(\S+)/;
    for (const rawLine of stdout.split("\n")) {
      const match = rawLine.match(lineRe);
      if (match) {
        lines.push({ enabled: match[1] === "enabled", name: match[2]! });
      }
    }
    return lines;
  }

  private parseMcpList(stdout: string): McpServerLine[] {
    if (/No MCP servers configured/i.test(stdout)) return [];
    const servers: McpServerLine[] = [];
    let inTable = false;
    for (const rawLine of stdout.split("\n")) {
      if (!inTable) {
        if (/Name.*Transport.*Tools.*Status/.test(rawLine)) {
          inTable = true;
        }
        continue;
      }
      if (/^\s*─+/.test(rawLine)) continue; // header separator
      const trimmed = rawLine.trim();
      if (!trimmed) break; // end of table
      const name = trimmed.split(/\s+/)[0]!;
      // "disabled" never contains "enabled" as a substring, so this is safe
      // regardless of column alignment (see parseMcpList's caller for why
      // fixed-width column splitting isn't reliable here — server names can
      // exceed the CLI's display width).
      const enabled = /enabled/.test(trimmed) && !/disabled/.test(trimmed);
      servers.push({ name, enabled });
    }
    return servers;
  }

  /**
   * Removes every configured MCP server from a profile, tolerating a
   * profile that already has none. Used both to strip anything `--clone`
   * carried over from the source profile and to guarantee a clean retry
   * before (re-)registering CloudOps's own server — the "ONLY MCP server"
   * invariant must hold regardless of what history the profile has.
   * `hermes mcp remove` defaults its confirmation prompt to yes, so closing
   * stdin without an answer (EOF) proceeds with the removal.
   */
  private async clearMcpServers(profileName: string): Promise<string[]> {
    const listResult = await this.runHermes(profileName, ["mcp", "list"]);
    const existing = this.parseMcpList(listResult.stdout);
    const removed: string[] = [];
    for (const server of existing) {
      await this.runHermes(profileName, ["mcp", "remove", server.name], { stdin: "" });
      removed.push(server.name);
    }
    return removed;
  }

  // ── Provisioning ──────────────────────────────────────────────────────

  /**
   * Provisions (or re-provisions) an onboarded agent's isolated, governed
   * Hermes profile: create-if-absent, disable every native toolset and
   * verify it stuck, strip any other MCP server and register CloudOps's own
   * as the only one, verify that registration independently, then persist
   * the outcome. Fails closed: governanceStatus is only ever LOCKED_DOWN
   * when every check above passed; any failure anywhere leaves it FAILED
   * (never partially-applied-but-marked-good) so the caller must not treat
   * the agent as safely governed.
   *
   * Never throws for a governance failure it can attribute to a specific
   * step (CLI errors, unreachable MCP endpoint) — those are captured in the
   * returned `errors` array with governanceStatus: 'FAILED'. Only throws
   * for something callers truly cannot recover from (Hermes CLI missing
   * entirely).
   */
  async provisionProfile(tenantId: string, agentId: AgentId | string): Promise<ProvisionGovernedProfileResult> {
    const profileName = this.profileNameFor(agentId);
    const errors: string[] = [];
    let disabledToolsets: string[] = [];
    let mcpRegistered = false;

    try {
      const alreadyExists = await this.profileExists(profileName);
      if (!alreadyExists) {
        const createResult = await this.runHermes(undefined, [
          "profile",
          "create",
          profileName,
          "--clone",
          "--no-alias"
        ]);
        if (!(await this.profileExists(profileName))) {
          errors.push(`Profile creation did not produce a usable profile: ${createResult.stdout || createResult.stderr}`);
        }
      }
    } catch (err: any) {
      errors.push(`Profile creation failed: ${err?.message || err}`);
      return this.finalizeProvision(tenantId, agentId, profileName, [], false, errors);
    }

    if (errors.length > 0) {
      return this.finalizeProvision(tenantId, agentId, profileName, [], false, errors);
    }

    // 1. Lock down native toolsets and independently re-verify.
    try {
      await this.runHermes(profileName, ["tools", "disable", ...GOVERNED_TOOLSETS_TO_DISABLE]);
      const verifyResult = await this.runHermes(profileName, ["tools", "list"]);
      const parsed = this.parseToolsList(verifyResult.stdout);
      const stillEnabled = GOVERNED_TOOLSETS_TO_DISABLE.filter((toolset) =>
        parsed.some((t) => t.name === toolset && t.enabled)
      );
      disabledToolsets = GOVERNED_TOOLSETS_TO_DISABLE.filter((t) => !stillEnabled.includes(t));
      if (stillEnabled.length > 0) {
        errors.push(`Native toolset(s) still enabled after disable: ${stillEnabled.join(", ")}`);
      }
    } catch (err: any) {
      errors.push(`Toolset lockdown failed: ${err?.message || err}`);
    }

    const toolsetsLockedDown = errors.length === 0;

    // 2. Register CloudOps's own MCP server as the ONLY one, and
    // independently re-verify via a fresh `mcp list` + `mcp test` — never
    // trust the `mcp add` transcript alone.
    try {
      await this.clearMcpServers(profileName);

      const credential = await this.credentialService.issueInitialCredential(tenantId, agentId as AgentId);
      // Answers, in order, for whichever of `hermes mcp add`'s prompts
      // actually appear (live-verified this session): "Does this server
      // require authentication?" -> yes; "API key / Bearer token:" -> the
      // real per-agent runtime credential just minted above; and either
      // "Enable all N tools?" (successful connection, default yes) or
      // "Save config anyway?" (failed connection, default NO — so an
      // unreachable MCP endpoint safely does NOT get registered even though
      // a 3rd "y" line is buffered, since that prompt only appears when the
      // connection attempt itself already failed and stdin is closed
      // before it, matching the safe default).
      const stdin = `y\n${credential.secret}\ny\n`;
      await this.runHermes(
        profileName,
        ["mcp", "add", CLOUDOPS_MCP_SERVER_NAME, "--url", this.mcpSseUrl, "--auth", "header", "--connect-timeout", "15"],
        { stdin, timeoutMs: Math.max(this.cliTimeoutMs, 30000) }
      );

      // Live-verified this Phase B session (not in the original Phase A
      // code — see this ADR's design notes for why): the installed Hermes
      // CLI's `mcp` Python client defaults to the modern Streamable HTTP
      // transport, which POSTs JSON-RPC messages to the SAME url it did the
      // initial SSE handshake against. CloudOps's own MCP server
      // (packages/tools/src/mcpServer.ts, apps/api's /v1/mcp/sse + separate
      // /v1/mcp/messages routes) implements the MCP SDK's older
      // `SSEServerTransport` — GET /v1/mcp/sse for the event stream, POST to
      // a DIFFERENT url (/v1/mcp/messages?sessionId=...) for JSON-RPC. That
      // is a real transport-version mismatch, not a reachability problem:
      // `hermes mcp add` has no `--transport` flag, so its own connectivity
      // probe reliably fails ("Session terminated") and saves the server
      // disabled, exactly like a genuinely unreachable endpoint would.
      // Explicitly setting `transport: sse` (config key confirmed by reading
      // hermes-agent's own tools/mcp_tool.py this session) and re-enabling
      // is what actually fixes it — live-verified: `hermes mcp test` then
      // reports a real "Connected" and discovers all registered tools. This
      // must run unconditionally (mcp add's own probe already failed and
      // disabled the entry by this point in every real environment observed
      // so far), before the independent mcp list/mcp test re-verification
      // below, which is what actually proves this worked rather than just
      // trusting the config write.
      await this.runHermes(profileName, [
        "config",
        "set",
        `mcp_servers.${CLOUDOPS_MCP_SERVER_NAME}.transport`,
        "sse"
      ]);
      await this.runHermes(profileName, [
        "config",
        "set",
        `mcp_servers.${CLOUDOPS_MCP_SERVER_NAME}.enabled`,
        "true"
      ]);

      const listResult = await this.runHermes(profileName, ["mcp", "list"]);
      const servers = this.parseMcpList(listResult.stdout);
      const ours = servers.find((s) => s.name === CLOUDOPS_MCP_SERVER_NAME);
      const extras = servers.filter((s) => s.name !== CLOUDOPS_MCP_SERVER_NAME);

      if (extras.length > 0) {
        errors.push(`Unexpected MCP server(s) registered besides '${CLOUDOPS_MCP_SERVER_NAME}': ${extras.map((e) => e.name).join(", ")}`);
      }

      if (!ours || !ours.enabled) {
        errors.push(`MCP server '${CLOUDOPS_MCP_SERVER_NAME}' did not register successfully (likely unreachable at ${this.mcpSseUrl})`);
        // Clean up a disabled/half-registered stub so a retry starts fresh.
        await this.clearMcpServers(profileName).catch(() => {});
      } else {
        const testResult = await this.runHermes(profileName, ["mcp", "test", CLOUDOPS_MCP_SERVER_NAME]);
        const connected = /Connected \(/.test(testResult.stdout) && !/Connection failed/i.test(testResult.stdout);
        if (!connected) {
          errors.push(`MCP server '${CLOUDOPS_MCP_SERVER_NAME}' registered but failed live connectivity re-check: ${testResult.stdout}`);
        } else {
          mcpRegistered = extras.length === 0;
        }
      }
    } catch (err: any) {
      errors.push(`MCP registration failed: ${err?.message || err}`);
    }

    const succeeded = toolsetsLockedDown && mcpRegistered;

    // 3. ADR-0008 Phase B (§4.3): set the autonomous-investigation turn
    // budget and hard-stop guardrail on every profile that actually reached
    // LOCKED_DOWN. Deliberately gated on `succeeded` (not run for a profile
    // that's about to be marked FAILED anyway) and deliberately NOT allowed
    // to affect `succeeded` itself — see configureInvestigationGuardrails's
    // own doc comment and ProvisionGovernedProfileResult.guardrailWarnings.
    const guardrailWarnings = succeeded ? await this.configureInvestigationGuardrails(profileName) : [];

    return this.finalizeProvision(tenantId, agentId, profileName, disabledToolsets, succeeded, errors, guardrailWarnings);
  }

  /**
   * ADR-0008 Phase B (§4.3): sets the two tool-loop guardrail config keys
   * live-verified against the installed Hermes CLI this ADR's design session
   * confirmed are real and settable per-profile:
   *   hermes -p <profile> config set agent.max_turns <GOVERNED_MAX_TURNS>
   *   hermes -p <profile> config set tool_loop_guardrails.hard_stop_enabled true
   * Never throws and never contributes to `provisionProfile()`'s
   * governance-status computation — a mis-set turn budget is a cost/quality
   * concern, not the security boundary GOVERNED_TOOLSETS_TO_DISABLE and the
   * MCP-only invariant are. Every failure (CLI error, or a `config set` that
   * ran but didn't echo back the live-verified `✓ Set ...` confirmation) is
   * collected into the returned warnings array and logged, never thrown.
   */
  private async configureInvestigationGuardrails(profileName: string): Promise<string[]> {
    const warnings: string[] = [];
    const settings: Array<[string, string]> = [
      ["agent.max_turns", String(GOVERNED_MAX_TURNS)],
      ["tool_loop_guardrails.hard_stop_enabled", "true"]
    ];

    for (const [key, value] of settings) {
      try {
        const result = await this.runHermes(profileName, ["config", "set", key, value]);
        const applied = /✓\s*Set\b/i.test(result.stdout);
        if (!applied) {
          warnings.push(`Guardrail config '${key}=${value}' did not confirm as applied: ${result.stdout || result.stderr}`);
        }
      } catch (err: any) {
        warnings.push(`Guardrail config '${key}=${value}' failed: ${err?.message || err}`);
      }
    }

    if (warnings.length > 0) {
      logger.warn(
        { profileName, warnings },
        "Hermes investigation guardrail configuration incomplete (non-fatal — does not affect governance_status)"
      );
    }

    return warnings;
  }

  private async finalizeProvision(
    tenantId: string,
    agentId: AgentId | string,
    profileName: string,
    disabledToolsets: string[],
    succeeded: boolean,
    errors: string[],
    guardrailWarnings: string[] = []
  ): Promise<ProvisionGovernedProfileResult> {
    const verifiedAt = new Date();
    const governanceStatus: AgentGovernanceStatus = succeeded ? "LOCKED_DOWN" : "FAILED";
    const mcpRegistered = succeeded;

    await this.persistGovernance(tenantId, agentId, {
      hermesProfileName: profileName,
      governanceStatus,
      governanceVerifiedAt: verifiedAt,
      mcpRegistered
    });

    await recordAuditEvent({
      tenantId,
      eventType: governanceStatus === "LOCKED_DOWN" ? "AGENT_GOVERNANCE_PROVISIONED" : "AGENT_GOVERNANCE_PROVISION_FAILED",
      actorType: "SYSTEM",
      actorId: "hermes-profile-service",
      agentId: String(agentId),
      payload: { hermesProfileName: profileName, governanceStatus, disabledToolsets, errors, guardrailWarnings }
    });

    if (governanceStatus === "FAILED") {
      logger.error({ agentId, profileName, errors }, "Hermes governed profile provisioning failed closed");
    } else {
      logger.info({ agentId, profileName }, "Hermes governed profile provisioned and locked down");
    }

    return {
      agentId: String(agentId),
      hermesProfileName: profileName,
      governanceStatus,
      mcpRegistered,
      disabledToolsets,
      verifiedAt,
      errors,
      guardrailWarnings
    };
  }

  // ── Re-verification ───────────────────────────────────────────────────

  /**
   * Independently re-checks both governance invariants for an already
   * (or supposedly) provisioned agent — this is what diagnostics/health
   * endpoints should call, since provisioning-time success alone doesn't
   * prove the lockdown still holds (a toolset could be re-enabled, or
   * another MCP server added, out of band after provisioning). Never
   * throws for a governance failure — always returns a result with
   * governanceStatus: 'FAILED' and the reasons in `errors`, matching the
   * existing `/v1/agents/:id/test` route's "always 200, success flag in
   * the body" convention.
   */
  async verifyGovernance(tenantId: string, agentId: AgentId | string): Promise<VerifyGovernanceResult> {
    const verifiedAt = new Date();
    const errors: string[] = [];

    const row = await this.db
      .selectFrom("agents")
      .select(["hermes_profile_name"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", agentId as string)
      .executeTakeFirst();

    const profileName = row?.hermes_profile_name ?? null;
    if (!profileName) {
      return {
        agentId: String(agentId),
        hermesProfileName: null,
        governanceStatus: "PENDING",
        toolsetsLockedDown: false,
        enabledNativeToolsets: [],
        mcpRegistered: false,
        mcpServers: [],
        verifiedAt,
        errors: ["No Hermes profile has been provisioned for this agent yet."]
      };
    }

    let enabledNativeToolsets: string[] = [];
    let toolsetsLockedDown = false;
    try {
      const toolsResult = await this.runHermes(profileName, ["tools", "list"]);
      const parsed = this.parseToolsList(toolsResult.stdout);
      enabledNativeToolsets = GOVERNED_TOOLSETS_TO_DISABLE.filter((toolset) =>
        parsed.some((t) => t.name === toolset && t.enabled)
      );
      toolsetsLockedDown = enabledNativeToolsets.length === 0;
      if (!toolsetsLockedDown) {
        errors.push(`Native toolset(s) enabled: ${enabledNativeToolsets.join(", ")}`);
      }
    } catch (err: any) {
      errors.push(`Toolset re-verification failed: ${err?.message || err}`);
    }

    let mcpServers: string[] = [];
    let mcpRegistered = false;
    try {
      const listResult = await this.runHermes(profileName, ["mcp", "list"]);
      const servers = this.parseMcpList(listResult.stdout);
      mcpServers = servers.map((s) => s.name);
      const ours = servers.find((s) => s.name === CLOUDOPS_MCP_SERVER_NAME);
      const extras = servers.filter((s) => s.name !== CLOUDOPS_MCP_SERVER_NAME);
      if (extras.length > 0) {
        errors.push(`Unexpected MCP server(s) registered: ${extras.map((e) => e.name).join(", ")}`);
      }
      if (!ours || !ours.enabled) {
        errors.push(`CloudOps MCP server '${CLOUDOPS_MCP_SERVER_NAME}' is not registered/enabled.`);
      } else {
        mcpRegistered = extras.length === 0;
      }
    } catch (err: any) {
      errors.push(`MCP registration re-verification failed: ${err?.message || err}`);
    }

    const governanceStatus: AgentGovernanceStatus = toolsetsLockedDown && mcpRegistered ? "LOCKED_DOWN" : "FAILED";

    await this.persistGovernance(tenantId, agentId, {
      hermesProfileName: profileName,
      governanceStatus,
      governanceVerifiedAt: verifiedAt,
      mcpRegistered
    });

    return {
      agentId: String(agentId),
      hermesProfileName: profileName,
      governanceStatus,
      toolsetsLockedDown,
      enabledNativeToolsets,
      mcpRegistered,
      mcpServers,
      verifiedAt,
      errors
    };
  }

  // ── Teardown ──────────────────────────────────────────────────────────

  /**
   * Deletes an agent's Hermes profile on offboarding/revocation. Idempotent
   * and best-effort: a profile that's already gone (or was never
   * provisioned) is not an error. Callers should invoke this BEFORE
   * hard-deleting the agent row, since it needs hermes_profile_name to
   * still be readable.
   */
  async deprovisionProfile(tenantId: string, agentId: AgentId | string): Promise<DeprovisionGovernedProfileResult> {
    const row = await this.db
      .selectFrom("agents")
      .select(["hermes_profile_name"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", agentId as string)
      .executeTakeFirst();

    const profileName = row?.hermes_profile_name ?? null;
    if (!profileName) {
      return { agentId: String(agentId), hermesProfileName: null, deleted: false };
    }

    try {
      const exists = await this.profileExists(profileName);
      if (exists) {
        await this.runHermes(undefined, ["profile", "delete", profileName, "-y"]);
      }
      await recordAuditEvent({
        tenantId,
        eventType: "AGENT_GOVERNANCE_DEPROVISIONED",
        actorType: "SYSTEM",
        actorId: "hermes-profile-service",
        agentId: String(agentId),
        payload: { hermesProfileName: profileName }
      });
      return { agentId: String(agentId), hermesProfileName: profileName, deleted: true };
    } catch (err: any) {
      logger.warn({ agentId, profileName, err }, "Hermes profile deprovisioning failed (non-fatal)");
      return { agentId: String(agentId), hermesProfileName: profileName, deleted: false, error: err?.message || String(err) };
    }
  }

  private async persistGovernance(
    tenantId: string,
    agentId: AgentId | string,
    patch: {
      hermesProfileName: string | null;
      governanceStatus: AgentGovernanceStatus;
      governanceVerifiedAt: Date | null;
      mcpRegistered: boolean;
    }
  ): Promise<void> {
    await this.db
      .updateTable("agents")
      .set({
        hermes_profile_name: patch.hermesProfileName,
        governance_status: patch.governanceStatus,
        governance_verified_at: patch.governanceVerifiedAt,
        mcp_registered: patch.mcpRegistered,
        updated_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", agentId as string)
      .execute();
  }
}
