# CloudOps — Technical Reference

## Autonomous Multi-Cloud Operations Control Plane

**Purpose:** Define the technical architecture, responsibilities, boundaries, interfaces, contracts, security controls, data flows, and component interactions for CloudOps.

**Status:** Architecture / Engineering Reference

---

# 1. System Purpose

CloudOps is an autonomous multi-cloud operations control plane.

It provides a controlled execution boundary between autonomous agents and cloud infrastructure. Agents are responsible for reasoning, planning, investigation, and selecting the next operation. CloudOps is responsible for identity, authorization, security enforcement, policy evaluation, approvals, credential isolation, cloud execution, normalization, and audit.

The core principle is:

```text
Agent decides WHAT should be done.
CloudOps decides WHETHER and HOW it may be done.
Cloud provider executes the authorized operation.
```

CloudOps must prevent an autonomous agent from obtaining unrestricted or permanent cloud authority.

---

# 2. Architectural Scope

CloudOps contains the following major areas:

```text
1. Cloud Environments
2. Cloud Sync / Discovery Layer
3. Normalized Cloud State
4. Agent Onboarding Layer
5. Agent / Runtime Layer
6. CloudOps Runtime Layer
7. CloudOps Execution Gateway
8. Agent Authentication
9. Capability Authorization
10. DefenseClaw Security / Guardrails
11. Deterministic Policy Engine
12. Human Approval
13. Credential / Identity Broker
14. JIT Cloud Identity
15. Cloud Adapter Layer
16. Controlled Tool Execution
17. Audit / Event Records
18. Response / State Flow
```

---

# 3. High-Level Architecture

```text
                                      CLOUDOPS
                 AUTONOMOUS MULTI-CLOUD OPERATIONS CONTROL PLANE

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                              CLOUD ENVIRONMENTS                                               │
│                                                                                              │
│          ┌─────────────┐        ┌─────────────┐        ┌─────────────┐                     │
│          │     AWS     │        │    Azure    │        │     GCP     │       ...           │
│          └──────┬──────┘        └──────┬──────┘        └──────┬──────┘                     │
│                 │                      │                      │                            │
│                 └──────────────────────┼──────────────────────┘                            │
│                                        │                                                     │
│                         Cloud APIs / SDKs / Events / Telemetry                              │
│                                        │                                                     │
│                                        ▼                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           CLOUD SYNC / DISCOVERY LAYER                                  │   │
│  │                                                                                       │   │
│  │   Resource Discovery    Inventory Sync    Health / State    Events / Telemetry        │   │
│  │                                        │                                              │   │
│  │                                        ▼                                              │   │
│  │                              NORMALIZED CLOUD STATE                                    │   │
│  │                       Resources • Services • Config • Health                          │   │
│  └────────────────────────────────────────┬──────────────────────────────────────────────┘   │
│                                           │                                                  │
│                                           ▼                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              AGENT ONBOARDING LAYER                                    │   │
│  │                                                                                       │   │
│  │ Invite → Manifest → Join Request → Human Approval → One-Time Credential Claim        │   │
│  │                                                                                       │   │
│  │                 Agent Identity • Lifecycle • Declared Capabilities                    │   │
│  └──────────────────────────────────────┬────────────────────────────────────────────────┘   │
│                                         │                                                    │
│                                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              AGENT / RUNTIME LAYER                                     │   │
│  │                                                                                       │   │
│  │       ┌─────────────────┐       ┌─────────────────┐                                  │   │
│  │       │     Hermes      │       │    OpenClaw     │                                  │   │
│  │       │                 │       │                 │                                  │   │
│  │       │  Reasoning      │       │  Reasoning      │                                  │   │
│  │       │  Planning       │       │  Planning       │                                  │   │
│  │       │  Tool Selection │       │  Tool Selection │                                  │   │
│  │       └────────┬────────┘       └────────┬────────┘                                  │   │
│  │                │                         │                                             │   │
│  │                │ ACP                     │ ACP                                         │   │
│  │                ▼                         ▼                                             │   │
│  │       ┌─────────────────┐       ┌─────────────────┐                                  │   │
│  │       │ Hermes Adapter  │       │ OpenClaw Adapter│                                  │   │
│  │       │ ACP / Process   │       │ ACP / Gateway   │                                  │   │
│  │       │ Manager         │       │ Bridge          │                                  │   │
│  │       └────────┬────────┘       └────────┬────────┘                                  │   │
│  │                └────────────┬────────────┘                                           │   │
│  │                             ▼                                                          │   │
│  │                 ┌─────────────────────────┐                                            │   │
│  │                 │ CloudOps Runtime Layer  │                                            │   │
│  │                 │ Identity • Session      │                                            │   │
│  │                 │ Health • Lifecycle      │                                            │   │
│  │                 │ Tool Execution           │                                            │   │
│  │                 └────────────┬────────────┘                                            │   │
│  └──────────────────────────────┼────────────────────────────────────────────────────────┘   │
│                                 │                                                            │
│                                 │ Intent / Tool Request                                     │
│                                 ▼                                                            │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         CLOUDOPS EXECUTION GATEWAY                                     │   │
│  │                                                                                       │   │
│  │ Tool Request → Authentication → Capability → DefenseClaw → Policy                    │   │
│  │                                      │                                                │   │
│  │                         ┌────────────┼────────────┐                                   │   │
│  │                         │            │            │                                   │   │
│  │                       DENY         ALLOW     APPROVAL_REQUIRED                        │   │
│  │                                      │            │                                   │   │
│  │                                      │      Human Approval                           │   │
│  │                                      │            │                                   │   │
│  │                                      └─────┬──────┘                                   │   │
│  │                                            ▼                                          │   │
│  │                                Credential / Identity Broker                           │   │
│  │                                            │                                          │   │
│  │                                            ▼                                          │   │
│  │                                   JIT Cloud Identity                                  │   │
│  │                                            │                                          │   │
│  │                                            ▼                                          │   │
│  │                                    Controlled Tool                                    │   │
│  │                                      Execution                                         │   │
│  │                                            │                                          │   │
│  │                                            ▼                                          │   │
│  │                                      Audit / Log                                       │   │
│  └────────────────────────────────────┬──────────────────────────────────────────────────┘   │
│                                       │                                                      │
│                                       ▼                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              CLOUD ADAPTER LAYER                                       │   │
│  │                                                                                       │   │
│  │        ┌─────────────┐        ┌─────────────┐        ┌─────────────┐                 │   │
│  │        │ AWS Adapter │        │Azure Adapter│        │ GCP Adapter │       ...       │   │
│  │        └──────┬──────┘        └──────┬──────┘        └──────┬──────┘                 │   │
│  └───────────────┼──────────────────────┼──────────────────────┼────────────────────────┘   │
│                  │                      │                      │                            │
│                  └──────────────────────┼──────────────────────┘                            │
│                                         ▼                                                   │
│                              CLOUD INFRASTRUCTURE                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# 4. Component Responsibility Model

| Component | Primary Responsibility | Must Not Own |
|---|---|---|
| Cloud Environment | Actual cloud resources and provider APIs | Agent authorization |
| Cloud Discovery | Discover resources and state | Agent decisions |
| Normalized Cloud State | Common representation of cloud state | Cloud credentials |
| Agent Onboarding | Establish trusted agent membership | Cloud execution |
| Agent Runtime | Reasoning, planning, tool selection | Permanent cloud credentials |
| Runtime Adapter | Translate agent/runtime protocol into CloudOps contract | Cloud policy decisions |
| Runtime Layer | Stable runtime lifecycle/session abstraction | Provider-specific execution |
| Execution Gateway | Central execution control point | Agent reasoning |
| Authentication | Verify agent identity/credential | Tool authorization |
| Capability Authorization | Verify declared/authorized capabilities | Policy semantics |
| DefenseClaw | Security and guardrail enforcement | Agent reasoning |
| Policy Engine | Deterministic ALLOW/DENY/APPROVAL decision | Cloud API implementation |
| Approval Service | Human approval for gated operations | Autonomous approval |
| Credential Broker | Obtain execution identity | Agent reasoning |
| JIT Identity | Temporary cloud authority | Permanent agent identity |
| Cloud Adapter | Provider-specific API execution | Agent authorization |
| Audit | Record security/execution events | Secret storage |

---

# 5. Cloud Environment Layer

## Responsibility

The cloud environment is the external infrastructure controlled by CloudOps.

Supported environments include:

```text
AWS
Azure
GCP
Other cloud providers
```

Each provider exposes its own APIs, SDKs, events, telemetry, identity systems, and resource models.

CloudOps must not expose provider-specific differences to autonomous agents wherever a normalized CloudOps contract is sufficient.

## Interface to CloudOps

```text
Cloud Provider
      │
      ├── Provider APIs
      ├── SDKs
      ├── Events
      └── Telemetry
      │
      ▼
Cloud Adapter / Discovery Adapter
```

## Boundary

Cloud provider credentials must remain on the CloudOps execution side of the trust boundary.

---

# 6. Cloud Sync / Discovery Layer

The discovery layer establishes CloudOps' view of the customer's cloud estate.

It contains:

```text
Resource Discovery
Inventory Synchronization
Health / State Collection
Events / Telemetry
Normalization
```

## 6.1 Resource Discovery

Discovers resources such as:

```text
Compute
Containers
Storage
Databases
Networking
Monitoring resources
IAM-related resources
```

Provider-specific discovery is implemented by provider adapters.

## Contract

Input:

```text
Provider / Account / Subscription / Project
Discovery scope
Credential context
```

Output:

```text
Normalized Resource
```

Conceptual schema:

```json
{
  "resource_id": "provider-resource-id",
  "provider": "aws",
  "resource_type": "container_service",
  "name": "example-service",
  "region": "us-east-1",
  "status": "healthy",
  "metadata": {}
}
```

---

# 7. Inventory Sync

Inventory synchronization keeps the normalized cloud state current.

Responsibilities:

```text
Discover new resources
Detect deleted resources
Detect configuration changes
Update health/state
Maintain provider-to-normalized mappings
```

The sync process must be idempotent.

```text
Same provider state
       ↓
Repeated sync
       ↓
Same normalized state
```

---

# 8. Health / State

Health/state collection provides operational information that agents can use during investigation.

Examples:

```text
Service health
Desired vs running count
Instance/task status
Database health
Load balancer health
Recent state changes
```

This information should be normalized before being supplied to the agent.

---

# 9. Events / Telemetry

CloudOps can consume provider events and telemetry to maintain operational context.

Examples:

```text
CloudWatch events/logs
Azure monitoring events
GCP telemetry
Resource state changes
Operational alerts
```

Events are not automatically execution instructions.

They become context that may trigger investigation or an agent workflow.

---

# 10. Normalized Cloud State

The normalized state is the CloudOps representation of cloud infrastructure independent of provider-specific API shapes.

Conceptual model:

```text
Provider Resource
      ↓
Provider Adapter
      ↓
Normalization
      ↓
Normalized Cloud State
```

The normalized state can contain:

```text
Resource identity
Provider
Resource type
Region/location
Lifecycle state
Health
Configuration summary
Relationships
Telemetry references
Last observed time
```

## Contract

Discovery adapters produce normalized state.

Agents consume normalized state.

CloudOps execution does not assume that the agent understands provider-specific response formats.

---

# 11. Agent Onboarding Layer

The onboarding layer establishes a trusted relationship between CloudOps and an autonomous agent.

The onboarding sequence is:

```text
Invite
  ↓
Machine-readable manifest
  ↓
Join request
  ↓
Human approval
  ↓
One-time credential claim
  ↓
Stable agent identity
  ↓
Runtime registration
  ↓
Gateway session
```

---

# 12. Invite Token

The invite token creates a temporary onboarding context.

Example:

```text
co_inv_<random>
```

Properties:

```text
Cryptographically random
Temporary
Scoped to onboarding
Expires
Can be revoked
Cannot be reused after consumption
```

The invite token is not a runtime credential.

---

# 13. Machine-Readable Onboarding Manifest

The manifest is the machine-readable contract an agent reads before attempting onboarding.

It should expose:

```text
Agent onboarding information
Agent identity requirements
Declared capability format
Join request schema
Claim credential contract
Gateway registration contract
Handshake contract
Lifecycle state
Next action
Security restrictions
```

The agent must use the contract rather than guess endpoint names or payload shapes.

---

# 14. Join Request

The join request declares the agent's intended identity and capabilities.

Conceptual contract:

```json
{
  "agent_name": "example-agent",
  "agent_type": "hermes",
  "agent_version": "1.0.0",
  "gateway_protocol": "acp",
  "endpoint": "runtime-endpoint",
  "declared_capabilities": [
    "ecs:DescribeServices",
    "ecs:ListClusters"
  ]
}
```

The join request is declarative.

It does not itself:

```text
Grant cloud authority
Issue cloud credentials
Execute tools
Approve the agent
```

---

# 15. Human Approval

Human approval is the trust transition between:

```text
Agent claims membership
```

and:

```text
CloudOps authorizes membership
```

The operator can:

```text
Approve
Reject
```

The approval result must be attributable to an operator identity.

Concurrent approval/rejection must be atomic so only one terminal decision wins.

---

# 16. One-Time Credential Claim

After approval, CloudOps generates a one-time claim credential.

```text
co_agent_<random>
```

Properties:

```text
256-bit random value
Returned once
Stored as hash
Single-use
Bound to onboarding/agent context
Consumed atomically
```

Lifecycle:

```text
AVAILABLE
   ↓
CLAIMED
   ↓
CONSUMED
```

The claim credential is not rotated.

It is a bootstrap secret.

---

# 17. Stable Agent Identity

After successful claim:

```text
ag_<uuid>
```

is the stable identity of the agent.

The identity remains constant across:

```text
Credential rotation
Runtime reconnect
Gateway reconnect
Process restart
Session replacement
```

This is essential for audit continuity.

---

# 18. Agent / Runtime Layer

CloudOps supports autonomous runtimes through agent-specific adapters.

Current runtime examples:

```text
Hermes
OpenClaw
```

The architecture is:

```text
Agent Runtime
     │
     │ Runtime protocol
     ▼
Agent-specific Adapter
     │
     ▼
CloudOps Runtime Interface
     │
     ▼
CloudOps Execution Gateway
```

For the current runtimes:

```text
Hermes
  │
  │ ACP
  ▼
Hermes Adapter
```

and:

```text
OpenClaw
  │
  │ ACP
  ▼
OpenClaw Adapter
```

The adapters isolate runtime-specific behavior from the CloudOps core.

---

# 19. Hermes Adapter

The Hermes adapter is responsible for integrating Hermes into CloudOps without modifying Hermes itself.

Responsibilities:

```text
Start/manage Hermes process when required
Communicate using ACP
Translate runtime/task requests
Translate tool requests/results
Maintain CloudOps runtime identity
Manage lifecycle
Connect Hermes to the CloudOps Gateway
```

The adapter must not bypass:

```text
Authentication
Capability authorization
DefenseClaw
Policy
Approval
Credential controls
Audit
```

---

# 20. OpenClaw Adapter

The OpenClaw adapter provides the equivalent CloudOps integration boundary for OpenClaw.

The adapter handles OpenClaw-specific runtime communication and maps it to the same CloudOps Runtime Interface.

Conceptually:

```text
OpenClaw
   │
   │ ACP
   ▼
OpenClaw Adapter
   │
   ▼
CloudOps Runtime Interface
```

OpenClaw-specific gateway/bridge behavior remains isolated inside the adapter.

---

# 21. CloudOps Runtime Layer

The Runtime Layer provides a runtime-neutral contract.

It contains:

```text
Identity
Session
Health
Lifecycle
Tool Execution
```

## Runtime Adapter Contract

Every runtime adapter must implement the conceptual operations:

```text
Identity()
State()
Start()
Stop()
Health()
Session()
ExecuteTool()
```

The CloudOps core should not need to know whether the runtime is Hermes, OpenClaw, or another compatible agent.

---

# 22. Runtime Identity Contract

Runtime identity represents the CloudOps identity of the connected agent.

Conceptual fields:

```text
AgentID
AgentType
AgentVersion
RuntimeProtocol
Status
```

Example:

```json
{
  "agent_id": "ag_123",
  "agent_type": "hermes",
  "agent_version": "0.18.2",
  "runtime_protocol": "acp",
  "status": "CONNECTED"
}
```

---

# 23. Runtime Session Contract

A runtime session represents a current connection between an agent runtime and CloudOps.

Conceptual states:

```text
REGISTERING
CHALLENGE_ISSUED
CONNECTED
DISCONNECTED
```

A session is not the same as an agent identity.

```text
Agent Identity
      │
      ├── Session 1
      ├── Session 2
      └── Session 3
```

The stable agent identity survives session replacement.

---

# 24. Runtime Health Contract

The runtime layer provides health information such as:

```text
Connected/disconnected
Last heartbeat
Runtime process health
Gateway connectivity
Session status
```

Health status does not grant execution authority.

---

# 25. Runtime Lifecycle

Runtime lifecycle controls:

```text
Register
Start
Connect
Heartbeat
Disconnect
Reconnect
Stop
```

A disconnected runtime must not automatically retain an active gateway session indefinitely.

---

# 26. CloudOps Execution Gateway

The Execution Gateway is the central security and execution boundary.

Every agent-generated cloud operation must pass through it.

```text
Agent
  ↓
Runtime Adapter
  ↓
Runtime Layer
  ↓
Execution Gateway
```

The gateway performs:

```text
Authentication
Capability authorization
DefenseClaw enforcement
Policy evaluation
Approval handling
Credential acquisition
Tool execution
Audit
```

No agent should directly call cloud-provider APIs.

---

# 27. Tool Request Contract

A canonical tool request should contain:

```text
Agent identity/session context
Tool name
Arguments
Request ID
Correlation information
Optional approval context
```

Conceptual request:

```json
{
  "request_id": "req_123",
  "tool": "aws.ecs.describe_service",
  "arguments": {
    "cluster": "cloudops-test",
    "service": "starvision-motors"
  }
}
```

The agent supplies intent.

CloudOps determines whether and how that intent may execute.

---

# 28. Authentication

Authentication answers:

> Which registered agent is making this request?

The gateway verifies:

```text
Credential exists
Credential hash matches
Credential is active
Credential has not expired
Credential is bound to the agent
Agent is not revoked/suspended
Session is valid when required
```

Authentication does not itself mean the operation is authorized.

---

# 29. Capability Authorization

Capability authorization answers:

> Is this agent authorized to request this category of operation?

Example mappings:

```text
aws.ecs.list_clusters
        ↓
ecs:ListClusters

aws.ecs.list_services
        ↓
ecs:ListServices

aws.ecs.describe_service
        ↓
ecs:DescribeServices

aws.cloudwatch.filter_logs
        ↓
cloudwatch:FilterLogEvents
```

The authorization model separates:

```text
Declared capability
        ↓
Authorized capability
        ↓
Tool-level permission
```

An agent cannot execute a tool solely because it declared the capability.

---

# 30. Capability Contract

A capability profile contains:

```text
Agent ID
Declared capabilities
Authorized capabilities
Status
Operator attribution
Created/updated timestamps
```

A fundamental invariant is:

```text
Authorized Capabilities ⊆ Declared Capabilities
```

An unauthorized capability must be rejected before policy evaluation.

This prevents an agent from using policy evaluation to obtain authority it was never granted.

---

# 31. DefenseClaw Security Layer

DefenseClaw provides the security and guardrail enforcement layer.

It operates after agent authentication/capability validation and before execution.

Conceptually:

```text
Tool Request
    ↓
Authentication
    ↓
Capability
    ↓
DefenseClaw
    ↓
Policy
    ↓
Execution
```

DefenseClaw may evaluate security conditions such as:

```text
Dangerous operation
Resource sensitivity
Blast radius
Environment restrictions
Security posture
Anomalous behavior
Execution context
Required controls
```

DefenseClaw must be deterministic or policy-driven at the enforcement boundary.

The autonomous model cannot override a DefenseClaw decision.

---

# 32. Deterministic Policy Engine

The policy engine answers:

> Given the authenticated agent, capability, requested tool, target, context, and security controls, what should happen?

Allowed decisions:

```text
ALLOW
DENY
APPROVAL_REQUIRED
```

Example:

```text
Read ECS service
    ↓
ALLOW

Delete production resource
    ↓
APPROVAL_REQUIRED

Unauthorized capability
    ↓
DENY
```

The model must not decide the final authorization result.

---

# 33. Policy Evaluation Contract

Input:

```text
Agent ID
Tool
Arguments / normalized target
Authorized capability
Environment
Resource context
DefenseClaw result
Approval context
```

Output:

```json
{
  "decision": "ALLOW",
  "reason": "policy-rule-match",
  "rule_id": "rule-123"
}
```

Possible values:

```text
ALLOW
DENY
APPROVAL_REQUIRED
```

---

# 34. Human Approval

If policy returns:

```text
APPROVAL_REQUIRED
```

the operation becomes an approval-bound request.

The approval must be:

```text
Specific to the operation
Bound to a canonical request representation
Attributed to an operator
Single-use
Time bounded
Consumed atomically
```

A different operation must not be executable using an approval for another operation.

---

# 35. Approval Binding

A secure approval should be bound to a canonical operation hash.

Conceptually:

```text
Canonical Operation
        ↓
SHA-256
        ↓
Approval Hash
```

The approval is valid only if:

```text
request_hash == approved_operation_hash
```

Therefore:

```text
Approved:
restart service A

Cannot authorize:
delete service A
```

even if both requests originate from the same agent.

---

# 36. Approval Lifecycle

```text
PENDING
   │
   ├── APPROVED
   │      ↓
   │   CONSUMED
   │
   ├── REJECTED
   │
   └── EXPIRED
```

Approval consumption must be single-use.

Concurrent consumption must result in exactly one successful consumer.

---

# 37. Credential / Identity Broker

The Credential / Identity Broker creates the cloud execution identity required by an approved operation.

It separates:

```text
Agent authentication identity
```

from:

```text
Cloud execution identity
```

The agent does not become the cloud principal.

---

# 38. JIT Cloud Identity

JIT means **Just-In-Time**.

CloudOps obtains temporary cloud credentials only when execution requires them.

Conceptual flow:

```text
Authorized request
       ↓
Credential Broker
       ↓
Cloud IAM / STS
       ↓
Temporary scoped credentials
       ↓
Cloud API operation
       ↓
Credential expires
```

For AWS, this can use:

```text
AWS STS AssumeRole
```

The resulting credentials are temporary and scoped.

---

# 39. Credential Separation Model

CloudOps uses four distinct credential concepts:

```text
1. Invite Token
2. One-Time Claim Credential
3. Runtime Agent Credential
4. JIT Cloud Credential
```

They must not be treated as interchangeable.

```text
Invite Token
    ↓
Onboarding only

Claim Credential
    ↓
One-time identity bootstrap

Runtime Credential
    ↓
CloudOps Gateway authentication

JIT Cloud Credential
    ↓
Actual cloud API authority
```

---

# 40. Runtime Credential Rotation

Runtime credentials are replaceable authentication material.

The stable identity remains:

```text
ag_123456
```

while credentials can change:

```text
cred_v1
   ↓
cred_v2
   ↓
cred_v3
```

Recommended lifecycle:

```text
ACTIVE
  ↓
GRACE_PERIOD
  ↓
REVOKED
```

Rotation must not create a new agent identity.

---

# 41. Runtime Credential Storage

CloudOps should store metadata such as:

```text
agent_id
credential_id
credential_hash
status
created_at
expires_at
last_used_at
```

CloudOps should not persist the raw runtime credential.

Secrets must not appear in:

```text
Logs
Metrics
Audit payloads
Error messages
Tracing attributes
Exception dumps
```

---

# 42. JIT Credential Lifecycle

JIT cloud credentials are shorter-lived than runtime credentials.

```text
Request
   ↓
Authorization
   ↓
JIT issuance
   ↓
Cloud operation
   ↓
Expiration
```

The agent should not receive the raw cloud credential.

The credential remains inside the controlled execution boundary.

---

# 43. Cloud Adapter Layer

Cloud adapters translate the canonical CloudOps execution request into provider-specific API calls.

Current examples:

```text
AWS Adapter
Azure Adapter
GCP Adapter
Other Provider Adapter
```

The adapter owns:

```text
Provider SDK/API interaction
Provider request construction
Provider response parsing
Provider error normalization
Provider-specific resource identifiers
```

The adapter does not own:

```text
Agent authentication
Agent capability authorization
Human approval
Global policy
Agent credential lifecycle
```

---

# 44. AWS Adapter

Example tool:

```text
aws.ecs.describe_service
```

CloudOps canonical request:

```json
{
  "tool": "aws.ecs.describe_service",
  "arguments": {
    "cluster": "cloudops-test",
    "service": "starvision-motors"
  }
}
```

The AWS adapter converts that into the AWS ECS API operation.

The adapter receives cloud execution credentials from the controlled credential context.

---

# 45. Cloud Adapter Contract

Input:

```text
Canonical ToolRequest
Execution Identity
Provider context
```

Output:

```text
Canonical ToolResponse
```

The adapter must not return provider-specific secret material.

---

# 46. Canonical Tool Response

Conceptual response:

```json
{
  "request_id": "req_123",
  "status": "SUCCEEDED",
  "data": {
    "service": "starvision-motors",
    "desired_count": 1,
    "running_count": 1,
    "status": "ACTIVE"
  },
  "error": null
}
```

Errors should be normalized where possible.

Example:

```text
Provider API error
       ↓
Cloud Adapter
       ↓
Normalized CloudOps error
       ↓
Execution Gateway
       ↓
Runtime Adapter
       ↓
Agent
```

---

# 47. Controlled Tool Execution

Controlled execution is the point where an approved and authorized request becomes a cloud operation.

Execution must receive:

```text
Validated tool
Validated arguments
Authenticated agent
Authorized capability
DefenseClaw approval
Policy decision
Approval context when required
JIT execution identity
```

No execution should occur before these prerequisites are satisfied.

---

# 48. Execution Ordering

The security ordering is:

```text
1. Authenticate Agent
          ↓
2. Validate Agent State
          ↓
3. Check Capability
          ↓
4. DefenseClaw Security Checks
          ↓
5. Evaluate Deterministic Policy
          ↓
6. Resolve Human Approval if required
          ↓
7. Acquire JIT Cloud Identity
          ↓
8. Execute Provider Operation
          ↓
9. Normalize Result
          ↓
10. Audit
          ↓
11. Return Result
```

This ordering is a critical system invariant.

---

# 49. Audit / Event Layer

Every security-sensitive and execution-sensitive action should produce an auditable event.

Examples:

```text
AGENT_INVITED
AGENT_JOIN_REQUESTED
AGENT_APPROVED
AGENT_REJECTED
CLAIM_CREDENTIAL_ISSUED
CLAIM_CREDENTIAL_CONSUMED
AGENT_REGISTERED
AGENT_CONNECTED
AGENT_DISCONNECTED
RUNTIME_CREDENTIAL_CREATED
RUNTIME_CREDENTIAL_ROTATED
RUNTIME_CREDENTIAL_REVOKED
TOOL_REQUESTED
CAPABILITY_DENIED
DEFENSECLAW_DENIED
POLICY_DENIED
APPROVAL_REQUESTED
APPROVAL_GRANTED
APPROVAL_REJECTED
JIT_CREDENTIAL_ISSUED
CLOUD_OPERATION_EXECUTED
CLOUD_OPERATION_FAILED
JIT_CREDENTIAL_EXPIRED
```

Audit records must never contain raw secrets.

---

# 50. End-to-End Tool Execution Flow

Example:

```text
Hermes
   │
   │ ACP
   ▼
Hermes Adapter
   │
   ▼
CloudOps Runtime
   │
   │ ToolRequest
   ▼
Execution Gateway
   │
   ▼
Authentication
   │
   ▼
Capability Authorization
   │
   ▼
DefenseClaw
   │
   ▼
Policy Engine
   │
   ├──────────── DENY ────────────► Agent
   │
   ├──────────── APPROVAL_REQUIRED
   │                         │
   │                         ▼
   │                   Human Approval
   │                         │
   │                         ▼
   └─────────────────────────┘
             │
             ▼
     Credential Broker
             │
             ▼
       AWS STS / IAM
             │
             ▼
      Temporary Identity
             │
             ▼
        AWS Adapter
             │
             ▼
       AWS API / Service
             │
             ▼
        Cloud Result
             │
             ▼
        Normalization
             │
             ├──────────────► Audit
             │
             ▼
      Execution Gateway
             │
             ▼
      Runtime Adapter
             │
             │ ACP
             ▼
           Hermes
             │
             ▼
    Reasoning / Next Action
```

---

# 51. Response / State Flow

The return path is equally important.

```text
Cloud Infrastructure
        │
        │ Result / Event / Telemetry
        ▼
Cloud Adapter
        │
        ▼
CloudOps Normalization
        │
        ├──────────► Audit / Event Store
        │
        ▼
Execution Gateway
        │
        ▼
Runtime Layer
        │
        ▼
Runtime Adapter
        │
        │ ACP
        ▼
Autonomous Agent
        │
        ▼
Reasoning
        │
        ▼
Decision / Next Action
```

The agent can then autonomously continue:

```text
Investigate
   ↓
Observe result
   ↓
Reason
   ↓
Select next tool
   ↓
Submit new ToolRequest
   ↓
CloudOps re-evaluates the request
```

Every new operation must pass through the security boundary again.

---

# 52. Autonomous Loop

CloudOps enables a controlled autonomous loop:

```text
┌─────────────────────────────────────────────────────┐
│                                                     │
│                  AGENT REASONING                    │
│                       │                             │
│                       ▼                             │
│                 Tool Selection                      │
│                       │                             │
│                       ▼                             │
│                CloudOps Gateway                     │
│                       │                             │
│             Auth / Capability /                    │
│           DefenseClaw / Policy                     │
│                       │                             │
│                       ▼                             │
│                 Cloud Execute                       │
│                       │                             │
│                       ▼                             │
│                   Result                            │
│                       │                             │
│                       ▼                             │
│                  AGENT REASONING ───────────────────┘
│
└─────────────────────────────────────────────────────┘
```

Autonomy does not bypass governance.

Every new tool request is independently evaluated.

---

# 53. Trust Boundaries

## Boundary 1 — Agent to CloudOps

```text
UNTRUSTED / EXTERNAL RUNTIME
            │
            ▼
     CloudOps Runtime
```

The agent is trusted to provide intent, not trusted with unrestricted cloud authority.

---

## Boundary 2 — Runtime to Execution Gateway

```text
Runtime
  │
  ▼
Authentication
  │
  ▼
Capability
  │
  ▼
Security
```

All execution requests cross this boundary.

---

## Boundary 3 — CloudOps to Cloud Provider

```text
CloudOps
   │
   │ temporary scoped identity
   ▼
Cloud Provider
```

Only controlled cloud identity crosses this boundary.

---

# 54. Agent Identity vs Human Identity vs Cloud Identity

These identities must remain distinct.

```text
Human Identity
      │
      │ approves
      ▼
Agent Identity
      │
      │ requests operation
      ▼
CloudOps
      │
      │ assumes / obtains
      ▼
Cloud Identity
```

Human approval does not turn the agent into the human.

Agent identity does not become a cloud IAM identity.

Cloud identity is temporary execution authority.

---

# 55. Contract Matrix

| From | To | Contract | Purpose |
|---|---|---|---|
| Cloud Provider | Discovery Adapter | Provider API/SDK/Event | Discover cloud state |
| Discovery Adapter | Normalized State | Normalized resource model | Provider-independent state |
| Onboarding UI | Onboarding Service | Invite API | Create/manage invite |
| Agent | Onboarding Manifest | Machine-readable contract | Discover onboarding protocol |
| Agent | Onboarding Service | Join Request | Declare identity/capabilities |
| Operator | Onboarding Service | Approve/Reject | Human trust decision |
| Agent | Onboarding Service | Claim | Bootstrap identity |
| Runtime | Runtime Adapter | ACP | Runtime communication |
| Runtime Adapter | Runtime Layer | RuntimeAdapter contract | Runtime abstraction |
| Runtime Layer | Execution Gateway | ToolRequest | Request operation |
| Execution Gateway | Authentication | Credential validation | Identify agent |
| Execution Gateway | Capability Service | Capability contract | Verify authority |
| Execution Gateway | DefenseClaw | Security evaluation | Guardrails |
| Execution Gateway | Policy Engine | Policy evaluation contract | ALLOW/DENY/APPROVAL |
| Execution Gateway | Approval Service | Approval contract | Human authorization |
| Execution Gateway | Credential Broker | JIT identity request | Obtain cloud authority |
| Credential Broker | Cloud IAM/STS | Provider identity API | Temporary identity |
| Execution Gateway | Cloud Adapter | Canonical execution contract | Provider execution |
| Cloud Adapter | Cloud Provider | Provider API/SDK | Actual operation |
| Cloud Adapter | Execution Gateway | ToolResponse | Normalized result |
| Execution Gateway | Audit | Audit event contract | Traceability |
| Runtime Adapter | Agent | ACP | Return result |

---

# 56. Contract Ownership

A contract must have one clear owner.

```text
Onboarding Contract
        → Onboarding Service

Runtime Contract
        → Runtime Layer

Tool Execution Contract
        → Execution Gateway

Capability Contract
        → Capability Service

Security Contract
        → DefenseClaw

Policy Contract
        → Policy Engine

Approval Contract
        → Approval Service

Identity Contract
        → Credential / Identity Broker

Provider Contract
        → Cloud Adapter
```

This prevents business logic from being duplicated across adapters.

---

# 57. What Each Layer Knows

## Agent

Knows:

```text
Reasoning context
CloudOps tools available
Tool results
Its own runtime state
```

Does not own:

```text
Cloud provider credentials
Policy authority
Approval authority
DefenseClaw override
```

## Runtime Adapter

Knows:

```text
Agent-specific protocol
Runtime process/session behavior
Protocol translation
```

Does not own:

```text
Cloud policy
Cloud IAM authority
Capability grants
```

## Execution Gateway

Knows:

```text
Authenticated agent
Capabilities
Security result
Policy result
Approval
Execution context
```

## Cloud Adapter

Knows:

```text
Provider API
Provider resource model
Provider-specific request/response format
```

Does not know:

```text
Why the agent chose the operation
Agent reasoning
Human approval UI
```

---

# 58. What Each Layer Must Not Bypass

```text
Agent
  X Direct cloud API

Runtime Adapter
  X Direct cloud API
  X Policy bypass

Execution Gateway
  X Capability bypass
  X DefenseClaw bypass
  X Approval bypass

Cloud Adapter
  X Agent authentication
  X Policy decisions

Credential Broker
  X Permanent credentials to agent

Audit
  X Raw secret logging
```

---

# 59. Security Invariants

The following invariants should hold across the system.

### Invariant 1

```text
No authenticated agent ≠ no tool execution
```

### Invariant 2

```text
Unauthorized capability ≠ policy evaluation path
```

### Invariant 3

```text
Policy DENY ≠ execution
```

### Invariant 4

```text
APPROVAL_REQUIRED without valid approval ≠ execution
```

### Invariant 5

```text
Expired/revoked credential ≠ execution
```

### Invariant 6

```text
Agent ≠ permanent cloud credential holder
```

### Invariant 7

```text
Credential rotation ≠ new agent identity
```

### Invariant 8

```text
One-time claim credential ≠ runtime credential
```

### Invariant 9

```text
Every cloud operation = independently authorized request
```

### Invariant 10

```text
Raw secret ≠ audit/log payload
```

---

# 60. Example: Read Operation

```text
Agent
  ↓
ACP
  ↓
Adapter
  ↓
Runtime
  ↓
Tool Gateway
  ↓
Authenticate
  ↓
Capability Check
  ↓
DefenseClaw
  ↓
Policy: ALLOW
  ↓
JIT Identity
  ↓
Cloud Adapter
  ↓
Cloud API
  ↓
Result
```

No human approval is required if policy allows the read operation.

---

# 61. Example: Dangerous Mutation

```text
Agent
  ↓
Tool Request
  ↓
Authenticate
  ↓
Capability
  ↓
DefenseClaw
  ↓
Policy: APPROVAL_REQUIRED
  ↓
Human Approval
  ↓
Approval hash validation
  ↓
JIT Identity
  ↓
Cloud Adapter
  ↓
Cloud API
  ↓
Result
```

If the operator rejects:

```text
APPROVAL_REQUIRED
       ↓
REJECTED
       ↓
NO CLOUD EXECUTION
```

---

# 62. Example: Unauthorized Operation

```text
Agent
  ↓
Tool Request
  ↓
Authenticate
  ↓
Capability Check
  ↓
NOT AUTHORIZED
  ↓
DENY
```

The request should not proceed to execution.

---

# 63. Example: Credential Revocation

```text
Agent
  │
  │ old credential
  ▼
Gateway
  │
  ▼
Credential Store
  │
  ▼
REVOKED
  │
  ▼
DENY
```

The agent identity remains:

```text
ag_123
```

A new runtime credential can be issued without creating a new agent.

---

# 64. Example: Runtime Reconnect

```text
ag_123
   │
   ├── Session 1 → DISCONNECTED
   │
   └── Session 2 → CONNECTED
```

The reconnect must not create:

```text
ag_456
```

unless the agent is explicitly onboarded as a different identity.

---

# 65. Multi-Cloud Execution Model

The agent should use a canonical CloudOps tool model.

```text
Agent
   │
   ▼
CloudOps Tool
   │
   ├── AWS Adapter
   ├── Azure Adapter
   ├── GCP Adapter
   └── Other Adapter
```

Provider-specific execution remains behind the adapter boundary.

Example:

```text
cloudops.compute.describe_instance
```

can eventually map to:

```text
AWS EC2
Azure VM
GCP Compute Engine
```

where a normalized contract exists.

Provider-specific tools can also exist when normalization would lose important provider semantics.

---

# 66. Failure Handling

Every layer should fail closed where security authority is concerned.

Examples:

```text
Authentication unavailable
    → no execution

Capability service unavailable
    → no execution

DefenseClaw unavailable
    → no execution for protected operations

Policy engine unavailable
    → no execution

Approval service unavailable
    → approval-bound operation cannot execute

Credential broker unavailable
    → no cloud execution

Cloud adapter failure
    → normalized execution failure

Audit failure
    → behavior depends on configured audit durability policy;
       security-critical operations should not silently lose traceability
```

---

# 67. Idempotency and Concurrency

Security-sensitive operations must be atomic.

Important examples:

```text
Credential claim
Approval consumption
Credential rotation
Credential revocation
Gateway handshake
Capability authorization changes
```

For example:

```text
30 concurrent claim requests
        ↓
Exactly one successful claim
        ↓
29 conflicts
```

Likewise:

```text
30 concurrent handshake attempts
        ↓
Exactly one successful consumption of a single-use challenge
```

---

# 68. Observability

CloudOps should expose operational signals for:

```text
Agent connectivity
Gateway health
Tool request volume
Authorization denials
Policy denials
Approval latency
Credential rotation
JIT credential issuance
Cloud API latency
Cloud API errors
Adapter failures
Autonomous investigation runs
```

Observability data must not contain raw credentials.

---

# 69. End-to-End Data Ownership

```text
Agent
  owns reasoning state

CloudOps
  owns identity
  owns authorization
  owns policy
  owns approvals
  owns execution state
  owns normalized operational context
  owns audit

Cloud Adapter
  owns provider translation

Cloud Provider
  owns infrastructure state
  owns cloud execution
```

---

# 70. Architectural Principle

The complete system can be reduced to:

```text
                         ┌──────────────────┐
                         │      AGENT       │
                         │                  │
                         │ Reason / Plan    │
                         │ Select Tool      │
                         └────────┬─────────┘
                                  │
                                  │ ACP
                                  ▼
                         ┌──────────────────┐
                         │ Runtime Adapter  │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ CloudOps Runtime │
                         └────────┬─────────┘
                                  │
                             Tool Request
                                  ▼
                    ┌──────────────────────────┐
                    │   CLOUDOPS AUTHORITY     │
                    │                          │
                    │ Authentication            │
                    │ Capability                │
                    │ DefenseClaw               │
                    │ Policy                    │
                    │ Approval                   │
                    │ JIT Identity              │
                    └────────────┬─────────────┘
                                 │
                           Authorized
                                 ▼
                    ┌──────────────────────────┐
                    │     CLOUD ADAPTER        │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                         CLOUD PROVIDER
                                 │
                                 ▼
                              RESULT
                                 │
                                 ▼
                              AGENT
```

---

# 71. Final System Model

```text
                 REASONING AUTHORITY
                        │
                        ▼
                     AGENT
                        │
                     ACP
                        │
                        ▼
                RUNTIME ADAPTER
                        │
                        ▼
                CLOUDOPS RUNTIME
                        │
                  Tool Request
                        │
                        ▼
              ┌─────────────────────┐
              │ CLOUDOPS AUTHORITY  │
              │                     │
              │ Identity            │
              │ Capability          │
              │ DefenseClaw         │
              │ Policy              │
              │ Approval            │
              │ Credential Broker   │
              └──────────┬──────────┘
                         │
                  Execution Authority
                         │
                         ▼
                   CLOUD ADAPTER
                         │
                         ▼
                  CLOUD PROVIDER
                         │
                         ▼
                     OPERATION
                         │
                         ▼
                      RESULT
                         │
                         ▼
                     AGENT
                         │
                         ▼
                  NEXT DECISION
```

The fundamental separation is:

```text
AGENT
  = reasoning + planning + intent

CLOUDOPS
  = identity + authorization + security + policy
    + approval + credential control + execution governance

CLOUD ADAPTER
  = provider-specific translation

CLOUD PROVIDER
  = actual infrastructure execution
```

CloudOps therefore acts as the **execution and authority boundary for autonomous cloud operations**, while remaining independent of any individual agent runtime.
