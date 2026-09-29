import type { WorkerInvocationContext, WorkerPackManifest } from "../workers/types";
import type { ModelMessage } from "./types";

export function buildWorkerModelMessages(
  manifest: WorkerPackManifest,
  context: WorkerInvocationContext,
): readonly ModelMessage[] {
  const system = [
    `Role: ${manifest.worker.role}`,
    `Charter: ${manifest.worker.charter}`,
    ...manifest.instructions.map((instruction) => `Instruction: ${instruction}`),
    "Return only the JSON object required by the supplied response schema.",
    "Do not request, infer or rely on conversation history, credentials, secrets, unreferenced artifacts or capabilities outside the Task Contract.",
  ].join("\n");

  const user = JSON.stringify(
    {
      taskContract: context.taskContract,
      inputArtifacts: context.inputArtifacts,
    },
    null,
    2,
  );

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
