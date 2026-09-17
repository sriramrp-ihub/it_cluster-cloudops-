import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "node:net";

export interface DefenseClawGatewayInstance {
  port: number;
  baseUrl: string;
  evaluateUrl: string;
  auditEventsUrl: string;
  stop: () => Promise<void>;
  getAuditEvents: (traceId?: string) => Promise<any[]>;
}

export interface StartDefenseClawOptions {
  port?: number;
  binaryPath?: string;
  policyBundles?: string;
  connectors?: string;
  timeoutMs?: number;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 8080;
      srv.close((err) => {
        if (err) rej(err);
        else res(port);
      });
    });
  });
}

export async function startDefenseClawGateway(
  options: StartDefenseClawOptions = {}
): Promise<DefenseClawGatewayInstance> {
  const port = options.port || (await getAvailablePort());
  const binaryPath =
    options.binaryPath ||
    resolve(process.cwd(), "defence_claw/defenseclaw/defenseclaw-gateway");
  const policyBundles =
    options.policyBundles ||
    resolve(process.cwd(), "defence_claw/defenseclaw/policies/rego/cloudops");
  const connectors = options.connectors || "cloudops";
  const timeoutMs = options.timeoutMs || 10000;

  const args = [
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--policy-bundles",
    policyBundles,
    "--connectors",
    connectors
  ];

  const proc: ChildProcess = spawn(binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env }
  });

  proc.on("error", (err) => {
    console.error(`DefenseClaw Gateway process error:`, err);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const evaluateUrl = `${baseUrl}/v1/evaluate`;
  const auditEventsUrl = `${baseUrl}/v1/audit/events`;

  // Wait for health endpoint to return HTTP 200
  const startTime = Date.now();
  let healthy = false;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Retry after 100ms
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!healthy) {
    proc.kill("SIGKILL");
    throw new Error(
      `DefenseClaw Gateway failed to start and respond healthy within ${timeoutMs}ms on port ${port}`
    );
  }

  const stop = async (): Promise<void> => {
    if (proc.killed || proc.exitCode !== null) {
      return;
    }
    return new Promise((res) => {
      proc.once("close", () => res());
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill("SIGKILL");
        }
        res();
      }, 2000);
    });
  };

  const getAuditEvents = async (traceId?: string): Promise<any[]> => {
    const url = traceId ? `${auditEventsUrl}?trace_id=${encodeURIComponent(traceId)}` : auditEventsUrl;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch audit events: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    const events: any[] = Array.isArray(data) ? data : (data.events || []);
    if (traceId) {
      return events.filter((e: any) => e.trace_id === traceId || e.TraceID === traceId);
    }
    return events;
  };

  return {
    port,
    baseUrl,
    evaluateUrl,
    auditEventsUrl,
    stop,
    getAuditEvents
  };
}
