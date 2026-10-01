import type { JsonObject } from "../core/contracts";
import { scoreWorkerEvaluationResults } from "../evaluations/runner";
import type { WorkerEvaluationCase, WorkerEvaluationCaseResult, WorkerEvaluationSuite } from "../evaluations/types";
import { hash } from "../etsy/contracts";
import { projectProviderJsonSchema } from "../models/openrouter";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import { LISTING_DIMENSIONS, LISTING_PROPOSAL_SCHEMA, LISTING_REVIEW_SCHEMA, assembleListingProduct, listingFactsHash, listingImageReviewHash, listingProposalSchema, validateListingInput, validateListingProposal, validateListingReview } from "./contracts";
import { listingFixture, listingFixtureId } from "./fixtures";
import { assertReviewedListing, prepareListingTask, reviewListing } from "./runtime";
import { listingWorker } from "./packs";

type Fixture = ReturnType<typeof listingFixture>;
type Case = { key: string; category: WorkerEvaluationCase["category"]; run: (f: Fixture) => void };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function reject(action: () => void, expected: RegExp) { try { action(); } catch (error) { check(error instanceof Error && expected.test(error.message),"Unexpected rejection"); return; } throw new Error("Expected rejection was accepted"); }
const cases: Case[] = [
  {key:"full-proposal-and-independent-review",category:"positive_example",run:f=>{const r=f.record();check(r.review.verdict==="APPROVE" && r.publicationAllowed===false,"Invalid synthetic review");}},
  {key:"provider-and-local-schema-parity",category:"schema",run:f=>{for(const [schema,value] of [[listingProposalSchema(f.input),f.proposal],[LISTING_REVIEW_SCHEMA,f.review]] as const){const normalized=JSON.parse(JSON.stringify(value,(_key,v)=>v && typeof v === "object" && !Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v));assertJsonSchemaValue(schema,normalized,"Local fixture");assertJsonSchemaValue(projectProviderJsonSchema(schema),normalized,"Projected fixture");}}},
  {key:"title-and-tag-platform-bounds",category:"schema",run:f=>{f.proposal.title.text="x".repeat(141);reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);f.proposal.title.text="White shirt";f.proposal.tags[0].text="x".repeat(21);reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);}},
  {key:"description-fact-coverage",category:"negative_example",run:f=>{f.proposal.description[0].factIds=[];reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);}},
  {key:"tags-duplicate-rejection",category:"negative_example",run:f=>{f.proposal.tags[1]={...f.proposal.tags[0],text:f.proposal.tags[0].text.toUpperCase()};reject(()=>validateListingProposal(f.input,f.proposal,f.now),/duplicate_listing_tags/);}},
  {key:"attributes-cannot-change",category:"negative_example",run:f=>{f.proposal.attributes.materials=["organic cotton"];reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);}},
  {key:"image-order-exact-assets",category:"negative_example",run:f=>{f.proposal.imageOrder=[listingFixtureId(99)];reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);}},
  {key:"raw-artwork-is-not-mockup",category:"negative_example",run:f=>{f.input.imagery[0].kind="raw_artwork";reject(()=>validateListingInput(f.input,f.now),/finished_product_image_required/);}},
  {key:"personalized-first-real-photo",category:"negative_example",run:f=>{f.input.productType="personalized";f.input.product.productFactsHash=listingFactsHash(f.input);f.input.imagery[0].productFactsHash=f.input.product.productFactsHash;f.input.imagery[0].reviewResultHash=listingImageReviewHash(f.input.imagery[0]);reject(()=>validateListingProposal(f.input,f.proposal,f.now),/personalized_first_photo_required/);}},
  {key:"required-disclosures-in-rendered-description",category:"positive_example",run:f=>{const p=assembleListingProduct(f.input,f.proposal,f.now);for(const d of f.input.disclosures)check(p.description.includes(d.text),"Required disclosure omitted");check(hash(p.properties)===hash(f.input.product.properties),"Physical attributes changed");}},
  {key:"ai-disclosure-cannot-drop",category:"negative_example",run:f=>{f.proposal.disclosureKeys=["production_partner"];reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);}},
  {key:"invented-fact-reference",category:"negative_example",run:f=>{f.proposal.title.factIds=["invented-certification"];reject(()=>validateListingProposal(f.input,f.proposal,f.now),/JSON schema/);}},
  {key:"substantive-review-rejects-unsupported-claim",category:"negative_example",run:f=>{f.proposal.description[0].text="Certified organic cotton with guaranteed delivery tomorrow.";f.review.checks.factualClaims={status:"failed",rationale:"The product facts provide no organic certification or guaranteed delivery commitment."};f.review.verdict="REJECT";check(f.record().review.verdict==="REJECT","Rejected review lost");reject(()=>assertReviewedListing(f.record(),assembleListingProduct(f.input,f.proposal,f.now),f.now),/live_listing_review_required/);}},
  {key:"unknown-evidence-stops-approval",category:"negative_example",run:f=>{f.review.checks.factualClaims={status:"needs_evidence",rationale:"The referenced garment fact does not verify the requested certification claim."};f.review.verdict="NEEDS_EVIDENCE";validateListingReview(f.review);f.review.verdict="APPROVE";reject(()=>validateListingReview(f.review),/listing_review_verdict_mismatch/);}},
  {key:"all-seven-independent-checks-required",category:"schema",run:f=>{const original=structuredClone(f.review);delete (f.review.checks as Partial<typeof f.review.checks>).imageOrder;reject(()=>validateListingReview(f.review),/JSON schema/);original.checks.title.rationale=" ".repeat(30);reject(()=>validateListingReview(original),/invalid_listing_review_rationale/);}},
  {key:"same-model-review-denied",category:"role_boundary",run:f=>{const producer=f.execution("specialist",f.proposal),reviewer=f.execution("reviewer",f.review);reviewer.providerModelId=producer.providerModelId;reject(()=>reviewListing(f.input,f.proposal,f.review,producer,reviewer,f.now),/independent_listing_review_required/);}},
  {key:"altered-receipt-denied",category:"role_boundary",run:f=>{const producer=f.execution("specialist",f.proposal);producer.outputHash="0".repeat(64);reject(()=>reviewListing(f.input,f.proposal,f.review,producer,f.execution("reviewer",f.review),f.now),/listing_execution_mismatch/);}},
  {key:"synthetic-pass-never-live-handoff",category:"role_boundary",run:f=>{reject(()=>assertReviewedListing(f.record(),assembleListingProduct(f.input,f.proposal,f.now),f.now),/live_listing_review_required/);}},
  {key:"source-fact-tampering-denied",category:"negative_example",run:f=>{f.input.facts[0].statement="Made from organic silk.";reject(()=>validateListingInput(f.input,f.now),/listing_facts_hash_mismatch/);}},
  {key:"stale-product-facts-denied",category:"negative_example",run:f=>{f.input.factsVerifiedAt=new Date(f.now-86_400_000).toISOString();reject(()=>validateListingInput(f.input,f.now),/stale_listing_facts/);}},
  {key:"stale-policy-denied-before-request",category:"negative_example",run:f=>{const later=f.now+31*86_400_000;const fresh=listingFixture(later);reject(()=>prepareListingTask(fresh.input,"specialist",listingFixtureId(20),undefined,later),/stale_listing_knowledge/);}},
  {key:"no-external-capabilities",category:"capability",run:()=>{for(const role of ["specialist","reviewer"] as const){const p=listingWorker(role);check(p.manifest.capabilityPolicy.allowed.length===0 && p.manifest.capabilityPolicy.forbidden.includes("marketplace.publish"),"Worker external authority expanded");}}},
];
/** Reuses Core's per-case weighted scoring, with domain checks in addition to JSON
 * schema. It never calls runWorkerEvaluationSuite's default live adapter, writes
 * a promotion receipt or changes any installed worker's maturity. */
export function runListingSyntheticEvaluation(now = Date.parse("2026-10-01T10:00:00Z")) {
  const suite: WorkerEvaluationSuite = {suiteKey:"listing.synthetic-contracts",version:"1.0.0",name:"Listing package synthetic contracts",description:"Synthetic contract and policy regression only; live model competence and real draft matching remain unqualified.",workerKey:"listing.specialist",workerVersion:"1.0.0",modelRouteKey:"standard.default",minimumScore:100,requireAllRequired:true,
    cases:cases.map(c=>({caseKey:c.key,name:c.key,description:c.key,category:c.category,executionMode:"deterministic_output",modelTarget:"none",required:true,weight:1,context:{},expectedOutcome:"pass",coversPositiveExamples:[],coversNegativeExamples:[]}))};
  const results: WorkerEvaluationCaseResult[]=cases.map(c=>{try{c.run(listingFixture(now));return{caseKey:c.key,status:"passed",scoreAwarded:1,observedOutcome:"pass",failureCategory:null,failureMessage:null,output:null,evidence:{mode:"synthetic",externalCalls:0} as JsonObject,modelTelemetry:null};}catch(error){return{caseKey:c.key,status:"failed",scoreAwarded:0,observedOutcome:"fail",failureCategory:"validation_failed",failureMessage:error instanceof Error?error.message:"Fixture failed",output:null,evidence:{mode:"synthetic",externalCalls:0} as JsonObject,modelTelemetry:null};}});
  return { ...scoreWorkerEvaluationResults(suite,results), evidenceMode:"synthetic" as const, qualification:"experimental" as const, liveCompetence:false, realDraftMatched:false, promotionAllowed:false,
    dimensions:[...LISTING_DIMENSIONS], schemaHashes:{proposal:hash(LISTING_PROPOSAL_SCHEMA),review:hash(LISTING_REVIEW_SCHEMA)} };
}
