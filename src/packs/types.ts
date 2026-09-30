import type { JsonObject, JsonValue, QualificationStatus } from "../core/contracts";
import type { WorkerPackManifest } from "../workers/types";

export type PackDependency = { packKey: string; version: string };
export type PackCapability = { key: string; adapter: "structured.mapping" | "web.research" | "image.generate"; description: string };
export type PackKnowledge = {
  key: string; version: string; name: string; source: string;
  verifiedAt: string; freshnessDays: number; content: JsonObject;
};
export type FieldMapping =
  | { source: "input"; key: string }
  | { source: "knowledge"; knowledgeKey: string; key: string }
  | { source: "literal"; value: JsonValue };
export type PackWorker = {
  manifest: WorkerPackManifest;
  execution: { kind: "structured.mapping"; fields: Record<string, FieldMapping> }
    | { kind: "model_router"; routeKey: "standard.default" | "reviewer.independent" }
    | { kind: "web.research"; routeKey: "standard.default" };
};
export type PackStage = {
  key: string; workerKey: string; workerVersion: string; objective: string;
  inputFrom: "workflow" | string; knowledgeKeys: string[];
  permittedCapabilities: string[]; nonGoals: string[]; completionCriteria: JsonObject;
};
export type PackWorkflow = {
  key: string; version: string; name: string; description: string;
  inputSchema: JsonObject; outputSchema: JsonObject; stages: PackStage[];
  sampleInput: JsonObject;
};
export type PackManifest = {
  frameworkVersion: "1.0"; packKey: string; version: string; name: string;
  kind: "capability" | "knowledge" | "worker" | "workflow";
  description: string; dependencies: PackDependency[];
  ui: { category: string; summary: string; supportedBusinessTypes: string[] };
  evals: string[]; capabilities: PackCapability[]; knowledge: PackKnowledge[];
  workers: PackWorker[]; workflows: PackWorkflow[];
};
export type PackRelease = { id: string; status: QualificationStatus; manifest: PackManifest };
export type PackSnapshot = { rootPackId: string; releases: PackRelease[]; workflow: PackWorkflow };
