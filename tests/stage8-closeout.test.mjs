import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Stage 8 records live qualification and removes one-time infrastructure", () => {
  assert.equal(existsSync("docs/checkpoints/STAGE_8_BROWSER_PROVIDER.md"), true);
  assert.equal(
    existsSync("src/app/api/stage8/live-provider-check/route.ts"),
    false,
  );

  const checkpoint = readFileSync(
    "docs/checkpoints/STAGE_8_BROWSER_PROVIDER.md",
    "utf8",
  );
  assert.match(checkpoint, /Status: \*\*Qualified\*\*/);
  assert.match(checkpoint, /8acd96edfed7f954311117aae6f43a4dfb139da4/);
  assert.match(checkpoint, /dpl_GCX3H5SwtCHHHzjrb1QWbDGSR3p4/);
  assert.match(checkpoint, /The qualification response returned HTTP 200/);
  assert.match(checkpoint, /Stage 9 has not started/);
});
