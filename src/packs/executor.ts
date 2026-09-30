import { executeWorkerPack } from "../workers/runtime";
import type { WorkerInvocationContext } from "../workers/types";
import type { JsonObject } from "../core/contracts";
import type { PackWorker } from "./types";

export function executePackMapping(worker: PackWorker, context: WorkerInvocationContext) {
  if (worker.execution.kind !== "structured.mapping") throw new Error("Mapping executor required.");
  const fields = worker.execution.fields;
  return executeWorkerPack(worker.manifest, () => {
    const output: JsonObject = {};
    const input = context.inputArtifacts.find(a=>a.artifactType === "pack.stage-input")?.content;
    for (const [field,mapping] of Object.entries(fields)) {
      let value;
      if (mapping.source === "literal") value = mapping.value;
      else if (mapping.source === "input") value = input?.[mapping.key];
      else {
        const artifact = context.inputArtifacts.find(a=>a.metadata.knowledgeKey === mapping.knowledgeKey);
        value = artifact?.content[mapping.key];
      }
      if (value === undefined) throw new Error(`Required mapping value is absent: ${field}.`);
      Object.defineProperty(output, field, { value, enumerable: true });
    }
    return output;
  }, context);
}
