import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {etsyKnowledgePackManifests}=require('../.core-tests/packs/etsy-knowledge.js');
const {researchPackManifests}=require('../.core-tests/research/packs.js');
const {discoveryV2PackManifests}=require('../.core-tests/products/discovery-v2-packs.js');
const {pinDiscoveryKnowledgeV2}=require('../.core-tests/products/discovery-v2-knowledge.js');
/** Synthetic pinned closure only; registration and live qualification are not implied. */
export function discoveryKnowledgeFixture(now=Date.now()){
  const manifests=[...etsyKnowledgePackManifests(),...researchPackManifests(),...discoveryV2PackManifests()];
  const releases=manifests.map((manifest,index)=>({id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,status:'experimental',manifest}));
  const root=releases.find(release=>release.manifest.packKey==='workflow.product-discovery-v2');
  return pinDiscoveryKnowledgeV2({rootPackId:root.id,releases},now);
}
