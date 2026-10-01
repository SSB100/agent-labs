import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(path, "utf8");
test("Products workspace exposes requested views and accurate provisional scope", () => {
  const ui = read("src/components/stage13/products-workspace.tsx");
  for (const view of ["Candidates", "Evidence", "Decisions", "Registry"]) assert.ok(ui.includes(`"${view}"`));
  assert.match(ui, /Weighted total:.*\/ 100/); assert.doesNotMatch(ui, /\/ 45/);
  assert.match(ui, /Unknown is not zero/); assert.match(ui, /Not live qualified/);
  assert.match(ui, /No creative production · No publication/);
  assert.match(ui, /ownerRightsConfirmed/); assert.match(ui, /not independent legal or IP clearance/);
  assert.match(ui, /US\$1 per-experiment allowance/); assert.match(ui, /not guaranteed invoice caps/);
  assert.match(ui, /getUTC|toISOString/); assert.match(ui, /UTC/);
  assert.match(ui, /ArrowRight/); assert.match(ui, /aria-controls/); assert.match(ui, /useFormStatus/);
});
test("Workflow Products preserves experiment scope, and running state is bound before providers", () => {
  const data = read("src/products/data.ts"), runtime = read("src/workflows/installed-pack-runtime-steps.ts");
  assert.match(data, /decisionQuery\.in\("experiment_id", experiments\.map/);
  assert.match(runtime, /p_operation: "scope"/);
  assert.match(runtime, /scoped\.data\?\.experimentId!==productScope\.experimentId/);
  assert.match(read("src/components/stage7/app-shell.tsx"), /href: "\/dashboard\/products"/);
  assert.match(read("src/components/stage7/live-refresh.tsx"), /product_candidates/);
  assert.match(read("src/components/stage7/workflow-workspace.tsx"), /<ProductsWorkspace data=\{productData\}/);
});
