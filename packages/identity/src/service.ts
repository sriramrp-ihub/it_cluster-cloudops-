import { generateAgentId, NotFoundError, ValidationError, type AgentId, type AgentStatus } from "@cloudops/shared";
import { AgentRecord, CreateAgentDto, IAgentRepository, AgentRepository } from "./repository.js";

export const SUPPORTED_AGENT_TYPES = ["hermes", "openclaw", "custom"] as const;
export type SupportedAgentType = (typeof SUPPORTED_AGENT_TYPES)[number];

export interface CreateAgentInput {
  tenantId: string;
  name: string;
  type: string;
  version: string;
  runtimeProtocol: string;
  status?: AgentStatus;
}

export class AgentService {
  constructor(private readonly repo: IAgentRepository = new AgentRepository()) {}

  async createAgent(input: CreateAgentInput): Promise<AgentRecord> {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError("Agent name is required");
    }

    const lowerType = input.type.toLowerCase();
    if (!SUPPORTED_AGENT_TYPES.includes(lowerType as SupportedAgentType)) {
      throw new ValidationError(`Unsupported agent type '${input.type}'. Supported types: ${SUPPORTED_AGENT_TYPES.join(", ")}`);
    }

    // Stable agent ID using existing @cloudops/shared ID generator
    const agentId = generateAgentId();

    return this.repo.create({
      id: agentId,
      tenantId: input.tenantId,
      name: input.name.trim(),
      type: lowerType,
      version: input.version.trim() || "1.0.0",
      runtimeProtocol: input.runtimeProtocol.trim() || "acp",
      status: input.status || "APPROVED"
    });
  }

  async getAgent(tenantId: string, id: AgentId): Promise<AgentRecord> {
    const agent = await this.repo.findById(tenantId, id);
    if (!agent) {
      throw new NotFoundError(`Agent ${id} not found for tenant ${tenantId}`);
    }
    return agent;
  }

  async listAgents(tenantId: string): Promise<AgentRecord[]> {
    return this.repo.list(tenantId);
  }

  async updateStatus(tenantId: string, id: AgentId, status: AgentStatus): Promise<void> {
    await this.getAgent(tenantId, id);
    await this.repo.updateStatus(tenantId, id, status);
  }

  async deleteAgent(tenantId: string, id: AgentId): Promise<{ id: AgentId; name: string }> {
    const agent = await this.getAgent(tenantId, id);
    const deleted = await this.repo.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundError(`Agent ${id} could not be deleted or was not found for tenant ${tenantId}`);
    }
    return { id: agent.id, name: agent.name };
  }
}
