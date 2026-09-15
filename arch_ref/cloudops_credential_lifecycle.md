CloudOps Security Credential Rotation — Technical Reference

1. Purpose

This technical reference defines the credential lifecycle and rotation model for autonomous agents operating through CloudOps.

The design separates:

Invite Token — onboarding entry.

One-Time Claim Credential — one-time bootstrap credential used to claim the agent identity.

Runtime Agent Credential — ongoing authentication credential used by the agent to access the CloudOps Gateway.

JIT Cloud Credential — temporary, scoped cloud-provider credentials used for actual cloud operations.

The core security principle is:

Stable agent identity, replaceable agent authentication, and ephemeral cloud authority.

2. Credential Lifecycle Overview

                    CLOUDOPS AGENT ONBOARDING
                              │
                              ▼
                    ┌───────────────────┐
                    │   INVITE TOKEN    │
                    │                   │
                    │ co_inv_xxxxx      │
                    │ TTL: 24 hours     │
                    │ One-time          │
                    └─────────┬─────────┘
                              │
                              │ GET manifest
                              ▼
                    ┌───────────────────┐
                    │  JOIN REQUEST     │
                    │                   │
                    │ Agent declares    │
                    │ identity + caps   │
                    └─────────┬─────────┘
                              │
                         Human approves
                              │
                              ▼
                    ┌───────────────────┐
                    │ ONE-TIME CLAIM    │
                    │ CREDENTIAL        │
                    │                   │
                    │ co_agent_xxxxx    │
                    │ 256-bit random    │
                    │ TTL / single-use  │
                    └─────────┬─────────┘
                              │
                         CLAIM ONCE
                              │
                              ▼
                    ┌───────────────────┐
                    │ AGENT IDENTITY    │
                    │                   │
                    │ ag_<uuid>         │
                    └─────────┬─────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   RUNTIME AGENT CREDENTIAL    │
              │                               │
              │ Used for CloudOps Gateway     │
              │ authentication                │
              └───────────────┬───────────────┘
                              │
                       rotate periodically
                              │
                              ▼
                    ┌───────────────────┐
                    │ NEW CREDENTIAL    │
                    │                   │
                    │ Old → revoked     │
                    │ New → active      │
                    └─────────┬─────────┘
                              │
                              ▼
                     TOOL EXECUTION
                              │
                              ▼
                    ┌───────────────────┐
                    │ JIT CLOUD CREDS   │
                    │                   │
                    │ AWS STS           │
                    │ Temporary         │
                    │ Scoped            │
                    │ Short-lived       │
                    └─────────┬─────────┘
                              │
                         expires
                              │
                              ▼
                    ┌───────────────────┐
                    │ CREDENTIAL GONE   │
                    └───────────────────┘

3. Credential Types

3.1 Invite Token

The invite token is used only to enter the onboarding workflow.

co_inv_xxxxx

Properties:

Temporary.

One-time onboarding context.

Used to retrieve the onboarding manifest.

Must expire.

Must not become a runtime authentication credential.

Lifecycle:

INVITE CREATED
      ↓
INVITE ACTIVE
      ↓
JOIN REQUEST
      ↓
USED / EXPIRED / REVOKED

3.2 One-Time Claim Credential

The claim credential is generated after the human approves the agent's join request.

Example:

co_agent_7f83a9...

Properties:

Cryptographically random.

256-bit random value.

Returned to the agent only once.

Stored by CloudOps as a SHA-256 hash.

Single-use.

Marked CONSUMED after successful claim.

Cannot be used as a permanent runtime credential.

Claim sequence

Human approves agent
        │
        ▼
CloudOps generates random credential
        │
        ├── Store SHA-256 hash
        │
        └── Return raw credential ONCE
                         │
                         ▼
                    Agent claims
                         │
                         ▼
              Credential marked CONSUMED
                         │
                         ▼
              Agent identity established

The claim credential does not rotate.

It follows:

ONE-TIME CLAIM SECRET
        ↓
     CONSUMED
        ↓
RUNTIME IDENTITY CREATED

It does not follow:

credential → rotate → credential → rotate

4. Stable Agent Identity

The agent identity is independent of credential rotation.

Example:

ag_123456

The identity remains stable while authentication credentials change.

                 Agent
              ag_123456
                   │
        ┌──────────┼──────────┐
        │          │          │
    cred_v1     cred_v2     cred_v3
        │          │          │
     revoked    revoked     active

Credential rotation must not create a new agent identity.

This keeps the audit trail associated with one stable agent:

ag_123456
   │
   ├── investigated logs
   ├── executed operation
   ├── approved operation
   └── rotated credential

5. Runtime Agent Credential

After the one-time claim is completed, the agent requires an ongoing runtime authentication credential.

Example request:

Agent
  │
  │ Authorization: Bearer <runtime-credential>
  ▼
CloudOps Gateway

CloudOps should retain credential metadata and a cryptographic hash, not the raw credential.

Recommended stored fields:

agent_id
credential_id
credential_hash
status
created_at
expires_at
last_used_at

The raw runtime credential should not be persisted by CloudOps.

Authentication flow

                  AGENT
                    │
                    │ runtime credential
                    ▼
          ┌──────────────────────┐
          │ CloudOps Gateway     │
          │                      │
          │ Hash credential      │
          │ Find credential      │
          │ Verify active        │
          │ Verify agent binding │
          └──────────┬───────────┘
                     │
                     ▼
              Agent Identity
                     │
                     ▼
             Capability Check
                     │
                     ▼
              DefenseClaw
                     │
                     ▼
                Policy

6. Runtime Credential Rotation

Runtime credentials should not be rotated on every request.

The recommended approach is credential versioning.

Example:

Agent: ag_123

Credential A
────────────
ID: cred_001
Status: ACTIVE
Created: Jan 1
Expires: Mar 1

             ↓ rotation

Credential B
────────────
ID: cred_002
Status: ACTIVE
Created: Feb 25
Expires: May 25

Credential A
Status: GRACE_PERIOD

After the overlap period:

cred_001 → REVOKED
cred_002 → ACTIVE

The overlap/grace period prevents an agent from losing connectivity while switching credentials.

7. Runtime Credential Rotation Flow

                    AGENT
                      │
                      │ cred_001
                      ▼
              ┌─────────────────┐
              │ CloudOps Gateway│
              └────────┬────────┘
                       │
                       ▼
                Credential Store
                       │
                 cred_001 ACTIVE
                       │
                       │
                Rotation triggered
                       │
                       ▼
              Generate cred_002
                       │
                       ▼
             Store hash(cred_002)
                       │
                       ▼
           ┌──────────────────────┐
           │ cred_001 = GRACE     │
           │ cred_002 = ACTIVE    │
           └──────────┬───────────┘
                      │
                      ▼
                Agent receives
                 cred_002
                      │
                      ▼
             Agent switches over
                      │
                      ▼
             cred_001 → REVOKED

The agent uses the new credential for future requests:

cred_002

8. Credential States

A runtime credential should have explicit lifecycle states.

                  ┌───────────┐
                  │  ACTIVE   │
                  └─────┬─────┘
                        │
                 Rotation triggered
                        │
                        ▼
                ┌───────────────┐
                │ GRACE_PERIOD  │
                └───────┬───────┘
                        │
                  Cutover complete
                        │
                        ▼
                ┌───────────────┐
                │    REVOKED    │
                └───────────────┘

Expiration can independently terminate a credential:

ACTIVE
  │
  │ expiration
  ▼
EXPIRED

Emergency security action:

ACTIVE / GRACE_PERIOD
          │
          │ emergency revoke
          ▼
       REVOKED

9. Agent Credential vs Cloud Credential

The runtime agent credential and the cloud-provider credential must have different lifetimes and purposes.

                    AUTONOMOUS AGENT
                           │
                    Agent Credential
                           │
                           ▼
                 ┌───────────────────┐
                 │ CloudOps Gateway  │
                 └─────────┬─────────┘
                           │
                    Auth + Capability
                           │
                    DefenseClaw
                           │
                       Policy
                           │
                     Approval?
                           │
                           ▼
                 ┌───────────────────┐
                 │  JIT Credential   │
                 │      Broker       │
                 └─────────┬─────────┘
                           │
                           │ AssumeRole
                           ▼
                     AWS STS
                           │
                           ▼
                Temporary AWS Credentials
                           │
                           ▼
                    AWS API Call
                           │
                           ▼
                   Credentials expire

Agent credential

Longer-lived authentication material:

Agent Credential
      │
      ├── Rotation
      ├── Revocation
      └── Expiration

Example:

Credential v1
     ↓
Credential v2
     ↓
Credential v3

Cloud credential

Short-lived execution authority:

JIT AWS Credential #1
        ↓
      expires

JIT AWS Credential #2
        ↓
      expires

JIT AWS Credential #3
        ↓
      expires

10. JIT Cloud Credential Model

JIT means Just-In-Time.

CloudOps should not provide autonomous agents with permanent cloud credentials.

Instead, when an authorized cloud operation needs to execute:

Agent intent
    ↓
CloudOps authentication
    ↓
Capability authorization
    ↓
DefenseClaw checks
    ↓
Deterministic policy
    ↓
Human approval if required
    ↓
JIT identity broker
    ↓
Temporary scoped cloud identity
    ↓
Cloud operation
    ↓
Credential expires

The agent controls reasoning and intent.

CloudOps controls authority and execution.

The cloud provider receives only temporary execution authority.

11. Example: Hermes ECS Investigation

Suppose Hermes decides it needs to inspect an ECS service.

Hermes
   │
   │ ACP
   ▼
Hermes Adapter
   │
   ▼
CloudOps Runtime
   │
   ▼
Tool Gateway

Tool request:

{
  "tool": "aws.ecs.describe_service",
  "arguments": {
    "cluster": "cloudops-test",
    "service": "starvision-motors"
  }
}

CloudOps evaluates:

Agent authenticated?
        ↓
Capability authorized?
        ↓
DefenseClaw checks?
        ↓
Policy ALLOW?
        ↓
Approval required?

If execution is allowed:

CloudOps
   │
   ▼
JIT Identity Broker
   │
   ▼
AWS STS AssumeRole
   │
   ▼
Temporary AWS credentials
   │
   ▼
ECS DescribeServices
   │
   ▼
Result
   │
   ▼
Credentials expire

Hermes must not receive permanent AWS credentials.

The cloud credentials remain inside the controlled CloudOps execution boundary.

12. Credential Security Boundary

The security boundary should be:

┌────────────────────────────────────────────────────────────┐
│                CREDENTIAL / IDENTITY LAYER                 │
│                                                            │
│  ┌──────────────┐                                          │
│  │ Invite Token │ ── one-time onboarding                   │
│  └──────┬───────┘                                          │
│         ▼                                                  │
│  ┌───────────────────┐                                     │
│  │ Claim Credential  │ ── one-time → CONSUMED              │
│  └────────┬──────────┘                                     │
│           ▼                                                │
│  ┌───────────────────┐                                     │
│  │ Agent Identity    │                                     │
│  │ ag_<uuid>         │                                     │
│  └────────┬──────────┘                                     │
│           ▼                                                │
│  ┌──────────────────────────────┐                          │
│  │ Runtime Credential           │                          │
│  │                              │                          │
│  │ Active → Rotate → Revoke     │                          │
│  └──────────────┬───────────────┘                          │
│                 ▼                                          │
│  ┌──────────────────────────────┐                          │
│  │ JIT Credential Broker        │                          │
│  │                              │                          │
│  │ Temporary • Scoped • Ephemeral│                         │
│  └──────────────┬───────────────┘                          │
│                 ▼                                          │
│       AWS STS / Azure / GCP IAM                            │
└────────────────────────────────────────────────────────────┘

13. Security Requirements

13.1 One-Time Claim Credential

Generate using a cryptographically secure random source.

Use 256-bit random entropy.

Return the raw value only once.

Store only a cryptographic hash.

Atomically consume the credential.

Reject subsequent claims.

Bind the credential to the intended agent/onboarding context.

Expire unused claim credentials.

13.2 Runtime Credential

Store only a cryptographic hash.

Bind the credential to the stable agent identity.

Support explicit active, grace-period, revoked, and expired states.

Support rotation without changing agent_id.

Provide a controlled overlap/grace period.

Revoke old credentials after successful cutover.

Support emergency revocation.

Avoid returning credentials in logs or audit records.

13.3 Cloud Credentials

Never expose permanent cloud credentials to autonomous agents.

Obtain temporary credentials through the JIT identity broker.

Scope credentials to the required cloud role and operation.

Keep cloud credentials inside the execution boundary.

Allow cloud credentials to expire automatically.

Record the cloud identity and operation in the audit trail without logging secret material.

14. Audit Model

Credential lifecycle events should remain associated with the stable agent identity.

Example:

ag_123456
   │
   ├── INVITE_CREATED
   ├── JOIN_REQUESTED
   ├── APPROVED
   ├── CLAIM_CREDENTIAL_ISSUED
   ├── CLAIM_CREDENTIAL_CONSUMED
   ├── RUNTIME_CREDENTIAL_CREATED
   ├── RUNTIME_CREDENTIAL_ROTATED
   ├── RUNTIME_CREDENTIAL_REVOKED
   ├── JIT_CREDENTIAL_ISSUED
   ├── CLOUD_OPERATION_EXECUTED
   └── JIT_CREDENTIAL_EXPIRED

Audit records should identify:

agent_id
credential_id
event_type
timestamp
operator_id (when applicable)
operation_id / request_id
result

Do not record raw credential material.

15. Failure and Recovery Scenarios

Rotation failure before cutover

cred_001 = ACTIVE
cred_002 = generation failed

Result:

cred_001 remains ACTIVE

The agent continues operating.

Rotation succeeds but agent has not switched

cred_001 = GRACE_PERIOD
cred_002 = ACTIVE

The old credential remains temporarily usable according to the configured grace policy.

Once the agent confirms cutover or the grace period expires:

cred_001 → REVOKED

Old credential used after revocation

Agent → cred_001
          ↓
CloudOps Gateway
          ↓
credential status = REVOKED
          ↓
DENY

Runtime credential compromised

Immediate response:

Compromised credential
        ↓
REVOKE
        ↓
Generate replacement credential
        ↓
Agent re-authentication
        ↓
Existing agent identity retained

The stable agent_id does not change.

JIT cloud credential expires

JIT credential
      ↓
expiration
      ↓
Cloud provider rejects further use

The agent must request a new authorized operation through CloudOps rather than reusing the expired cloud credential.

16. Complete Security Credential Flow

INVITE
  │
  │ one-time
  ▼
CLAIM
  │
  │ one-time
  ▼
AGENT IDENTITY
  │
  │ stable
  ▼
RUNTIME CREDENTIAL
  │
  │ rotate / revoke
  ▼
CLOUDOPS GATEWAY
  │
  │ authentication
  ▼
CAPABILITY AUTHORIZATION
  │
  ▼
DEFENSECLAW
  │
  ▼
POLICY
  │
  ├── DENY
  │
  ├── APPROVAL_REQUIRED
  │       │
  │       ▼
  │   HUMAN APPROVAL
  │
  └── ALLOW
          │
          ▼
   JIT CREDENTIAL BROKER
          │
          ▼
   TEMPORARY CLOUD IDENTITY
          │
          ▼
      CLOUD API
          │
          ▼
       OPERATION
          │
          ▼
    CLOUD CREDENTIAL
       EXPIRES

17. Core Design Principles

The one-time claim credential is a bootstrap secret, not a rotating runtime credential.

Agent identity is stable and survives credential rotation.

Runtime authentication credentials are replaceable and revocable.

Credential rotation uses versioning and controlled overlap rather than per-request replacement.

Cloud provider credentials are separate from agent credentials.

Cloud authority is temporary, scoped, and obtained just in time.

Autonomous agents never receive permanent cloud credentials.

Raw credential material is never persisted or written to logs.

Every credential lifecycle event is auditable against the stable agent identity.

CloudOps remains the authority boundary for authentication, authorization, policy, credential issuance, and execution.

18. Final Mental Model

INVITE
  │
  │ one-time
  ▼
CLAIM
  │
  │ one-time
  ▼
AGENT IDENTITY
  │
  │ stable
  ▼
RUNTIME CREDENTIAL
  │
  │ rotate / revoke
  ▼
CLOUDOPS GATEWAY
  │
  │ per operation
  ▼
JIT CLOUD CREDENTIAL
  │
  │ short TTL
  ▼
CLOUD API
  │
  ▼
EXPIRE

Security Principle

Stable agent identity + replaceable agent authentication + ephemeral cloud authority.