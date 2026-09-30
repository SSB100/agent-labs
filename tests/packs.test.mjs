import assert from "node:assert/strict";
import test from "node:test";
import registry from "../.core-tests/packs/registry.js";
import dependencies from "../.core-tests/packs/dependencies.js";
import sample from "../.core-tests/packs/sample.js";
import executor from "../.core-tests/packs/executor.js";

const releases=()=>sample.syntheticPackReleases();
const root={packKey:"workflow.synthetic-summary",version:"1.0.0"};
const resolve=(catalog=releases(),pin=root)=>dependencies.resolvePackDependencies(catalog,pin);
test("all four manifest kinds validate and exact dependency closure installs their definitions",()=>{
  const catalog=releases(); for(const release of catalog) registry.validatePackManifest(release.manifest);
  assert.deepEqual(new Set(catalog.map(r=>r.manifest.kind)),new Set(["capability","knowledge","worker","workflow"]));
  const pins=resolve(catalog); assert.equal(pins.length,4);
  assert.equal(pins.at(-1).manifest.packKey,root.packKey);
  assert.equal(pins.flatMap(p=>p.manifest.workers).length,1);
  assert.equal(pins.flatMap(p=>p.manifest.knowledge).length,1);
});
test("missing dependencies, unqualified releases and cycles fail closed",()=>{
  assert.throws(()=>resolve(releases().filter(r=>r.manifest.kind!=="knowledge")),/unavailable/);
  const unqualified=releases(); unqualified[0].status="experimental"; assert.throws(()=>resolve(unqualified),/not qualified/);
  const cyclic=releases(); cyclic[0].manifest.dependencies=[root]; assert.throws(()=>resolve(cyclic),/Circular/);
});
test("conflicting pins and undeclared worker requirements fail closed",()=>{
  const conflicting=releases(); conflicting.find(r=>r.manifest.packKey===root.packKey).manifest.dependencies.push({packKey:"worker.synthetic-summary",version:"2.0.0"});
  assert.throws(()=>resolve(conflicting),/unique exact version pins|Conflicting/);
  const bad=releases(); bad.find(r=>r.manifest.kind==="worker").manifest.workers[0].manifest.capabilityPolicy.allowed.push("shell.execute");
  assert.throws(()=>resolve(bad),/both allowed and forbidden|missing/);
});
test("new catalog entries work without adding Core workflow code and snapshots retain old versions",()=>{
  const catalog=releases(), old=resolve(catalog);
  const newRoot=structuredClone(catalog.find(r=>r.manifest.packKey===root.packKey));
  newRoot.id="00000000-0000-4000-8000-000000001090"; newRoot.manifest.packKey="workflow.another-summary";
  catalog.push(newRoot); assert.equal(resolve(catalog,{packKey:newRoot.manifest.packKey,version:"1.0.0"}).at(-1).id,newRoot.id);
  const current=resolve(catalog,{...root,version:"2.0.0"});
  assert.equal(old.find(r=>r.manifest.kind==="worker").manifest.version,"1.0.0");
  assert.equal(current.find(r=>r.manifest.kind==="worker").manifest.version,"2.0.0");
  catalog[0].manifest.name="Changed catalog"; assert.notEqual(old[0].manifest.name,catalog[0].manifest.name);
});
function context(worker,version="1.0.0") {
  return {taskContract:{id:"00000000-0000-4000-8000-000000001101",objective:"Summarize the supplied input and stop.",
    inputArtifactIds:["00000000-0000-4000-8000-000000001102","00000000-0000-4000-8000-000000001103"],permittedCapabilities:["data.transform"],requiredKnowledge:["synthetic.guide"],
    requiredOutputSchema:worker.manifest.outputSchema,completionCriteria:{requiredDecision:"complete",requiredStopReason:"objective_complete"},failureCriteria:{},nonGoals:["No external actions."],escalationRules:{}},
    inputArtifacts:[{id:"00000000-0000-4000-8000-000000001102",artifactType:"pack.stage-input",name:"Input",mediaType:"application/json",content:{message:`Version ${version}`},metadata:{}},
      {id:"00000000-0000-4000-8000-000000001103",artifactType:"pack.knowledge",name:"Guide",mediaType:"application/json",content:{guidance:"Scoped guide"},metadata:{knowledgeKey:"synthetic.guide"}}]};
}
test("the generic mapping executor produces schema-validated output and versioned receipts",()=>{
  for(const version of ["1.0.0","2.0.0"]) {
    const worker=resolve(releases(),{...root,version}).flatMap(r=>r.manifest.workers)[0];
    const result=executor.executePackMapping(worker,context(worker,version));
    assert.equal(result.output.releaseVersion,version); assert.equal(result.output.summary,`Version ${version}`);
    assert.equal(result.output.guidance,"Scoped guide"); assert.equal(result.receipt.workerVersion,version);
    assert.equal(result.receipt.outputValidated,true);
  }
});
test("missing or unrelated knowledge and arbitrary executors cannot be used",()=>{
  const worker=resolve().flatMap(r=>r.manifest.workers)[0], c=context(worker);
  c.inputArtifacts[1].metadata.knowledgeKey="foreign.guide";
  assert.throws(()=>executor.executePackMapping(worker,c),/Required knowledge/);
  const bad=releases(); bad.find(r=>r.manifest.kind==="worker").manifest.workers[0].execution.kind="shell.execute";
  assert.throws(()=>resolve(bad),/manifest fields|Untrusted/);
});
test("unknown fields, floating versions, unsafe object keys and forward stage references are rejected",()=>{
  const manifest=structuredClone(releases().at(-1).manifest); manifest.script="alert(1)"; assert.throws(()=>registry.validatePackManifest(manifest),/unknown/);
  delete manifest.script; manifest.dependencies[0].version="latest"; assert.throws(()=>registry.validatePackManifest(manifest),/exact version/);
  manifest.dependencies[0].version="2.0.0"; manifest.workflows[0].stages[0].inputFrom="later";
  assert.throws(()=>registry.validatePackManifest(manifest),/earlier stage/);
  assert.throws(()=>registry.validatePackManifest(JSON.parse('{"__proto__":{}}')),/Unsafe object key/);
});
