import type { Generated } from "kysely";

export interface TenantTable {
  id: string;
  name: string;
  created_at: Generated<Date>;
}

export interface AgentTable {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  version: string;
  runtime_protocol: string;
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AgentCredentialTable {
  id: string;
  agent_id: string;
  tenant_id: string | null;
  credential_hash: string;
  salt: string;
  status: string;
  issued_at: Generated<Date>;
  expires_at: Date;
  created_at: Generated<Date>;
  revoked_at: Date | null;
  rotated_at: Date | null;
  replaced_by_credential_id: string | null;
  last_used_at: Date | null;
}

export interface AgentSessionTable {
  id: string;
  agent_id: string;
  tenant_id: string | null;
  credential_id: string;
  session_token_hash: string;
  status: string;
  client_nonce: string | null;
  server_nonce: string | null;
  disconnect_reason: string | null;
  gateway_node_id: string | null;
  last_heartbeat_at: Generated<Date>;
  connected_at: Generated<Date>;
  disconnected_at: Date | null;
}

export interface AgentInviteTable {
  id: string;
  token_hash: string;
  tenant_id: string;
  status: string;
  expires_at: Date;
  created_by: string;
  claimed_at: Date | null;
  created_at: Generated<Date>;
}

export interface AgentJoinRequestTable {
  id: string;
  invite_id: string;
  tenant_id: string;
  agent_id: string | null;
  agent_name: string;
  agent_type: string;
  agent_version: string;
  gateway_protocol: string;
  endpoint: string | null;
  declared_capabilities: string; // JSON string / JSONB
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  created_at: Generated<Date>;
}

export interface AgentClaimCredentialTable {
  id: string;
  join_request_id: string;
  agent_id: string;
  tenant_id: string;
  claim_token_hash: string;
  status: string;
  expires_at: Date;
  consumed_at: Date | null;
  exchanged_at: Date | null;
  created_at: Generated<Date>;
}

export interface RuntimeTable {
  id: string;
  name: string;
  protocol: string;
  description: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface RuntimeSessionTable {
  id: string;
  runtime_id: string;
  agent_id: string;
  status: string;
  pid: number | null;
  created_at: Generated<Date>;
  terminated_at: Date | null;
}

export interface CapabilityTable {
  id: string;
  name: string;
  provider: string;
  service: string;
  action: string;
  risk_level: string;
  description: string | null;
  created_at: Generated<Date>;
}

export interface CapabilityGrantTable {
  id: string;
  agent_id: string;
  capability_id: string;
  status: string;
  granted_by: string;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
}

export interface PolicyTable {
  id: string;
  tenant_id: string;
  name: string;
  condition_expression: string; // JSONB
  effect: string;
  risk_level: string;
  created_at: Generated<Date>;
}

export interface ApprovalTable {
  id: string;
  tenant_id: string;
  run_id: string | null;
  agent_id: string;
  operation_type: string;
  tool_name: string;
  operation_payload_hash: string;
  raw_payload: string; // JSONB
  status: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  expires_at: Date;
  consumed_at: Date | null;
  signature: string | null;
  signed_by: string | null;
  signed_at: Date | null;
  idempotency_key: string | null;
  escalated_at: Date | null;
  execution_result: string | null; // JSONB
  error_message: string | null;
  dry_run_diff: string | null; // JSONB
  previous_state_snapshot: string | null; // JSONB
  created_at: Generated<Date>;
}

export interface RunTable {
  id: string;
  tenant_id: string;
  agent_id: string;
  session_id: string | null;
  user_id: string | null;
  user_prompt: string;
  status: string;
  final_response: string | null;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface ToolExecutionTable {
  id: string;
  run_id: string;
  agent_id: string;
  tool_name: string;
  input_payload: string; // JSONB
  output_payload: string | null; // JSONB
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  created_at: Generated<Date>;
}

export interface CloudAccountTable {
  id: string;
  tenant_id: string;
  provider: string;
  account_id: string;
  role_arn: string | null;
  region: string;
  status: string;
  created_at: Generated<Date>;
}

export interface AuditEventTable {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  run_id: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string;
  payload: string; // JSONB
  ip_address: string | null;
  prev_hash: Generated<string>;
  row_hash: Generated<string>;
  seq_num: Generated<string>;
  created_at: Generated<Date>;
}

export interface DomainEventTable {
  id: string;
  run_id: string;
  event_type: string;
  sequence_number: number;
  payload: string; // JSONB
  created_at: Generated<Date>;
}

export interface IncidentTable {
  id: string;
  tenant_id: string;
  provider: string;
  account_id: string;
  region: string;
  service: string;
  resource_id: string;
  severity: string;
  title: string;
  alert_description: string;
  source_metadata: string; // JSONB
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  resolved_at: Date | null;
}

export interface InvestigationTable {
  id: string;
  incident_id: string;
  tenant_id: string;
  agent_id: string | null;
  session_id: string | null;
  status: string;
  root_cause: string | null; // JSONB
  started_at: Generated<Date>;
  completed_at: Date | null;
  error_message: string | null;
}

export interface IncidentEvidenceTable {
  id: string;
  incident_id: string;
  investigation_id: string | null;
  tenant_id: string;
  source: string;
  resource: string;
  observation: string;
  severity: string;
  raw_payload: string | null; // JSONB
  created_at: Generated<Date>;
}

export interface AgentConnectorTable {
  id: Generated<string>;
  agent_id: string;
  tenant_id: string;
  pid: number | null;
  mcp_port: number | null;
  mcp_sse_url: string | null;
  status: Generated<string>; // starting, connected, stopped, error
  error_message: string | null;
  started_at: Generated<Date>;
  stopped_at: Date | null;
}

export interface DatabaseSchema {
  tenants: TenantTable;
  agents: AgentTable;
  agent_credentials: AgentCredentialTable;
  agent_sessions: AgentSessionTable;
  agent_invites: AgentInviteTable;
  agent_join_requests: AgentJoinRequestTable;
  agent_claim_credentials: AgentClaimCredentialTable;
  agent_connectors: AgentConnectorTable;
  runtimes: RuntimeTable;
  runtime_sessions: RuntimeSessionTable;
  capabilities: CapabilityTable;
  capability_grants: CapabilityGrantTable;
  policies: PolicyTable;
  approvals: ApprovalTable;
  runs: RunTable;
  tool_executions: ToolExecutionTable;
  cloud_accounts: CloudAccountTable;
  audit_events: AuditEventTable;
  domain_events: DomainEventTable;
  incidents: IncidentTable;
  investigations: InvestigationTable;
  incident_evidence: IncidentEvidenceTable;
}


