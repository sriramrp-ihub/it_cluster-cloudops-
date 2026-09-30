import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ECSClient, DescribeServicesCommand, DescribeTaskDefinitionCommand, ListTasksCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { ElasticLoadBalancingV2Client, DescribeTargetGroupsCommand, DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { ECRClient, DescribeImagesCommand } from "@aws-sdk/client-ecr";
import { findCanonicalTool } from "@cloudops/tools";
import { generateTenantId } from "@cloudops/shared";

/**
 * Regression coverage for the aws_cloudwatch_get_metric_data fabrication fix
 * (this tool used to invent a 0/100% "ECS-derived" percentage instead of ever
 * calling CloudWatch for the common cluster+service correlation path), plus
 * the two new real tools it depends on for honest ALB/ECR investigation:
 * aws_alb_get_target_health and aws_ecr_describe_images. Every AWS client
 * used by these handlers is mocked at the SDK boundary via aws-sdk-client-mock
 * — no live network calls happen in this file, matching the existing
 * aws_scanner_service.test.ts / aws_provider_adapter.test.ts convention.
 */

const ecsMock = mockClient(ECSClient);
const cwMock = mockClient(CloudWatchClient);
const elbMock = mockClient(ElasticLoadBalancingV2Client);
const ecrMock = mockClient(ECRClient);

const ctx = () => ({ agentId: "test-agent", tenantId: generateTenantId() });

describe("aws_cloudwatch_get_metric_data — real CloudWatch call, honest NO_LOAD_BALANCER (no fabrication)", () => {
  beforeEach(() => {
    ecsMock.reset();
    cwMock.reset();
    elbMock.reset();
  });

  const tool = () => findCanonicalTool("aws_cloudwatch_get_metric_data")!;

  it("explicit dimensions: makes a real CloudWatch GetMetricData call and returns its real datapoints", async () => {
    cwMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [{ Timestamps: [new Date("2026-01-01T00:00:00Z")], Values: [42] }]
    });

    const res: any = await tool().handler(
      {
        metricName: "CPUUtilization",
        namespace: "AWS/ECS",
        period: 300,
        region: "us-east-1",
        dimensions: [{ name: "ClusterName", value: "prod" }],
        lookbackMinutes: 15
      },
      ctx()
    );

    expect(res.derivedFrom).toBe("live:aws:cloudwatch");
    expect(res.alarmState).toBe("OK");
    expect(res.datapoints).toEqual([{ timestamp: "2026-01-01T00:00:00.000Z", average: 42, unit: "Percent" }]);
  });

  it("cluster+service, container-level metric (CPUUtilization): resolves real ClusterName/ServiceName dimensions and calls CloudWatch for real — never fabricates a value", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ desiredCount: 1, runningCount: 1, loadBalancers: [], deployments: [{ failedTasks: 0, rolloutState: "COMPLETED" }] }]
    });
    cwMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [{ Timestamps: [new Date("2026-01-01T00:00:00Z")], Values: [7.5] }]
    });

    const res: any = await tool().handler(
      { metricName: "CPUUtilization", namespace: "AWS/ECS", period: 300, region: "us-east-1", cluster: "cloudops-test", service: "starvision-motors", lookbackMinutes: 15 },
      ctx()
    );

    expect(res.namespace).toBe("AWS/ECS");
    expect(res.derivedFrom).toBe("live:aws:cloudwatch");
    expect(res.dimensions).toEqual([
      { name: "ClusterName", value: "cloudops-test" },
      { name: "ServiceName", value: "starvision-motors" }
    ]);
    expect(res.datapoints[0].average).toBe(7.5);
    expect(res.ecsCorroboration).toMatchObject({ desiredCount: 1, runningCount: 1 });

    const cwCalls = cwMock.commandCalls(GetMetricDataCommand);
    expect(cwCalls).toHaveLength(1);
  });

  it("cluster+service, ALB metric (5XX), service has NO load balancer: returns honest NO_LOAD_BALANCER — the exact starvision-motors bug this fixes, never a fabricated 0%/100%", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ desiredCount: 1, runningCount: 1, loadBalancers: [], deployments: [{ failedTasks: 0, rolloutState: "COMPLETED" }] }]
    });

    const res: any = await tool().handler(
      { metricName: "HTTPCode_Target_5XX_Count", namespace: "AWS/ApplicationELB", period: 300, region: "us-east-1", cluster: "cloudops-test", service: "starvision-motors", lookbackMinutes: 15 },
      ctx()
    );

    expect(res.alarmState).toBe("NO_LOAD_BALANCER");
    expect(res.datapoints).toEqual([]);
    expect(res.note).toMatch(/no associated load balancer/i);
    expect(res.ecsCorroboration).toMatchObject({ desiredCount: 1, runningCount: 1 });
    // Never attempted a CloudWatch call for a metric that cannot exist.
    expect(cwMock.commandCalls(GetMetricDataCommand)).toHaveLength(0);
  });

  it("cluster+service, ALB metric, service DOES have a real target group: resolves the real load balancer ARN and calls CloudWatch with real AWS/ApplicationELB dimensions", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{
        desiredCount: 2,
        runningCount: 2,
        loadBalancers: [{ targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/my-targets/73e2d6bc24d8a067" }],
        deployments: [{ failedTasks: 0, rolloutState: "COMPLETED" }]
      }]
    });
    elbMock.on(DescribeTargetGroupsCommand).resolves({
      TargetGroups: [{ LoadBalancerArns: ["arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/app/my-lb/50dc6c495c0c9188"] }]
    });
    cwMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [{ Timestamps: [new Date("2026-01-01T00:00:00Z")], Values: [0] }]
    });

    const res: any = await tool().handler(
      { metricName: "HTTPCode_Target_5XX_Count", namespace: "AWS/ApplicationELB", period: 300, region: "us-east-1", cluster: "prod", service: "checkout", lookbackMinutes: 15 },
      ctx()
    );

    expect(res.namespace).toBe("AWS/ApplicationELB");
    expect(res.dimensions).toEqual([
      { name: "LoadBalancer", value: "app/my-lb/50dc6c495c0c9188" },
      { name: "TargetGroup", value: "targetgroup/my-targets/73e2d6bc24d8a067" }
    ]);
    expect(res.derivedFrom).toBe("live:aws:cloudwatch");
  });

  it("no cluster/service and no dimensions: unchanged deterministic INSUFFICIENT_DATA fallback (no live call)", async () => {
    const res: any = await tool().handler(
      { metricName: "HTTPCode_Target_5XX_Count", namespace: "AWS/ApplicationELB", period: 300, region: "us-east-1", lookbackMinutes: 15 },
      ctx()
    );
    expect(res.alarmState).toBe("INSUFFICIENT_DATA");
    expect(res.datapoints).toEqual([]);
  });

  it("surfaces a real ECS error rather than falling back to a fabricated value", async () => {
    ecsMock.on(DescribeServicesCommand).rejects(Object.assign(new Error("Cluster not found."), { name: "ClusterNotFoundException" }));

    const res: any = await tool().handler(
      { metricName: "CPUUtilization", namespace: "AWS/ECS", period: 300, region: "us-east-1", cluster: "missing-cluster", service: "svc", lookbackMinutes: 15 },
      ctx()
    );
    expect(res.error).toBe("Cluster not found.");
    expect(res.code).toBe("ClusterNotFoundException");
  });
});

describe("aws_alb_get_target_health — real ELBv2 DescribeTargetHealth, honest NO_LOAD_BALANCER", () => {
  beforeEach(() => {
    ecsMock.reset();
    elbMock.reset();
  });

  const tool = () => findCanonicalTool("aws_alb_get_target_health")!;

  it("explicit targetGroupArn: returns real per-target health state", async () => {
    elbMock.on(DescribeTargetHealthCommand).resolves({
      TargetHealthDescriptions: [
        { Target: { Id: "10.0.1.5", Port: 80 }, TargetHealth: { State: "healthy" } },
        { Target: { Id: "10.0.1.6", Port: 80 }, TargetHealth: { State: "unhealthy", Reason: "Target.ResponseCodeMismatch", Description: "Health checks failed with these codes: [503]" } }
      ]
    });

    const res: any = await tool().handler(
      { targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/my-targets/73e2d6bc24d8a067", region: "us-east-1" },
      ctx()
    );

    expect(res.targetCount).toBe(2);
    expect(res.healthyCount).toBe(1);
    expect(res.unhealthyCount).toBe(1);
    expect(res.targets[1].reason).toBe("Target.ResponseCodeMismatch");
  });

  it("cluster+service resolves the real target group before checking health", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ desiredCount: 1, runningCount: 1, loadBalancers: [{ targetGroupArn: "arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/tg/abc" }] }]
    });
    elbMock.on(DescribeTargetHealthCommand).resolves({
      TargetHealthDescriptions: [{ Target: { Id: "10.0.1.5", Port: 80 }, TargetHealth: { State: "healthy" } }]
    });

    const res: any = await tool().handler({ cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" }, ctx());

    expect(res.targetGroupArn).toBe("arn:aws:elasticloadbalancing:us-east-1:1:targetgroup/tg/abc");
    expect(res.healthyCount).toBe(1);
  });

  it("cluster+service with no load balancer: honest NO_LOAD_BALANCER, no fabricated health data", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ desiredCount: 1, runningCount: 1, loadBalancers: [] }]
    });

    const res: any = await tool().handler({ cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" }, ctx());

    expect(res.status).toBe("NO_LOAD_BALANCER");
    expect(res.targets).toEqual([]);
  });

  it("no targetGroupArn and no cluster+service: honest MISSING_TARGET error", async () => {
    const res: any = await tool().handler({ region: "us-east-1" }, ctx());
    expect(res.code).toBe("MISSING_TARGET");
  });
});

describe("aws_ecr_describe_images — real ECR DescribeImages, catches the exact 'broken tag' scenario", () => {
  beforeEach(() => {
    ecsMock.reset();
    ecrMock.reset();
  });

  const tool = () => findCanonicalTool("aws_ecr_describe_images")!;

  it("explicit repositoryName+imageTag that exists: found:true with real digest/size/push date", async () => {
    ecrMock.on(DescribeImagesCommand).resolves({
      imageDetails: [{ imageDigest: "sha256:abc", imageTags: ["latest"], imageSizeInBytes: 123, imagePushedAt: new Date("2026-01-01T00:00:00Z") }]
    });

    const res: any = await tool().handler({ repositoryName: "starvision-motors", imageTag: "latest", region: "us-east-1" }, ctx());

    expect(res.found).toBe(true);
    expect(res.images[0].imageDigest).toBe("sha256:abc");
  });

  it("a tag that does NOT exist: ECR's real ImageNotFoundException becomes an honest found:false finding, not a generic error or a fabricated value", async () => {
    ecrMock.on(DescribeImagesCommand).rejects(Object.assign(new Error("The image with imageTag=broken does not exist"), { name: "ImageNotFoundException" }));

    const res: any = await tool().handler({ repositoryName: "starvision-motors", imageTag: "broken", region: "us-east-1" }, ctx());

    expect(res.found).toBe(false);
    expect(res.code).toBe("IMAGE_NOT_FOUND");
    expect(res.note).toMatch(/confirmed missing image/i);
  });

  it("cluster+service resolves the exact deployed image from the real task definition, then validates it in ECR", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ taskDefinition: "arn:aws:ecs:us-east-1:265766933076:task-definition/starvision-motors:2" }]
    });
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: {
        containerDefinitions: [{ name: "starvision", image: "265766933076.dkr.ecr.us-east-1.amazonaws.com/starvision-motors:latest" }]
      }
    });
    ecrMock.on(DescribeImagesCommand).resolves({
      imageDetails: [{ imageDigest: "sha256:abc", imageTags: ["latest"] }]
    });

    const res: any = await tool().handler({ cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" }, ctx());

    expect(res.repositoryName).toBe("starvision-motors");
    expect(res.imageTag).toBe("latest");
    expect(res.found).toBe(true);
    const calls = ecrMock.commandCalls(DescribeImagesCommand);
    expect(calls[0]!.args[0].input.repositoryName).toBe("starvision-motors");
  });

  it("a non-ECR image (e.g. public Docker Hub): honestly says it can't validate it, rather than guessing", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [{ taskDefinition: "arn:aws:ecs:us-east-1:1:task-definition/x:1" }]
    });
    ecsMock.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [{ name: "web", image: "nginx:latest" }] }
    });

    const res: any = await tool().handler({ cluster: "c", service: "s", region: "us-east-1" }, ctx());

    expect(res.found).toBeUndefined();
    expect(res.note).toMatch(/not an ECR-hosted image/i);
  });
});

describe("aws_ecs_describe_tasks — real per-task/per-container detail", () => {
  beforeEach(() => {
    ecsMock.reset();
  });

  const tool = () => findCanonicalTool("aws_ecs_describe_tasks")!;

  it("explicit taskArns: returns real container-level status and exit codes", async () => {
    ecsMock.on(DescribeTasksCommand).resolves({
      tasks: [{
        taskArn: "arn:aws:ecs:us-east-1:1:task/cloudops-test/abc",
        lastStatus: "STOPPED",
        containers: [{ name: "starvision", lastStatus: "STOPPED", exitCode: 137, reason: "OutOfMemoryError" }]
      }]
    });

    const res: any = await tool().handler({ cluster: "cloudops-test", taskArns: ["arn:aws:ecs:us-east-1:1:task/cloudops-test/abc"], region: "us-east-1" }, ctx());

    expect(res.taskCount).toBe(1);
    expect(res.tasks[0].containers[0].exitCode).toBe(137);
  });

  it("cluster+service: looks up real current task ARNs first, then describes them", async () => {
    ecsMock.on(ListTasksCommand).resolves({ taskArns: ["arn:aws:ecs:us-east-1:1:task/cloudops-test/xyz"] });
    ecsMock.on(DescribeTasksCommand).resolves({
      tasks: [{ taskArn: "arn:aws:ecs:us-east-1:1:task/cloudops-test/xyz", lastStatus: "RUNNING", containers: [] }]
    });

    const res: any = await tool().handler({ cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" }, ctx());

    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0].lastStatus).toBe("RUNNING");
  });

  it("no tasks found: honest empty result, not an error", async () => {
    ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });

    const res: any = await tool().handler({ cluster: "cloudops-test", service: "idle-service", region: "us-east-1" }, ctx());

    expect(res.tasks).toEqual([]);
    expect(res.note).toMatch(/no matching tasks/i);
  });
});
