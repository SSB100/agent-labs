import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {loadVerifiedListingInput}=require('../../.core-tests/listing/sources.js');
const {listingFixture,listingFixtureId:id}=require('../../.core-tests/listing/fixtures.js');
const {listingFactsHash,listingImageReviewHash}=require('../../.core-tests/listing/contracts.js');
const {hash,bytesHash}=require('../../.core-tests/etsy/contracts.js');
const {seal}=require('../../.core-tests/etsy/vault.js');

// Local, injected wire-validation data only. The live header tests the transport
// boundary; these rows, seals and pixels are not genuine product qualification,
// are never persisted, and never cause a model, provider or commerce operation.
export function wireFixture(at){
 const {input,now}=listingFixture(at);const p=input.product,key='1'.repeat(64),calls=[];
 const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXp8AAAAASUVORK5CYII=','base64'));
 input.evidenceMode='live';p.images[0].sha256=bytesHash(bytes);input.imagery[0].sha256=p.images[0].sha256;
 const creativeSnapshot={concept:'Original green fern illustration',designInstructions:'The seller used AI tools to create the original fern illustration.',rightsStatement:'The owner confirms the original design and its intended production rights.',rightsConfirmed:true,originalDesign:true};
 input.sources[1].snapshot=structuredClone(creativeSnapshot);input.facts[2].evidence[0].pointer='/designInstructions';
 const businessSource={id:id(32),businessId:p.businessId,recordId:id(33),recordType:'business_approval',verifiedAt:new Date(now-60_000).toISOString(),snapshotHash:'',snapshot:{processing:'Made to order; no delivery date is promised.'}};
 input.sources.push(businessSource);
 const source={id:p.id,business_id:p.businessId,artifact_type:'product.package.v1',content:{}};
 const business={id:businessSource.recordId,business_id:p.businessId,artifact_type:'listing.business-facts.v1',content:{listingSourceSnapshot:structuredClone(businessSource.snapshot),listingSourceEnvelope:seal({version:'1.0.0',businessId:p.businessId,artifactId:businessSource.recordId,snapshot:businessSource.snapshot},`listing-business-facts:${p.businessId}:${businessSource.recordId}`,key)}};
 const review={id:input.imagery[0].reviewArtifactId,business_id:p.businessId,artifact_type:'listing.image-review.v1',content:{}};
 const receipt={id:p.printfulReceiptId,business_id:p.businessId,provider:'printful',outcome:'succeeded',response_summary:{configurationVerified:true,assetBindingVerified:true,productFactsHash:'',listingFacts:structuredClone(input.sources[0].snapshot)}};
 const approval={id:p.creativeApprovalId,business_id:p.businessId,purpose:'candidate_production',snapshot:{...creativeSnapshot,approvalId:p.creativeApprovalId,businessId:p.businessId,unrelatedField:'Not part of the listing source snapshot'}};
 const asset={id:p.images[0].assetId,business_id:p.businessId,creative_run_id:p.creativeRunId,asset_hash:p.images[0].sha256,storage_path:p.images[0].storagePath,inspection:{sha256:p.images[0].sha256,mediaType:'image/png',bytes:bytes.byteLength,width:1,height:1,colorSpace:'srgb',hasAlpha:true,transparentPixelFraction:0,effectiveDpi:300,failedCriteria:[]}};
 const rows=new Map([source,business,review].map(row=>[row.id,row]));
 const reader={
  async readArtifact(artifactId){calls.push(['artifact',artifactId]);return rows.get(artifactId)??null;},
  async readReceipt(receiptId){calls.push(['receipt',receiptId]);return receipt;},
  async readCreativeApproval(approvalId){calls.push(['approval',approvalId]);return approval;},
  async readAsset(assetId){calls.push(['asset',assetId]);return asset;},
  async imageBytes(storagePath){calls.push(['bytes',storagePath]);return bytes;},
  async assertPackage(product){calls.push(['assertPackage',structuredClone(product)]);},
 };
 function commitInput(){
  for(const item of input.sources)item.snapshotHash=hash(item.snapshot);
  p.productFactsHash=listingFactsHash(input);receipt.response_summary.productFactsHash=p.productFactsHash;
  for(const proof of input.imagery){proof.productFactsHash=p.productFactsHash;proof.reviewResultHash=listingImageReviewHash(proof);}
  source.content={listingInput:structuredClone(input),etsyDraftEnvelope:seal(p,`product-package:${p.businessId}:${p.id}`,key),listingInputEnvelope:seal(input,`listing-input:${p.businessId}:${p.id}`,key)};
  review.content={proof:structuredClone(input.imagery[0]),reviewResultHash:input.imagery[0].reviewResultHash,imageReviewEnvelope:seal(input.imagery[0],`listing-image-review:${p.businessId}:${review.id}`,key)};
 }
 commitInput();
 return{input,now,key,bytes,calls,source,business,review,receipt,approval,asset,reader,rows,commitInput,
  load(overrides={}){return loadVerifiedListingInput({businessId:p.businessId,sourceArtifactId:p.id,reader,vaultKey:key,now,...overrides});}};
}
