/** Explicit isolated review rows. No live registration or qualification. */
import {readFileSync,readdirSync} from 'node:fs';
import {directControllerDatabase} from './r12-direct-controller-database.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export const landingPins={landingControlsVersion:'etsy.insights-landing-controls.2',landingControlsHash:'0ee4c99ed0b65e3efd499cadf1059613311df10d815db1892ef03efa167c5d7b'};
export const witnessHash='2a8a7e0a2a4d45abf0f4a71b4a5674006eaec9aa45b8d67c841ac4041131a435';
export async function landingDatabase(){
 const db=await directControllerDatabase();
 try{for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f.slice(0,14)>'20261010120600'&&f.slice(0,14)<='20261010120800').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));return db;}
 catch(error){await db.close();throw error;}
}
export async function insertLandingReview(db,{purpose,authorityHash,routeHash,project,policyHash,validFrom,validUntil,changes={}}){
 const content={version:'r12.insights-landing-review.2',purpose,authorityHash,routeHash,providerProjectId:project,rendererPolicyHash:policyHash,...landingPins,queryControlWitnessHash:witnessHash,validFrom,validUntil,...changes};
 const reviewHash=hash(content);
 await db.query('insert into private.r12_landing_reviews values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[purpose,authorityHash,routeHash,project,policyHash,content,reviewHash,validFrom,validUntil]);
 return reviewHash;
}
