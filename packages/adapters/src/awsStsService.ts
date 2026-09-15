import { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { AuthenticationError, CloudAdapterError, ValidationError } from "@cloudops/shared";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export interface CallerIdentityResult {
  accountId: string;
  arn: string;
  userId: string;
}

export interface AssumeRoleParams {
  roleArn: string;
  sessionName?: string | undefined;
  durationSeconds?: number | undefined;
  externalId?: string | undefined;
}

export interface AssumedSessionResult {
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: Date;
  };
  assumedRoleUser: {
    arn: string;
    assumedRoleId: string;
  };
}

/**
 * Strict regex for AWS IAM Role ARN:
 * arn:aws:iam::<12-digit-account-id>:role/<role-name-with-optional-path>
 */
const AWS_ROLE_ARN_REGEX = /^arn:aws:iam::\d{12}:role\/[\w+=,.@\/-]{1,512}$/;

export function isValidAwsRoleArn(arn: string): boolean {
  return AWS_ROLE_ARN_REGEX.test(arn);
}

export interface IAwsStsService {
  getCallerIdentity(credentials: AwsCredentials, region: string): Promise<CallerIdentityResult>;
  assumeRole(credentials: AwsCredentials, region: string, params: AssumeRoleParams): Promise<AssumedSessionResult>;
}

export class AwsStsService implements IAwsStsService {
  /**
   * Factory method to create an STSClient.
   * Internalized to allow clean mocking in unit tests without monkey-patching.
   */
  protected createStsClient(credentials: AwsCredentials, region: string): STSClient {
    // Security check: No custom endpoints allowed to prevent SSRF
    const creds: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    };
    if (credentials.sessionToken) {
      creds.sessionToken = credentials.sessionToken;
    }

    return new STSClient({
      region,
      credentials: creds
    });
  }

  /**
   * Validate credentials against AWS STS GetCallerIdentity.
   * Extracts verified AWS Account ID directly from STS response.
   */
  async getCallerIdentity(credentials: AwsCredentials, region: string): Promise<CallerIdentityResult> {
    if (!credentials.accessKeyId || !credentials.secretAccessKey) {
      throw new ValidationError("AWS Access Key ID and Secret Access Key are required");
    }
    if (!region) {
      throw new ValidationError("AWS Region is required");
    }

    const client = this.createStsClient(credentials, region);

    try {
      const command = new GetCallerIdentityCommand({});
      const response = await client.send(command);

      if (!response.Account) {
        throw new CloudAdapterError("AWS STS response did not return an Account ID");
      }

      return {
        accountId: response.Account,
        arn: response.Arn || "",
        userId: response.UserId || ""
      };
    } catch (err: any) {
      // Differentiate authentication failures from adapter/network failures
      const errorCode = err?.name || err?.Code || "";
      const isAuthError = [
        "InvalidClientTokenId",
        "SignatureDoesNotMatch",
        "AuthFailure",
        "ExpiredToken",
        "AccessDenied",
        "UnrecognizedClientException"
      ].includes(errorCode);

      if (isAuthError) {
        throw new AuthenticationError("Invalid AWS credentials: authentication failed with AWS STS", {
          awsErrorCode: errorCode
        });
      }

      if (err instanceof CloudAdapterError || err instanceof AuthenticationError) {
        throw err;
      }

      throw new CloudAdapterError(`AWS STS GetCallerIdentity error: ${err?.message || "Verification failed"}`, {
        awsErrorCode: errorCode
      });
    }
  }

  /**
   * Perform STS AssumeRole using verified credentials.
   * Returns temporary short-lived session credentials.
   */
  async assumeRole(
    credentials: AwsCredentials,
    region: string,
    params: AssumeRoleParams
  ): Promise<AssumedSessionResult> {
    if (!isValidAwsRoleArn(params.roleArn)) {
      throw new ValidationError(
        "Invalid Assume Role ARN format. Expected: arn:aws:iam::<12-digit-account-id>:role/<role-name>"
      );
    }

    const client = this.createStsClient(credentials, region);
    const sessionName = (params.sessionName || `cloudops-sess-${Date.now()}`).slice(0, 64);
    const durationSeconds = params.durationSeconds || 900; // 15 minutes default

    try {
      const command = new AssumeRoleCommand({
        RoleArn: params.roleArn,
        RoleSessionName: sessionName,
        DurationSeconds: durationSeconds,
        ExternalId: params.externalId || undefined
      });

      const response = await client.send(command);

      if (
        !response.Credentials?.AccessKeyId ||
        !response.Credentials?.SecretAccessKey ||
        !response.Credentials?.SessionToken ||
        !response.Credentials?.Expiration
      ) {
        throw new CloudAdapterError("STS AssumeRole succeeded but did not return complete temporary credentials");
      }

      return {
        credentials: {
          accessKeyId: response.Credentials.AccessKeyId,
          secretAccessKey: response.Credentials.SecretAccessKey,
          sessionToken: response.Credentials.SessionToken,
          expiration: response.Credentials.Expiration
        },
        assumedRoleUser: {
          arn: response.AssumedRoleUser?.Arn || params.roleArn,
          assumedRoleId: response.AssumedRoleUser?.AssumedRoleId || ""
        }
      };
    } catch (err: any) {
      if (err instanceof ValidationError) throw err;

      const errorCode = err?.name || err?.Code || "";
      throw new CloudAdapterError(`Unable to assume IAM role: ${err?.message || "AssumeRole operation failed"}`, {
        roleArn: params.roleArn,
        awsErrorCode: errorCode
      });
    }
  }
}
