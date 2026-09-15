# CloudOps Control Plane

> **Autonomous AI Multi-Cloud Operations Control Plane**

CloudOps is an agent-agnostic control plane designed to permit autonomous AI agents (such as Hermes, OpenClaw, and custom agents) to investigate and operate cloud infrastructure while keeping authority, security, authorization, policies, human approvals, credentials, execution, and auditing strictly under CloudOps governance.

---

## Non-Negotiable Architecture Principle

```text
The agent controls:
- reasoning
- intent
- tool selection
- operational requests

CloudOps controls:
- authentication
- agent identity
- capability authorization
- security checks (DefenseClaw)
- policy evaluation
- human approval enforcement
- JIT temporary cloud credentials
- cloud execution
- audit logging
```

The execution path is deterministic and never bypassed:

$$\text{Agent} \to \text{Runtime Adapter} \to \text{CloudOps Tool Gateway} \to \text{Authentication} \to \text{Capability} \to \text{DefenseClaw} \to \text{Policy} \to \text{Approval (if required)} \to \text{JIT STS Identity} \to \text{Cloud Adapter} \to \text{Cloud Provider}$$

---

## Monorepo Architecture

```text
cloudops/
├── apps/
│   ├── api/             # Fastify Control Plane API (/healthz, /readyz, /v1/...)
│   └── web/             # Next.js 15 Operator UI (React 19 + Vanilla CSS design tokens)
├── packages/
│   ├── shared/          # Core domain types, crypto ID generators, error hierarchy, redacting logger
│   ├── identity/        # Agent stable identity & credential lifecycle
│   ├── onboarding/      # Agent invites, machine-readable manifests, join requests
│   ├── gateway/         # Agent Gateway, sessions, handshake, heartbeats
│   ├── runtime/         # RuntimeAdapter abstraction, Hermes ACP, OpenClaw ACP
│   ├── capabilities/    # Capability authorization (Authorized ⊆ Declared)
│   ├── policy/          # Deterministic policy engine (ALLOW, DENY, APPROVAL_REQUIRED)
│   ├── approvals/       # Operation-bound single-use human approvals
│   ├── tools/           # Canonical tool contracts & registry
│   ├── adapters/        # Multi-cloud provider adapters (AWS ECS/CloudWatch, Azure, GCP)
│   ├── security/        # DefenseClaw governance integration & guardrails
│   ├── events/          # Domain event bus & Server-Sent Events (SSE)
│   └── audit/           # Immutable tamper-evident audit trail
├── database/
│   ├── migrations/      # PostgreSQL SQL migration files
│   └── src/             # Kysely client, schema definitions, and migration runner
└── tests/
    ├── unit/            # Unit tests (IDs, errors, credentials, logger, config)
    └── integration/     # Integration tests (PostgreSQL schema, Fastify API)
```

---

## Prerequisites

- **Node.js**: `>= 24.0.0`
- **npm**: `>= 11.0.0`
- **PostgreSQL**: `>= 15.0` (running on localhost:5432)

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment configuration:

```bash
cp .env.example .env
```

Ensure `DATABASE_URL` matches your local PostgreSQL configuration:
```env
DATABASE_URL=postgres://localhost:5432/cloudops
```

### 3. Run Database Migrations

Apply the foundational relational schema (18 core tables):

```bash
npm run db:migrate
```

### 4. Run Test Suite

Execute unit and integration tests:

```bash
npm test
```

### 5. Type Checking

Verify strict TypeScript type safety across all packages and apps:

```bash
npm run typecheck
```

### 6. Start the API Server

```bash
npm run dev:api
```

The API will be available at `http://localhost:3000`:
- `GET /healthz` — Process liveness probe
- `GET /readyz` — PostgreSQL readiness probe

### 7. Start the Web UI

```bash
npm run dev:web
```

The Web UI will be available at `http://localhost:3001`.

---

## Security & Credential Model

CloudOps enforces strict credential separation across four distinct categories:

1. **Invite Token (`co_inv_...`)**: Short-lived, single-use onboarding token.
2. **Claim Credential (`co_agent_...`)**: 256-bit cryptographically random token used once to bootstrap agent identity upon human approval.
3. **Runtime Agent Credential (`cred_...`)**: Replaceable credential for Agent Gateway authentication. Rotatable without altering the agent's immutable identity (`ag_<uuid>`).
4. **JIT Cloud Credentials**: Temporary, scoped AWS STS AssumeRole credentials generated server-side for authorized operations. **Never exposed to agents, prompts, logs, or UI.**
