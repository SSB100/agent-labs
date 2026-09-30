import type { JsonObject } from "../core/contracts";
import type { PackManifest, PackRelease } from "./types";

const inputSchema: JsonObject = { type: "object", additionalProperties: false,
  required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 500 } } };
const outputSchema: JsonObject = { type: "object", additionalProperties: false,
  required: ["decision","summary","guidance","releaseVersion","stopReason"], properties: {
    decision: { type: "string", const: "complete" }, summary: { type: "string", minLength: 1 },
    guidance: { type: "string", minLength: 1 }, releaseVersion: { type: "string" },
    stopReason: { type: "string", const: "objective_complete" },
  } };
function base(packKey: string, kind: PackManifest["kind"], version = "1.0.0"): PackManifest {
  return { frameworkVersion: "1.0", packKey, kind, version, name: "Synthetic summary",
    description: "Proves installable definitions, scoped knowledge, and pinned versions.", dependencies: [],
    ui: { category: "Qualification", summary: "Create a summary from a supplied message and scoped guidance.", supportedBusinessTypes: ["all"] },
    evals: ["manifest","dependencies","scope","version-pinning","worker-output"],
    capabilities: [], knowledge: [], workers: [], workflows: [] };
}
export function syntheticPackManifests(): PackManifest[] {
  const capability = base("capability.synthetic-transform","capability");
  capability.name = "Structured transform";
  capability.capabilities = [{ key: "data.transform", adapter: "structured.mapping", description: "Map structured input without external access." }];
  const knowledge = base("knowledge.synthetic-guide","knowledge");
  knowledge.name = "Synthetic guidance";
  knowledge.knowledge = [{ key: "synthetic.guide", version: "1.0.0", name: "Bounded summary guidance",
    source: "fixture://agent-labs/stage10", verifiedAt: "2026-09-30T00:00:00Z", freshnessDays: 3650,
    content: { guidance: "Use only the supplied message. Stop once the summary is complete." } }];
  const releases: PackManifest[] = [capability,knowledge];
  for (const version of ["1.0.0","2.0.0"]) {
    const worker = base("worker.synthetic-summary","worker",version);
    worker.dependencies = [ {packKey: capability.packKey,version: capability.version}, {packKey: knowledge.packKey,version: knowledge.version} ];
    worker.workers = [{ manifest: { manifestVersion: "1.0",packKey:worker.packKey,version,name:worker.name,
      worker: {workerKey:"synthetic.summary",version,role:"Summary Worker",charter:"Return one scoped summary then stop."},
      inputSchema: {type:"object"},outputSchema,
      capabilityPolicy:{allowed:["data.transform"],forbidden:["shell.execute","money.spend","marketplace.publish"]},
      knowledgeRequirements:["synthetic.guide"],modelRequirements:{executionMode:"structured.mapping"},
      instructions:["Copy the supplied message and scoped guidance; perform no external action."],
      examples:[{name:"bounded summary",input:{message:"Pack framework proof"},expectedOutput:{decision:"complete",summary:"Pack framework proof",guidance:"Use only the supplied message. Stop once the summary is complete.",releaseVersion:version,stopReason:"objective_complete"}}],
      negativeExamples:[{name:"unscoped knowledge",forbiddenBehaviour:"Read unrelated Business data or undeclared knowledge.",reason:"Only Task Contract artifacts are authorized."}],
      escalationPolicy:{invalidInput:"fail_task"}},
      execution:{kind:"structured.mapping",fields:{decision:{source:"literal",value:"complete"},summary:{source:"input",key:"message"},
        guidance:{source:"knowledge",knowledgeKey:"synthetic.guide",key:"guidance"},releaseVersion:{source:"literal",value:version},stopReason:{source:"literal",value:"objective_complete"}}}}];
    const workflow = base("workflow.synthetic-summary","workflow",version);
    workflow.dependencies=[{packKey:worker.packKey,version}];
    workflow.workflows=[{key:"synthetic.installed-summary",version,name:"Installed pack summary",description:workflow.description,
      inputSchema,outputSchema,sampleInput:{message:"Pack framework proof"},stages:[{key:"summary",workerKey:"synthetic.summary",workerVersion:version,
        objective:"Summarize only the supplied message using the scoped synthetic guidance, then stop.",inputFrom:"workflow",knowledgeKeys:["synthetic.guide"],
        permittedCapabilities:["data.transform"],nonGoals:["Read unrelated Business data.","Publish or perform external actions."],
        completionCriteria:{requiredDecision:"complete",requiredStopReason:"objective_complete"}}]}];
    releases.push(worker,workflow);
  }
  return releases;
}
export function syntheticPackReleases(): PackRelease[] {
  return syntheticPackManifests().map((manifest,index)=>({id:`00000000-0000-4000-8000-${String(1001+index).padStart(12,"0")}`,status:"qualified",manifest}));
}
