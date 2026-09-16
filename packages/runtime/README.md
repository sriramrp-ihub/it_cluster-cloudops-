# @cloudops/runtime

Runtime sessions, credentials, and adapter contracts.

## Mock Agent Adapter (CO-001 & CO-002)

The `MockAgentAdapter` is a fully deterministic agent runtime implementation adhering strictly to the `AgentAdapter` contract and the Agent Control Protocol (ACP). It enables end-to-end testing of CloudOps investigation, root-cause analysis, policy evaluation, and governed remediation without requiring live LLM inference or external agent daemons.

### Running the Mock Agent

You can launch a standalone mock agent run using:

```bash
npm run mock-agent:start
```

### Configuration Options

The runner can be configured via environment variables:

- `MOCK_AGENT_TENANT_ID`: Tenant identifier (default: `ten_default_tenant`)
- `MOCK_AGENT_AGENT_ID`: Agent identifier (default: `ag_mock_operator`)
- `MOCK_AGENT_LATENCY_MS`: Simulated step execution delay in milliseconds (default: `0`)

### Adding New Fixtures

Fixtures live in `packages/runtime/fixtures/`:

1. `investigation-ecs-scenario.json`: Contains the ordered read-only tool call sequence and the ground truth root cause.
2. `remediation-proposal.json`: Contains the mutating tool call parameters and expected `AWAITING_APPROVAL` initial response.
3. `approval-outcomes.json`: Specifies agent reactions to all four terminal states (`EXECUTED`, `EXECUTION_FAILED`, `EXPIRED`, `REJECTED`).
4. `adversarial-cases.json`: Defines out-of-scope calls, replay attacks, and payload tampering test cases.

To add a new scenario:
1. Create `<scenario-name>.json` in `packages/runtime/fixtures/`.
2. Define the `scenarioId`, `incident`, `groundTruth`, `toolCallSequence`, and `expectedRootCause`.
3. Pass the custom fixture directory or file when instantiating `MockAgentAdapter({ fixturesDir: ... })`.
