import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand
} from "@aws-sdk/client-ecs";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import type { AwsSessionCredentials } from "./awsSessionManager.js";
import { logger } from "@cloudops/shared";

export type WorkloadType = "ECS_SERVICE" | "EC2_INSTANCE" | "RDS_DATABASE" | "S3_BUCKET";

export interface DiscoveredWorkload {
  id: string;
  name: string;
  type: WorkloadType;
  cluster?: string | undefined;
  status: "HEALTHY" | "ATTENTION" | "STOPPED" | "PAUSED" | "STARTING";
  region: string;
  desiredCount?: number | undefined;
  runningCount?: number | undefined;
  launchType?: string | undefined;
  taskDefinition?: string | undefined;
  instanceType?: string | undefined;
  ipAddress?: string | undefined;
  createdAt?: string | undefined;
}

export class AwsDiscoveryService {
  /**
   * Comprehensive discovery of all AWS cloud resources in the target region:
   * 1. ECS Container Services (active, paused with desired=0, and draining)
   * 2. EC2 Compute Instances (running, stopped, pending)
   * 3. RDS Relational Databases (available, stopped)
   * 4. S3 Object Storage Buckets
   */
  async discoverWorkloads(
    credentials: AwsSessionCredentials,
    region: string
  ): Promise<DiscoveredWorkload[]> {
    const credsConfig: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    };
    if (credentials.sessionToken) {
      credsConfig.sessionToken = credentials.sessionToken;
    }

    // Comprehensive scan: Primary region first, plus key AWS regions to ensure
    // workloads deployed in Stockholm (eu-north-1), Virginia (us-east-1), Ireland (eu-west-1), etc. are all discovered
    const targetRegions = Array.from(
      new Set([
        region,
        "eu-north-1",
        "us-east-1",
        "us-east-2",
        "us-west-2",
        "eu-west-1",
        "eu-central-1",
        "ap-south-1"
      ].filter(Boolean))
    );

    const workloads: DiscoveredWorkload[] = [];

    // Discover S3 once (global namespace)
    const s3Promise = this.discoverS3(credsConfig, region);

    // Discover regional resources (ECS, EC2, RDS) across target regions concurrently
    const regionalPromises = targetRegions.map(async (reg) => {
      const [ecsRes, ec2Res, rdsRes] = await Promise.allSettled([
        this.discoverEcs(credsConfig, reg),
        this.discoverEc2(credsConfig, reg),
        this.discoverRds(credsConfig, reg)
      ]);

      const regWorkloads: DiscoveredWorkload[] = [];
      if (ecsRes.status === "fulfilled") {
        regWorkloads.push(...ecsRes.value);
      }
      if (ec2Res.status === "fulfilled") {
        regWorkloads.push(...ec2Res.value);
      }
      if (rdsRes.status === "fulfilled") {
        regWorkloads.push(...rdsRes.value);
      }
      return regWorkloads;
    });

    const [s3Result, ...regionalResults] = await Promise.allSettled([s3Promise, ...regionalPromises]);

    if (s3Result.status === "fulfilled") {
      workloads.push(...s3Result.value);
    }

    for (const regRes of regionalResults) {
      if (regRes.status === "fulfilled") {
        workloads.push(...regRes.value);
      }
    }

    // Deduplicate by ID just in case
    const seenIds = new Set<string>();
    return workloads.filter((w) => {
      if (seenIds.has(w.id)) return false;
      seenIds.add(w.id);
      return true;
    });
  }

  /**
   * Discover AWS ECS Clusters and Services (including paused services)
   */
  private async discoverEcs(
    credsConfig: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
    region: string
  ): Promise<DiscoveredWorkload[]> {
    const results: DiscoveredWorkload[] = [];

    try {
      const ecsClient = new ECSClient({
        region,
        credentials: credsConfig
      });

      const listClustersResp = await ecsClient.send(new ListClustersCommand({ maxResults: 100 }));
      const clusterArns = [...(listClustersResp.clusterArns || [])];
      logger.info({ region, clusterArns }, "ECS ListClusters response");

      // Always also check the default cluster if no explicit clusters returned
      if (!clusterArns.some((c) => c.endsWith("/default") || c === "default")) {
        clusterArns.push("default");
      }

      for (const clusterRef of clusterArns) {
        const clusterName = clusterRef.split("/").pop() || clusterRef;

        try {
          const listServicesResp = await ecsClient.send(
            new ListServicesCommand({ cluster: clusterRef, maxResults: 100 })
          );
          const serviceArns = listServicesResp.serviceArns || [];
          logger.info({ clusterRef, serviceArns }, "ECS ListServices response");

          if (serviceArns.length === 0) continue;

          // AWS DescribeServices accepts maximum 10 service names/ARNs per request
          const chunkSize = 10;
          for (let i = 0; i < serviceArns.length; i += chunkSize) {
            const chunk = serviceArns.slice(i, i + chunkSize);
            const describeResp = await ecsClient.send(
              new DescribeServicesCommand({ cluster: clusterRef, services: chunk })
            );

            for (const svc of describeResp.services || []) {
              const desired = svc.desiredCount ?? 0;
              const running = svc.runningCount ?? 0;

              // Accurately determine service status (detect paused vs active vs attention)
              let status: "HEALTHY" | "ATTENTION" | "STOPPED" | "PAUSED" = "HEALTHY";
              if (desired === 0) {
                status = "PAUSED";
              } else if (running === 0 && desired > 0) {
                status = "ATTENTION";
              } else if (running < desired) {
                status = "ATTENTION";
              } else if (svc.status !== "ACTIVE") {
                status = "ATTENTION";
              }

              results.push({
                id: svc.serviceArn || svc.serviceName || `svc_${Math.random()}`,
                name: svc.serviceName || "Unnamed ECS Service",
                type: "ECS_SERVICE",
                cluster: clusterName,
                status,
                region,
                desiredCount: desired,
                runningCount: running,
                launchType: svc.launchType || (svc.capacityProviderStrategy?.length ? "FARGATE" : "EC2"),
                taskDefinition: svc.taskDefinition?.split("/").pop(),
                createdAt: svc.createdAt ? new Date(svc.createdAt).toISOString() : undefined
              });
            }
          }
        } catch (clusterErr: any) {
          // Cluster may not exist or not have permissions; skip silently
          logger.debug({ cluster: clusterRef, err: clusterErr?.message }, "Cluster service listing skipped");
        }
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, region }, "ECS discovery encountered permission or API notice");
    }

    return results;
  }

  /**
   * Discover AWS EC2 Compute Instances (all states)
   */
  private async discoverEc2(
    credsConfig: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
    region: string
  ): Promise<DiscoveredWorkload[]> {
    const results: DiscoveredWorkload[] = [];

    try {
      const ec2Client = new EC2Client({
        region,
        credentials: credsConfig
      });

      const describeResp = await ec2Client.send(new DescribeInstancesCommand({}));

      for (const reservation of describeResp.Reservations || []) {
        for (const inst of reservation.Instances || []) {
          const nameTag = inst.Tags?.find((t) => t.Key === "Name")?.Value;
          const stateName = inst.State?.Name;
          let status: "HEALTHY" | "ATTENTION" | "STOPPED" | "PAUSED" = "HEALTHY";

          if (stateName === "running") {
            status = "HEALTHY";
          } else if (stateName === "stopped") {
            status = "STOPPED";
          } else {
            status = "ATTENTION";
          }

          results.push({
            id: inst.InstanceId || `inst_${Math.random()}`,
            name: nameTag || inst.InstanceId || "Unnamed EC2 Instance",
            type: "EC2_INSTANCE",
            cluster: `EC2 (${inst.Placement?.AvailabilityZone || region})`,
            status,
            region,
            instanceType: inst.InstanceType,
            ipAddress: inst.PrivateIpAddress || inst.PublicIpAddress,
            createdAt: inst.LaunchTime ? new Date(inst.LaunchTime).toISOString() : undefined
          });
        }
      }
    } catch (err: any) {
      logger.debug({ err: err?.message, region }, "EC2 discovery skipped");
    }

    return results;
  }

  /**
   * Discover AWS RDS Relational Databases
   */
  private async discoverRds(
    credsConfig: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
    region: string
  ): Promise<DiscoveredWorkload[]> {
    const results: DiscoveredWorkload[] = [];

    try {
      const rdsClient = new RDSClient({
        region,
        credentials: credsConfig
      });

      const resp = await rdsClient.send(new DescribeDBInstancesCommand({}));

      for (const db of resp.DBInstances || []) {
        const dbStatus = db.DBInstanceStatus?.toLowerCase();
        let status: "HEALTHY" | "ATTENTION" | "STOPPED" | "PAUSED" = "HEALTHY";

        if (dbStatus === "available") {
          status = "HEALTHY";
        } else if (dbStatus === "stopped") {
          status = "STOPPED";
        } else {
          status = "ATTENTION";
        }

        results.push({
          id: db.DBInstanceArn || db.DBInstanceIdentifier || `rds_${Math.random()}`,
          name: db.DBInstanceIdentifier || "Unnamed RDS Database",
          type: "RDS_DATABASE",
          cluster: `RDS (${db.Engine || "Database"})`,
          status,
          region,
          instanceType: db.DBInstanceClass,
          ipAddress: db.Endpoint?.Address,
          createdAt: db.InstanceCreateTime ? new Date(db.InstanceCreateTime).toISOString() : undefined
        });
      }
    } catch (err: any) {
      logger.debug({ err: err?.message, region }, "RDS discovery skipped");
    }

    return results;
  }

  /**
   * Discover AWS S3 Storage Buckets
   */
  private async discoverS3(
    credsConfig: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
    region: string
  ): Promise<DiscoveredWorkload[]> {
    const results: DiscoveredWorkload[] = [];

    try {
      const s3Client = new S3Client({
        region,
        credentials: credsConfig
      });

      const resp = await s3Client.send(new ListBucketsCommand({}));

      for (const bucket of resp.Buckets || []) {
        if (!bucket.Name) continue;
        results.push({
          id: `s3://${bucket.Name}`,
          name: bucket.Name,
          type: "S3_BUCKET",
          cluster: "AWS S3 Storage",
          status: "HEALTHY",
          region,
          createdAt: bucket.CreationDate ? new Date(bucket.CreationDate).toISOString() : undefined
        });
      }
    } catch (err: any) {
      logger.debug({ err: err?.message, region }, "S3 discovery skipped");
    }

    return results;
  }
}
