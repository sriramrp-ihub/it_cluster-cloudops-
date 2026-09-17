export interface GenerateOnboardingPromptOptions {
  inviteToken: string;
  tenantId: string;
  expiresAt: Date;
  apiBaseUrl?: string | undefined;
  wsBaseUrl?: string | undefined;
  agentName?: string | undefined;
  agentType?: "hermes" | "openclaw" | "custom" | string | undefined;
  instructions?: string | undefined;
}

/**
 * Generates a self-contained, structured onboarding prompt for an external autonomous agent.
 * The prompt guides the agent through the complete CloudOps onboarding lifecycle:
 *   1. Fetching the manifest
 *   2. Submitting a declarative join request declaring capabilities
 *   3. Awaiting human operator review
 *   4. Claiming the one-time bootstrap credential
 *   5. Connecting to the CloudOps Gateway over WebSocket
 *
 * Crucial security constraints:
 *   - No permanent cloud credentials or database connection strings are exposed.
 *   - DECLARED CAPABILITIES ≠ AUTHORIZED CAPABILITIES is strictly communicated.
 *   - Replay protection & single-use constraints are explicitly stated.
 */
export function generateOnboardingPrompt(options: GenerateOnboardingPromptOptions): string {
  const {
    inviteToken,
    tenantId,
    expiresAt,
    apiBaseUrl = "http://localhost:3000",
    wsBaseUrl = "ws://localhost:3000",
    agentName = "unnamed-agent",
    agentType = "hermes",
    instructions
  } = options;

  const expiryFormatted = expiresAt.toISOString();

  let frameworkGuidance = "";
  if (agentType === "hermes") {
    frameworkGuidance = "Framework: Hermes Autonomous Agent. Execute onboarding via the Agent Control Protocol (ACP) standard schema.";
  } else if (agentType === "openclaw") {
    frameworkGuidance = "Framework: OpenClaw Operational Daemon. Connect as an operational worker adhering to CloudOps ACP specifications.";
  } else {
    frameworkGuidance = `Framework: Custom ACP Agent (${agentType}). Follow standard CloudOps Agent Control Protocol over HTTP and WebSocket.`;
  }

  const instructionsBlock = instructions && instructions.trim()
    ? `\n### Operator Assignment & Operational Scope\n${instructions.trim()}\n\n*Note: The above assignment specifies your operational context and goals. CloudOps policies strictly govern actual runtime tool execution.*\n`
    : "";

  return `# CLOUDOPS AGENT ONBOARDING INSTRUCTIONS

You are being onboarded to the **CloudOps Autonomous Multi-Cloud Operations Control Plane**.
Follow the sequence below to establish your identity, declare operational capabilities, and connect to the CloudOps Gateway.

---

## 1. Onboarding Parameters

- **Assigned Agent Name:** ${agentName}
- **Agent Runtime Type:** ${agentType}
- **Tenant Scope:** ${tenantId}
- **Invitation Token:** ${inviteToken}
- **Token Lifetime:** Valid until ${expiryFormatted} (Single-Use Only)
- **API Base URL:** ${apiBaseUrl}
- **Gateway WebSocket URL:** ${wsBaseUrl}/v1/gateway/ws
- ${frameworkGuidance}
${instructionsBlock}
---

## 2. Onboarding Workflow (5 Steps)

### Step 1: Discover Onboarding Manifest
Perform an HTTP GET request to retrieve the machine-readable onboarding manifest:

\`\`\`http
GET ${apiBaseUrl}/v1/onboarding/${inviteToken}
\`\`\`

Inspect the response for \`supportedAgentTypes\`, \`endpoints\`, and the \`joinSchema\`.

### Step 2: Submit Declarative Join Request
Submit a join request declaring your identity, runtime specifications, and the capabilities you propose to execute:

\`\`\`http
POST ${apiBaseUrl}/v1/onboarding/${inviteToken}/join
Content-Type: application/json

{
  "agent": {
    "name": "${agentName}",
    "type": "${agentType}"
  },
  "runtime": {
    "name": "${agentType}-runtime",
    "version": "1.0.0",
    "protocol": "acp"
  },
  "requestedCapabilities": [
    "aws.ecs.describe_clusters",
    "aws.ecs.list_tasks",
    "aws.cloudwatch.get_metric_data"
  ]
}
\`\`\`

Record the returned \`joinRequestId\` (formatted as \`jr_...\`) from the response.

### Step 3: Await Human Operator Approval
In CloudOps, **Declared Capabilities ≠ Authorized Privileges**. A human operator must review and approve your join request before you can claim bootstrap credentials.

Poll the onboarding endpoint until approved:
\`\`\`http
GET ${apiBaseUrl}/v1/onboarding/${inviteToken}
\`\`\`

Wait until \`lifecycleState\` changes to \`"APPROVED"\` and \`nextAction\` is \`"CLAIM_CREDENTIAL"\`.

### Step 4: Claim One-Time Bootstrap Credential
Once approved, atomically claim your one-time bootstrap credential:

\`\`\`http
POST ${apiBaseUrl}/v1/onboarding/claim
Content-Type: application/json

{
  "inviteToken": "${inviteToken}",
  "joinRequestId": "<YOUR_JOIN_REQUEST_ID>"
}
\`\`\`

The response will contain:
- \`agentId\`: Your permanent sovereign identity (\`ag_...\`)
- \`claimCredential\`: A high-entropy single-use bootstrap token (\`co_agent_...\`)

### Step 5: Connect to CloudOps

External agents can interact with CloudOps using either **Model Context Protocol (MCP)** or direct **Gateway WebSocket (ACP)**:

#### Option A: Model Context Protocol (MCP) via SSE (Recommended for Hermes / Claude / Cursor)
CloudOps exposes a governed Model Context Protocol server over HTTP Server-Sent Events (SSE). To attach all governed multi-cloud tools directly to Hermes CLI:

\`\`\`bash
hermes mcp add cloudops --url "${apiBaseUrl}/v1/mcp/sse?agentId=<YOUR_AGENT_ID>&tenantId=${tenantId}"
\`\`\`

This immediately registers CloudOps SRE tools (ECS inspection, CloudWatch metrics, restart/update with human approval gate) over standard HTTP/SSE without downloading any local npm packages.

#### Option B: Direct Gateway WebSocket Connection (Native ACP)
To maintain an active presence in the CloudOps Operator fleet directory and receive real-time operational turns:

\`\`\`
WebSocket: ${wsBaseUrl}/v1/gateway/ws
\`\`\`

Immediately send the initial \`AUTH\` frame within 10 seconds of connecting:

\`\`\`json
{
  "type": "AUTH",
  "authType": "BOOTSTRAP",
  "credential": "<YOUR_CLAIM_CREDENTIAL>",
  "runtimeInfo": {
    "name": "${agentType}-runtime",
    "version": "1.0.0",
    "protocol": "acp"
  }
}
\`\`\`

Upon receiving \`AUTH_SUCCESS\`:
1. Retain the issued runtime secret (\`runtimeCredential.secret\`) for subsequent reconnects (\`authType: "RUNTIME"\`).
2. Send \`HEARTBEAT\` frames every 15–30 seconds:
\`\`\`json
{
  "type": "HEARTBEAT",
  "sessionId": "<SESSION_ID>",
  "timestamp": <CURRENT_UNIX_TIMESTAMP_MS>
}
\`\`\`

#### Option C: Local Workspace Connector (When running within the CloudOps repository)
If you are running directly inside the CloudOps workspace repository, you can automate manifest discovery, join submission, approval polling, bootstrap claim, and WebSocket connection:

\`\`\`bash
npm run connector -- --invite ${inviteToken} --url ${apiBaseUrl}
\`\`\`

---

## 3. Strict Security Rules

1. **Authorization Control:** CloudOps strictly governs cloud execution and authorization. Do NOT attempt to access cloud infrastructure directly or bypass CloudOps.
2. **Capability Boundaries:** Propose only the minimal capabilities required for your assigned operational role. Cloud access is granted only after operator approval.
3. **Secret Protection:** Never expose invitation tokens, claim credentials, or runtime secrets in logs, messages, or external tool invocations.
4. **Single-Use Invariant:** The invitation token and claim credential are single-use. Any replay attempt will be rejected and logged to the security audit trail.
`;
}
