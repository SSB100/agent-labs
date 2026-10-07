import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SCREEN_CATEGORIES} from '../../.core-tests/creative/types.js';
import {FOCUSED_PHYSICAL_PROPOSAL} from '../../.core-tests/creative/focused-physical-proposal.js';
import {creativeHash} from '../../.core-tests/creative/contracts.js';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';

const design='Create an original leaf, winged seed and pebble in one simple observation-card composition on an intentional opaque square. Keep each subject distinct at six inches and the private small preview; no words, copied references, brands, characters or likenesses.';
const rights='This exact private test uses my original leaf, winged seed and pebble arrangement, without third-party artwork, reference images, brands, characters, text or recognizable likenesses.';
const rationale='The exact original botanical composition uses no third-party reference artwork or protected element in this category.';
const source='https://www.etsy.com/legal/creativity/';
const confirmedFields=['confirmOriginalIntent','confirmProductionScope','confirmPrintSpec','confirmTerms','confirmBudget','confirmPolicyScreen','confirmDataUse'];
const production=fixture=>'/dashboard/artifacts?'+new URLSearchParams({business:fixture().businessId,candidate:fixture().creative.candidateId,panel:'production'});
const approvals=fixture=>'/dashboard/artifacts?'+new URLSearchParams({business:fixture().businessId,panel:'receipts'});
const policyRoute=(fixture,policyId)=>'/dashboard/quests/controls?'+new URLSearchParams({business:fixture().businessId,quest:fixture().goalId,...(policyId?{policy:policyId}:{})});
function recordAdoption(boundary,fixture){const rows=boundary.state().db.product_experiments.filter(row=>row.discovery_version==='r12.focused-adoption.1'&&row.business_id===fixture().businessId);assert.equal(rows.length,1);fixture().creative.candidateId=rows[0].candidate_id;return rows[0].candidate_id;}
function recordInstallation(boundary,fixture){const creative=fixture().creative;assert.match(creative.installationId??'',/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,'Creative install control must return a persisted installation ID before approval');const rows=boundary.state().db.installed_packs.filter(row=>row.id===creative.installationId&&row.business_id===fixture().businessId&&row.root_pack_key==='workflow.etsy-creative-pipeline'&&row.status==='active');assert.equal(rows.length,1,'Creative install control must create one active exact-Business installation');assert.equal(creative.installationReceipt.installationId,rows[0].id);assert.equal(creative.installationReceipt.authorityCreated,false);assert.equal(creative.installationReceipt.shouldDispatch,false);}
function recordApproval(boundary,fixture){const rows=boundary.state().db.creative_approvals.filter(row=>row.candidate_id===fixture().creative.candidateId);assert.equal(rows.length,1);const row=rows[0];assert.deepEqual(row.snapshot.printSpecification,FOCUSED_PHYSICAL_PROPOSAL);assert.equal(row.snapshot.focusedPilotBinding.physicalSpecificationHash,creativeHash(FOCUSED_PHYSICAL_PROPOSAL));assert.equal(row.snapshot.focusedPilotBinding.creativeInstallationId,fixture().creative.installationId);assert.equal(row.snapshot.maximumGenerations,1);assert.equal(row.snapshot.publicationAllowed,false);assert.equal(row.quote.providerBinding.ownerAcknowledged,true);fixture().creative.approvalId=row.id;return row.id;}
function fillForm(form,fixture){form.set('designInstructions',design);form.set('rightsStatement',rights);form.set('creativeInstallationId',fixture().creative.installationId);form.set('generatorModel','black-forest-labs/flux.2-klein-4b');form.set('maximumGenerations','1');form.set('budgetUsd','0.1');for(const name of confirmedFields)form.set(name,'on');for(const category of SCREEN_CATEGORIES){form.set(`rationale_${category}`,rationale);form.set(`sources_${category}`,source);}return form;}
function assertPrivateReceipt(prepared,fixture){assert.equal(prepared.approvalId,fixture().creative.approvalId);assert.equal(prepared.businessId,fixture().businessId);assert.equal(prepared.goalId,fixture().goalId);assert.equal(prepared.dispatchAuthorized,false);assert.match(prepared.admissionKeyHash,/^[a-f0-9]{64}$/);assert.match(prepared.runtimeCapabilityHash,/^[a-f0-9]{64}$/);assert.equal(prepared.runtimeCapability,undefined);assert.equal(prepared.admissionKey,undefined);}
const assertNoCreativeEffects=fixture=>{assert.deepEqual(fixture().creative.launches,[]);assert.deepEqual(fixture().calls,['strategy','review']);};
function assertPreparedRun(boundary,fixture,prepared){
 assertPrivateReceipt(prepared,fixture);
 const db=boundary.state().db,runs=db.creative_runs.filter(row=>row.approval_id===prepared.approvalId);assert.equal(runs.length,1);
 assert.equal(runs[0].id,prepared.creativeRunId);assert.equal(runs[0].business_id,prepared.businessId);assert.equal(runs[0].workflow_run_id,prepared.workflowRunId);
 const workflows=db.workflow_runs.filter(row=>row.id===prepared.workflowRunId);assert.equal(workflows.length,1);assert.equal(workflows[0].business_id,prepared.businessId);assert.equal(workflows[0].goal_id,prepared.goalId);
 assert.equal(db.creative_approvals.find(row=>row.id===prepared.approvalId)?.approval_hash,prepared.approvalHash);
}
// Details are restored by the retained workspace after hydration. Clicking an
// already restored-open summary would close the exact run and hide its controls.
export async function openR12CreativeDisclosure(disclosure){
 await disclosure.waitFor();
 if(await disclosure.getAttribute('open')===null)await disclosure.locator(':scope > summary').click();
 assert.notEqual(await disclosure.getAttribute('open'),null,'The exact creative disclosure must be open');
 return disclosure;
}
export async function r12CreativeControls(page,approvalId,creativeRunId=null){
 const workspace=page.locator('[data-retained-active="true"][data-retained-ready="true"][aria-label="Approvals & receipts details"]');
 await workspace.waitFor();
 const panel=await openR12CreativeDisclosure(workspace.locator(`#creative-${creativeRunId?`run-${creativeRunId}`:`approval-${approvalId}`}`));
 const controls=panel.locator('section[aria-label="Focused production run controls"]');await controls.waitFor();
 assert.equal(await controls.count(),1);assert.equal(await controls.locator('form input[name="approvalId"]').first().inputValue(),approvalId);
 return controls;
}
export async function preparedReceipt(controls){
 await controls.getByRole('button',{name:'Recover prepared creative run',exact:true}).waitFor();
 const disclosure=controls.locator('details');assert.equal(await disclosure.count(),1,'The exact run controls must contain one setup receipt disclosure');
 assert.equal(await disclosure.locator(':scope > summary').textContent(),'Nonsecret creative setup receipt');
 await openR12CreativeDisclosure(disclosure);
 return JSON.parse(await controls.getByRole('textbox',{name:'Creative setup receipt',exact:true}).inputValue());
}
async function exactCreativeAction(page,controls,approvalId,name,action,settled){
 const button=controls.getByRole('button',{name,exact:true});await button.waitFor();
 assert.equal(await button.count(),1);assert.equal(await page.getByRole('button',{name,exact:true}).count(),1,'The exact approval must own the only matching action');
 assert.equal(await button.locator('xpath=..').locator('input[name="approvalId"]').inputValue(),approvalId);
 await action(name,settled);
}

export async function runR12CreativeOwnerHttp({boundary,fixture,control,check,read,post,progress,receipt,noKeyOrigin}){
 let prepared,startForm;
 await check('Focused TEST uses the actual adoption form and explicit production approval without creative execution',async()=>{
  const route=progress(),form=renderedResearchForm(await read(route),'Adopt focused TEST',fixture().scopeId);form.set('reviewed','on');const adopted=await post(route,form);assert.match(researchHtmlText(adopted),/exact independently reviewed TEST is recorded/);recordAdoption(boundary,fixture);
  await post(route,form);recordAdoption(boundary,fixture);assertNoCreativeEffects(fixture);
  assert.equal(fixture().creative.installationId,null);await control({r12CreativeInstall:{candidateId:fixture().creative.candidateId}});recordInstallation(boundary,fixture);assertNoCreativeEffects(fixture);
  const html=await read(production(fixture));assert.match(researchHtmlText(html),/Explicit focused print specification/);assert.match(researchHtmlText(html),/6 × 6-inch square/);
  const approval=fillForm(renderedResearchForm(html,'Save candidate creative approval',fixture().creative.candidateId),fixture);
  const missingSpec=new FormData();for(const[key,value]of approval)if(key!=='confirmPrintSpec')missingSpec.append(key,value);await post(production(fixture),missingSpec);assert.equal(boundary.state().db.creative_approvals.filter(row=>row.candidate_id===fixture().creative.candidateId).length,0);
  const saved=await post(production(fixture),approval),notices=[...saved.matchAll(/<p\b[^>]*role="(?:status|alert)"[^>]*>([\s\S]*?)<\/p>/g)].map(match=>researchHtmlText(match[1]).slice(0,600));assert.ok(/Separate candidate creative approval saved/.test(researchHtmlText(saved)),`Creative approval did not confirm success; visible feedback: ${JSON.stringify(notices)}`);recordApproval(boundary,fixture);assert.equal(fixture().creative.catalogReads,7);assertNoCreativeEffects(fixture);
 });
 await check('Focused Prepare recovers the same run and Start rejects absent operator enrollment',async()=>{
  const route=approvals(fixture),html=await read(route),form=renderedResearchForm(html,'Prepare focused creative run',fixture().creative.approvalId);
  await post(route,form,noKeyOrigin);assert.equal(boundary.state().db.creative_runs.filter(row=>row.approval_id===fixture().creative.approvalId).length,0);
  const ready=await post(route,form);prepared=receipt(ready,'Creative setup receipt');assertPrivateReceipt(prepared,fixture);assert.deepEqual(receipt(await post(route,form),'Creative setup receipt'),prepared);
  assert.equal(boundary.state().db.creative_runs.filter(row=>row.approval_id===prepared.approvalId).length,1);startForm=renderedResearchForm(ready,'Start scoped production design',prepared.approvalId);
  assert.match(researchHtmlText(await post(route,startForm)),/exact scoped permission could not be verified/);assertNoCreativeEffects(fixture);
 });
 await check('Focused exact financial recipe and owner confirmation enable one launch and preserve the existing workflow',async()=>{
  await control({r12CreativeStage:prepared});const policy=fixture().creative.staged.operatingPolicy;assert.equal(policy.maximumDispatches,4);
  const proposed=await r12OwnerRpc(boundary.state(),'r05_policy_owner',{p_business_id:fixture().businessId,p_operation:'propose',p_payload:policy,p_submission_id:randomUUID()});assert.equal(proposed.error,null);
  const confirmed=await r12OwnerRpc(boundary.state(),'r05_policy_owner',{p_business_id:fixture().businessId,p_operation:'confirm',p_payload:{policyId:proposed.data.id,policyHash:proposed.data.hash},p_submission_id:randomUUID()});assert.equal(confirmed.error,null);
  await control({r12CreativeActivate:{policyId:proposed.data.id,policyHash:proposed.data.hash}});assertNoCreativeEffects(fixture);
  assert.match(researchHtmlText(await post(approvals(fixture),startForm)),/approved four-phase workflow has started/);assert.deepEqual(fixture().creative.launches,[prepared.creativeRunId]);
  assert.match(researchHtmlText(await post(approvals(fixture),startForm)),/already claimed/);assert.deepEqual(fixture().creative.launches,[prepared.creativeRunId]);
  const workflow=boundary.state().db.workflow_runs.find(row=>row.id===prepared.workflowRunId);assert.equal(workflow.status,'running');assert.equal(workflow.goal_id,fixture().goalId);assert.match(researchHtmlText(await read(`/dashboard/workflows/${prepared.workflowRunId}?business=${fixture().businessId}`)),/brief:1|Brief|running/i);
 });
}

export async function runR12CreativeOwnerBrowser({boundary,fixture,control,check,page,action,origin,progress,output}){
 let prepared;
 await check('Hydrated historical TEST adoption leads to an exact separately approved physical design',async()=>{
  await page.goto(origin+progress());await page.getByRole('checkbox',{name:/I reviewed this focused TEST/}).check();await action('Adopt focused TEST',()=>page.getByRole('link',{name:'Review the production design approval',exact:true}).waitFor());recordAdoption(boundary,fixture);
  assert.equal(fixture().creative.installationId,null);await control({r12CreativeInstall:{candidateId:fixture().creative.candidateId}});recordInstallation(boundary,fixture);assertNoCreativeEffects(fixture);
  await page.getByRole('link',{name:'Review the production design approval',exact:true}).click();const choice=page.locator('.creativeProductionChoice').filter({has:page.locator(`input[name="candidateId"][value="${fixture().creative.candidateId}"]`)});await choice.locator('summary').click();const form=choice.locator('form');
  await form.getByRole('combobox',{name:'Installed creative workflow',exact:true}).selectOption(fixture().creative.installationId);await form.getByRole('textbox',{name:'Exact original design instructions',exact:true}).fill(design);await form.getByRole('textbox',{name:'Concept-specific originality and rights statement',exact:true}).fill(rights);
  for(const category of SCREEN_CATEGORIES){await form.locator(`[name="rationale_${category}"]`).fill(rationale);await form.locator(`[name="sources_${category}"]`).fill(source);}
  await form.locator('[name="generatorModel"]').selectOption('black-forest-labs/flux.2-klein-4b');await form.locator('[name="maximumGenerations"]').selectOption('1');await form.locator('[name="budgetUsd"]').fill('0.1');
  for(const name of confirmedFields)await form.locator(`[name="${name}"]`).check();
  for(const[width,height]of[[1280,900],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-creative-approval-${width}.png`),fullPage:true});}
  await action('Save candidate creative approval',()=>page.getByText(/Separate candidate creative approval saved/).waitFor());recordApproval(boundary,fixture);assertNoCreativeEffects(fixture);
 });
 await check('Hydrated focused Prepare survives refresh and cannot Start before exact financial activation',async()=>{
  await page.goto(origin+approvals(fixture));let controls=await r12CreativeControls(page,fixture().creative.approvalId);
  await exactCreativeAction(page,controls,fixture().creative.approvalId,'Prepare focused creative run',action,()=>controls.getByText('Nonsecret creative setup receipt',{exact:true}).waitFor());
  prepared=await preparedReceipt(controls);assertPreparedRun(boundary,fixture,prepared);
  await page.reload();controls=await r12CreativeControls(page,prepared.approvalId,prepared.creativeRunId);
  await exactCreativeAction(page,controls,prepared.approvalId,'Prepare focused creative run',action,()=>controls.getByText('Nonsecret creative setup receipt',{exact:true}).waitFor());
  assert.deepEqual(await preparedReceipt(controls),prepared);assertPreparedRun(boundary,fixture,prepared);
  await exactCreativeAction(page,controls,prepared.approvalId,'Start scoped production design',action,()=>controls.getByText(/exact scoped permission could not be verified/).waitFor());assertNoCreativeEffects(fixture);
  assert.deepEqual(await preparedReceipt(controls),prepared);
 });
 await check('Hydrated exact four-call financial confirmation and Start launch once after research Stop',async()=>{
  await control({r12CreativeStage:prepared});const policy=fixture().creative.staged.operatingPolicy;assert.equal(policy.maximumDispatches,4);assert.equal(policy.goalId,prepared.goalId);assert.deepEqual(policy.operations.map(operation=>operation.operationKey),['brief','generate','review','screen'].map(phase=>`creative.r12.${prepared.approvalId}.${phase}`));assert.ok(policy.operations.every(operation=>operation.installationId===fixture().creative.installationId));await page.goto(origin+policyRoute(fixture));await page.getByText(/^Propose financial authority for /).click();
  for(const[name,value]of Object.entries({businessLimit:String(Number(policy.businessLifetimeLimitMicrounits)/1e6),policyLimit:String(Number(policy.policyLimitMicrounits)/1e6),maximumDispatches:'4',minimumIntervalSeconds:String(policy.minimumIntervalSeconds),startsAt:new Date(policy.startsAt).toISOString(),expiresAt:new Date(policy.expiresAt).toISOString()}))await page.locator(`input[name="${name}"]`).fill(value);
  for(const operation of policy.operations)await page.getByRole('checkbox',{name:new RegExp(operation.operationKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).check();
  await action('Save proposal for review',()=>page.getByText(/awaiting confirmation/).waitFor());
  const policies=await r12OwnerRpc(boundary.state(),'r05_admission_read',{p_business_id:fixture().businessId,p_policy_id:null,p_limit:20,p_offset:0});assert.equal(policies.error,null);const proposed=policies.data.policies.filter(row=>row.policy.operations.some(operation=>operation.operationKey.startsWith(`creative.r12.${prepared.approvalId}.`)));assert.equal(proposed.length,1);assert.deepEqual(proposed[0].policy,policy);assert.equal(proposed[0].confirmed,false);
  await page.goto(origin+policyRoute(fixture,proposed[0].id));await page.getByRole('checkbox',{name:'I reviewed this exact financial permission, its scope, exposure and expiry.',exact:true}).check();await action('Confirm this exact policy',()=>page.getByText(/confirmed; dispatch remains gated/).waitFor());
  const confirmed=await r12OwnerRpc(boundary.state(),'r05_admission_read',{p_business_id:fixture().businessId,p_policy_id:proposed[0].id,p_limit:20,p_offset:0});assert.equal(confirmed.error,null);assert.equal(confirmed.data.policies.length,1);assert.deepEqual(confirmed.data.policies[0],{...proposed[0],confirmed:true});
  await control({r12CreativeActivate:{policyId:proposed[0].id,policyHash:proposed[0].hash}});assertNoCreativeEffects(fixture);
  const activated=fixture().creative.activated;for(const key of ['businessId','approvalId','creativeRunId','workflowRunId'])assert.equal(activated[key],prepared[key]);assert.equal(activated.policyId,proposed[0].id);assert.equal(activated.policyHash,proposed[0].hash);assert.equal(activated.shouldDispatch,false);assert.equal(activated.providerCalls,0);
  await page.goto(origin+approvals(fixture));const controls=await r12CreativeControls(page,prepared.approvalId,prepared.creativeRunId);
  await exactCreativeAction(page,controls,prepared.approvalId,'Prepare focused creative run',action,()=>controls.getByText('Nonsecret creative setup receipt',{exact:true}).waitFor());
  assert.deepEqual(await preparedReceipt(controls),prepared);assertPreparedRun(boundary,fixture,prepared);assertNoCreativeEffects(fixture);
  await exactCreativeAction(page,controls,prepared.approvalId,'Start scoped production design',action,()=>controls.getByText(/approved four-phase workflow has started/).waitFor());assert.deepEqual(fixture().creative.launches,[prepared.creativeRunId]);assert.deepEqual(await preparedReceipt(controls),prepared);
  await exactCreativeAction(page,controls,prepared.approvalId,'Start scoped production design',action,()=>controls.getByText(/already claimed/).waitFor());assert.deepEqual(fixture().creative.launches,[prepared.creativeRunId]);assert.deepEqual(await preparedReceipt(controls),prepared);assertPreparedRun(boundary,fixture,prepared);
  assert.equal(boundary.state().db.events.filter(row=>row.workflow_run_id===prepared.workflowRunId&&row.event_type==='r12.focused.creative.launch_claimed').length,1);
  const workflowLink=controls.getByRole('link',{name:'Inspect the exact creative workflow',exact:true});assert.equal(await workflowLink.getAttribute('href'),`/dashboard/workflows/${prepared.workflowRunId}?business=${prepared.businessId}`);await workflowLink.click();await page.waitForURL(`**/dashboard/workflows/${prepared.workflowRunId}**`);assert.equal(new URL(page.url()).searchParams.get('business'),prepared.businessId);
  for(const[width,height]of[[1280,900],[390,844],[320,800]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-creative-workflow-${width}.png`),fullPage:true});}
  assert.deepEqual(fixture().calls,['strategy','review']);assert.equal(boundary.state().db.workflow_runs.find(row=>row.id===prepared.workflowRunId).status,'running');
 });
}
