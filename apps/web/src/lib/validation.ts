import { z } from "zod";

export const agentBasicSchema = z.object({
  name: z.string().min(1, "Agent name is required").max(100, "Agent name cannot exceed 100 characters"),
  type: z.enum(["hermes", "openclaw", "custom"]),
  description: z.string().optional()
});

export type AgentBasicFormValues = z.infer<typeof agentBasicSchema>;

export const hermesAdapterSchema = z.object({
  gatewayUrl: z.string().url("Valid URL required").default("http://host.docker.internal:8642"),
  apiKey: z.string().min(1, "API Key is required"),
  paperclipUrl: z.string().url("Valid URL required").default("http://host.docker.internal:3100"),
  sessionKeyStrategy: z.enum(["scoped", "shared", "static"]).default("scoped"),
  timeoutSeconds: z.number().min(1).default(1800),
  eventReconnectMs: z.number().min(100).default(2000),
  allowRemoteHttp: z.boolean().default(false),
  extraHeaders: z.record(z.string()).default({})
});

export type HermesAdapterFormValues = z.infer<typeof hermesAdapterSchema>;

export const openclawAdapterSchema = z.object({
  openclawUrl: z.string().url("Valid URL required").default("http://localhost:8080"),
  apiKey: z.string().min(1, "API Key is required"),
  wsUrl: z.string().default("ws://localhost:8080/ws"),
  timeoutSeconds: z.number().default(1800)
});

export type OpenClawAdapterFormValues = z.infer<typeof openclawAdapterSchema>;

export const customAdapterSchema = z.object({
  configJson: z.string().refine((val) => {
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, "Must be valid JSON string")
});

export type CustomAdapterFormValues = z.infer<typeof customAdapterSchema>;

export const trustSchema = z.object({
  preset: z.enum(["standard", "restricted", "admin"]),
  customCapabilities: z.array(z.string()).optional()
});

export type TrustFormValues = z.infer<typeof trustSchema>;

export const skillsSchema = z.object({
  selectedSkillIds: z.array(z.string()).default([])
});

export type SkillsFormValues = z.infer<typeof skillsSchema>;
