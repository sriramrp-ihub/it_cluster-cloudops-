import { describe, it, expect, vi } from "vitest";
import { AwsStsService, isValidAwsRoleArn, AwsCredentials } from "@cloudops/adapters";
import { AuthenticationError, CloudAdapterError, ValidationError } from "@cloudops/shared";

describe("AwsStsService Unit Tests", () => {
  describe("isValidAwsRoleArn validation", () => {
    it("accepts valid IAM Role ARNs", () => {
      expect(isValidAwsRoleArn("arn:aws:iam::123456789012:role/CloudOpsRole")).toBe(true);
      expect(isValidAwsRoleArn("arn:aws:iam::987654321098:role/service-role/CloudOpsExecutionRole")).toBe(true);
      expect(isValidAwsRoleArn("arn:aws:iam::111222333444:role/admin-role-123")).toBe(true);
    });

    it("rejects invalid role ARNs and arbitrary strings", () => {
      expect(isValidAwsRoleArn("")).toBe(false);
      expect(isValidAwsRoleArn("arn:aws:iam::12345:role/Invalid")).toBe(false); // not 12 digits
      expect(isValidAwsRoleArn("arn:aws:iam::123456789012:user/Alice")).toBe(false); // user, not role
      expect(isValidAwsRoleArn("https://evil-host.com/role")).toBe(false); // SSRF attempt
      expect(isValidAwsRoleArn("arn:aws:s3:::my-bucket")).toBe(false);
      expect(isValidAwsRoleArn("arn:aws:iam::123456789012:role/")).toBe(false);
    });
  });

  describe("getCallerIdentity with mocked STS client", () => {
    it("successfully returns verified account ID on valid credentials", async () => {
      class TestStsService extends AwsStsService {
        protected override createStsClient() {
          return {
            send: vi.fn().mockResolvedValue({
              Account: "123456789012",
              Arn: "arn:aws:iam::123456789012:user/admin",
              UserId: "AIDAEXAMPLEUSER"
            })
          } as any;
        }
      }

      const service = new TestStsService();
      const result = await service.getCallerIdentity(
        { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
        "us-east-1"
      );

      expect(result.accountId).toBe("123456789012");
      expect(result.arn).toBe("arn:aws:iam::123456789012:user/admin");
      expect(result.userId).toBe("AIDAEXAMPLEUSER");
    });

    it("throws AuthenticationError on InvalidClientTokenId error from AWS", async () => {
      class TestStsService extends AwsStsService {
        protected override createStsClient() {
          return {
            send: vi.fn().mockRejectedValue({
              name: "InvalidClientTokenId",
              message: "The security token included in the request is invalid."
            })
          } as any;
        }
      }

      const service = new TestStsService();
      await expect(
        service.getCallerIdentity(
          { accessKeyId: "AKIAINVALIDKEYID00", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
          "us-east-1"
        )
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws AuthenticationError on SignatureDoesNotMatch error from AWS", async () => {
      class TestStsService extends AwsStsService {
        protected override createStsClient() {
          return {
            send: vi.fn().mockRejectedValue({
              name: "SignatureDoesNotMatch",
              message: "The request signature we calculated does not match the signature you provided."
            })
          } as any;
        }
      }

      const service = new TestStsService();
      await expect(
        service.getCallerIdentity(
          { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wrongSecretKey" },
          "us-east-1"
        )
      ).rejects.toThrow(AuthenticationError);
    });

    it("throws CloudAdapterError if AWS returns empty Account ID", async () => {
      class TestStsService extends AwsStsService {
        protected override createStsClient() {
          return {
            send: vi.fn().mockResolvedValue({
              Account: null
            })
          } as any;
        }
      }

      const service = new TestStsService();
      await expect(
        service.getCallerIdentity(
          { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
          "us-east-1"
        )
      ).rejects.toThrow(CloudAdapterError);
    });
  });

  describe("assumeRole with mocked STS client", () => {
    it("rejects invalid role ARN with ValidationError before calling AWS", async () => {
      const service = new AwsStsService();
      await expect(
        service.assumeRole(
          { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "validSecret" },
          "us-east-1",
          { roleArn: "invalid-arn" }
        )
      ).rejects.toThrow(ValidationError);
    });

    it("successfully returns temporary credentials when AssumeRole succeeds", async () => {
      const expirationDate = new Date(Date.now() + 900000);
      class TestStsService extends AwsStsService {
        protected override createStsClient() {
          return {
            send: vi.fn().mockResolvedValue({
              Credentials: {
                AccessKeyId: "ASIAEXAMPLEACCESSKEY",
                SecretAccessKey: "v9JalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                SessionToken: "AQoDYXdzEXAMPLETOKEN",
                Expiration: expirationDate
              },
              AssumedRoleUser: {
                Arn: "arn:aws:sts::123456789012:assumed-role/CloudOpsRole/cloudops-sess",
                AssumedRoleId: "AROAEXAMPLEID:cloudops-sess"
              }
            })
          } as any;
        }
      }

      const service = new TestStsService();
      const result = await service.assumeRole(
        { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "validSecret" },
        "us-east-1",
        { roleArn: "arn:aws:iam::123456789012:role/CloudOpsRole" }
      );

      expect(result.credentials.accessKeyId).toBe("ASIAEXAMPLEACCESSKEY");
      expect(result.credentials.secretAccessKey).toBe("v9JalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
      expect(result.credentials.sessionToken).toBe("AQoDYXdzEXAMPLETOKEN");
      expect(result.credentials.expiration).toEqual(expirationDate);
      expect(result.assumedRoleUser.arn).toBe("arn:aws:sts::123456789012:assumed-role/CloudOpsRole/cloudops-sess");
    });

    it("throws CloudAdapterError when AssumeRole is denied", async () => {
      class TestStsService extends AwsStsService {
        protected override createStsClient() {
          return {
            send: vi.fn().mockRejectedValue({
              name: "AccessDenied",
              message: "User is not authorized to perform: sts:AssumeRole on resource"
            })
          } as any;
        }
      }

      const service = new TestStsService();
      await expect(
        service.assumeRole(
          { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "validSecret" },
          "us-east-1",
          { roleArn: "arn:aws:iam::123456789012:role/UnauthorizedRole" }
        )
      ).rejects.toThrow(CloudAdapterError);
    });
  });
});
