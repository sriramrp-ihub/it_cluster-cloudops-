import { NotFoundError, ValidationError } from "@cloudops/shared";
import { AwsStsService, IAwsStsService } from "./awsStsService.js";
import { AwsSessionManager, defaultAwsSessionManager } from "./awsSessionManager.js";
import { CloudAccountRecord, CloudAccountRepository, ICloudAccountRepository } from "./cloudAccountRepository.js";
import { AwsDiscoveryService, DiscoveredWorkload } from "./awsDiscoveryService.js";

export interface ConnectAwsDto {
  tenantId: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  assumeRoleArn?: string | undefined;
  externalId?: string | undefined;
}

export class CloudAccountService {
  constructor(
    private readonly stsService: IAwsStsService = new AwsStsService(),
    private readonly sessionManager: AwsSessionManager = defaultAwsSessionManager,
    private readonly repository: ICloudAccountRepository = new CloudAccountRepository()
  ) {}

  /**
   * Complete real AWS connection flow:
   * 1. Validate credentials via STS GetCallerIdentity
   * 2. (Optional) Assume IAM role via STS AssumeRole
   * 3. Establish in-memory session (never persisted to disk or DB)
   * 4. Persist safe cloud-account metadata in PostgreSQL
   * 5. Return safe metadata to caller
   */
  async connectAws(dto: ConnectAwsDto): Promise<CloudAccountRecord> {
    if (!dto.tenantId) {
      throw new ValidationError("Tenant context is required");
    }
    if (!dto.region) {
      throw new ValidationError("AWS Region is required");
    }
    if (!dto.accessKeyId || !dto.secretAccessKey) {
      throw new ValidationError("AWS Access Key ID and Secret Access Key are required");
    }

    const initialCredentials = {
      accessKeyId: dto.accessKeyId.trim(),
      secretAccessKey: dto.secretAccessKey.trim(),
      sessionToken: dto.sessionToken?.trim() || undefined
    };

    // 1. Validate credentials against real AWS STS
    const callerIdentity = await this.stsService.getCallerIdentity(initialCredentials, dto.region);
    const verifiedAccountId = callerIdentity.accountId;

    let activeSessionCredentials = {
      accessKeyId: initialCredentials.accessKeyId,
      secretAccessKey: initialCredentials.secretAccessKey,
      sessionToken: initialCredentials.sessionToken,
      expiration: undefined as Date | undefined
    };
    let effectiveRoleArn: string | null = null;

    // 2. Optional STS AssumeRole if role ARN supplied
    if (dto.assumeRoleArn && dto.assumeRoleArn.trim().length > 0) {
      const roleArn = dto.assumeRoleArn.trim();
      const assumed = await this.stsService.assumeRole(initialCredentials, dto.region, {
        roleArn,
        externalId: dto.externalId
      });

      activeSessionCredentials = {
        accessKeyId: assumed.credentials.accessKeyId,
        secretAccessKey: assumed.credentials.secretAccessKey,
        sessionToken: assumed.credentials.sessionToken,
        expiration: assumed.credentials.expiration
      };
      effectiveRoleArn = roleArn;
    }

    // 3. Prevent duplicate account rows for (tenantId, provider, accountId, region)
    const existing = await this.repository.findExisting(
      dto.tenantId,
      "aws",
      verifiedAccountId,
      dto.region
    );

    let accountRecord: CloudAccountRecord;

    if (existing) {
      // Update existing record status to CONNECTED and refresh role ARN
      const updated = await this.repository.updateStatus(
        dto.tenantId,
        existing.id,
        "CONNECTED",
        effectiveRoleArn
      );
      accountRecord = updated || existing;
    } else {
      // Create new safe cloud account record in database
      accountRecord = await this.repository.create({
        tenantId: dto.tenantId,
        provider: "aws",
        accountId: verifiedAccountId,
        roleArn: effectiveRoleArn,
        region: dto.region,
        status: "CONNECTED"
      });
    }

    // 4. Store active credentials in in-memory session manager (never stored in DB!)
    this.sessionManager.createSession(dto.tenantId, accountRecord.id, {
      provider: "aws",
      accountId: verifiedAccountId,
      region: dto.region,
      roleArn: effectiveRoleArn,
      credentials: activeSessionCredentials
    });

    return accountRecord;
  }

  /**
   * List all cloud accounts connected for a tenant.
   * Returns only safe metadata.
   */
  async listAccounts(tenantId: string): Promise<CloudAccountRecord[]> {
    if (!tenantId) {
      throw new ValidationError("Tenant context is required");
    }
    return this.repository.listByTenant(tenantId);
  }

  /**
   * Disconnect a cloud account:
   * 1. Invalidate and remove in-memory temporary session
   * 2. Remove record from database
   */
  async disconnectAccount(tenantId: string, cloudAccountId: string): Promise<{ success: boolean; id: string }> {
    if (!tenantId) {
      throw new ValidationError("Tenant context is required");
    }
    if (!cloudAccountId) {
      throw new ValidationError("Cloud Account ID is required");
    }

    const existing = await this.repository.getById(tenantId, cloudAccountId);
    if (!existing) {
      throw new NotFoundError(`Cloud account ${cloudAccountId} not found for this tenant`);
    }

    // Invalidate in-memory credentials immediately
    this.sessionManager.deleteSession(tenantId, cloudAccountId);

    // Delete record from database
    const deleted = await this.repository.delete(tenantId, cloudAccountId);

    return { success: deleted, id: cloudAccountId };
  }

  /**
   * Discover real workloads for a connected cloud account using active temporary credentials
   */
  async discoverWorkloads(
    tenantId: string,
    cloudAccountId: string
  ): Promise<{ workloads: DiscoveredWorkload[]; sessionActive: boolean }> {
    if (!tenantId) {
      throw new ValidationError("Tenant context is required");
    }
    if (!cloudAccountId) {
      throw new ValidationError("Cloud Account ID is required");
    }

    const account = await this.repository.getById(tenantId, cloudAccountId);
    if (!account) {
      throw new NotFoundError(`Cloud account ${cloudAccountId} not found for this tenant`);
    }

    const credentials = this.sessionManager.getCredentials(tenantId, cloudAccountId);
    if (!credentials) {
      return { workloads: [], sessionActive: false };
    }

    const discovery = new AwsDiscoveryService();
    const workloads = await discovery.discoverWorkloads(credentials, account.region);
    return { workloads, sessionActive: true };
  }
}
