/** Fresh isolated SQL state for the actual Next owner Goal journey.
 * No setup, policy, scope, authority, provider request or paid effect is created.
 * Catalog reviews/grants and retained legacy history are synthetic test data. */
import {createRequire} from 'node:module';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from '../helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from '../helpers/r10-sql-fixture.mjs';
import {ownerInitialSqlFixture} from '../helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from '../helpers/r12-provider-fixture.mjs';
import {appendOwnerGrantRootRevision} from '../helpers/r12-owner-grant-extension-sql-fixture.mjs';
import {discoveryV2Hash} from '../../.core-tests/products/discovery-v2.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const INERT_ROOT='inert-r12-owner-root-configuration-0123456789';
/** Isolated operator enrollment only. Owner confirmation and every phase still
 * run through the production Next UI and migrated SQL. No history is rewritten. */
export async function extendOwnerInitialNextAllowance(current) {
 if(!['owner-initial-native','owner-initial-legacy'].includes(current.scenario))throw Error('Isolated owner fixture required');
 const maximumScopes=3,maximumAllocationMicrounits=String(3*r12QuoteFixture().maximumMicrousd),expiresAt=current.profile.validUntil;
 const revision=await appendOwnerGrantRootRevision(current.db,current.grantRootId,{maximumScopes,maximumAllocationMicrounits,expiresAt,approvalHash:'8'.repeat(64)});
 const grantId=randomUUID(),key=createHmac('sha256',INERT_ROOT).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:current.businessId,ownerId:current.ownerId,grantId})).digest('base64url');
 await current.db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds,root_revision,root_revision_hash)
 select $1,root_id,business_id,owner_id,business_revision,business_hash,profile_id,$2,$3,$4,$5,valid_from,valid_until,$6,$7,$8 from private.r12_owner_bootstrap_grants where id=$9`,
 [grantId,maximumScopes,maximumAllocationMicrounits,createHash('sha256').update(key).digest('hex'),'8'.repeat(64),{maximumEpisodes:2,maximumAllocationMicrounits,expiresAt},revision.revision,revision.hash,current.grantId]);
 current.continuationGrantId=grantId;current.grantRootRevision=revision;
 return revision;
}
/** Inert operator enrollment after the three genuine owner episodes consume
 * their shared root. The reviewed Etsy-only profile and grant are new immutable rows. Etsy stays
 * excluded from network access: allowedDomains records source attribution only. */
export async function enrollAdaptiveOwnerNextAllowance(current,goalId) {
 if(!['owner-initial-native','owner-initial-legacy'].includes(current.scenario)||!current.grantRootRevision)throw Error('Closed owner episode fixture required');
 if(typeof goalId!=='string'||!goalId)throw Error('Exact owner-selected Goal required');
 const maximumRunMicrounits='10000000',maximumScopes=4;
 const maximumAllocationMicrounits=String(3*r12QuoteFixture().maximumMicrousd+Number(maximumRunMicrounits));
 const expiresAt=current.profile.validUntil;
 const revision=await appendOwnerGrantRootRevision(current.db,current.grantRootId,{maximumScopes,maximumAllocationMicrounits,expiresAt,approvalHash:'9'.repeat(64)});
 const profile={...current.profile,version:'r12.owner-research-profile.3',id:randomUUID(),title:'Inert reviewed Etsy owner-capture research',maximumRunMicrousd:10_000_000,
  allowedDomains:['etsy.com'],sourceReviews:[{domain:'etsy.com',basis:'owner_reported_capture',reviewHash:'a'.repeat(64)}]};
 const profileHash=discoveryV2Hash(profile);
 const old=await current.db.query('select pins from private.r12_owner_profiles where id=$1',[current.profileId]);
 if(old.rows.length!==1)throw Error('Reviewed source profile unavailable');
 const pins=old.rows[0].pins;
 await current.db.query('insert into private.r12_owner_profiles(id,profile,profile_hash,pins,pins_hash,created_at) values($1,$2,$3,$4,$5,clock_timestamp())',[profile.id,profile,profileHash,pins,discoveryV2Hash(pins)]);
 const grantId=randomUUID(),key=createHmac('sha256',INERT_ROOT).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:current.businessId,ownerId:current.ownerId,grantId})).digest('base64url');
 const latestGoal=(await current.db.query('select revision,content_hash from private.r04_goal_versions where business_id=$1 and goal_id=$2 order by revision desc limit 1',[current.businessId,goalId])).rows[0];
 if(!latestGoal)throw Error('Exact saved owner goal unavailable');
 const adaptiveBounds={version:'r12.owner-adaptive-grant.1',goalId,goalRevision:latestGoal.revision,goalHash:latestGoal.content_hash,
  profileHash,maximumActions:10,maximumRunMicrounits,expiresAt,rootRevision:revision.revision,rootRevisionHash:revision.hash,allowsPaidFollowups:true};
 await current.db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,adaptive_bounds,root_revision,root_revision_hash)
 select $1,root_id,business_id,owner_id,business_revision,business_hash,$2,$3,$4,$5,$6,valid_from,valid_until,$7,$8,$9 from private.r12_owner_bootstrap_grants where id=$10`,
 [grantId,profile.id,maximumScopes,maximumAllocationMicrounits,createHash('sha256').update(key).digest('hex'),'9'.repeat(64),adaptiveBounds,revision.revision,revision.hash,current.grantId]);
 current.adaptiveGrantId=grantId;current.adaptiveProfileId=profile.id;current.adaptiveProfile=profile;current.adaptiveRootRevision=revision;
 return {grantId,profileId:profile.id,profileHash,revision};
}
export async function createOwnerInitialNextFixture(host,kind='native'){
 if(!['native','legacy'].includes(kind))throw Error('Unknown inert owner-initial fixture kind');
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);await db.exec("set timezone='UTC'");
  for(const file of (await readdir(path.join(root,'supabase/migrations'))).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(path.join(root,'supabase/migrations',file),'utf8'));
  const f=await ownerInitialSqlFixture(db,{bootstrapRoot:INERT_ROOT,maximumScopes:1,maximumAllocation:r12QuoteFixture().maximumMicrousd,legacy:kind==='legacy'?{committedMicrounits:1900000}:null});
  const continuationGrantId=randomUUID(),continuationBounds={maximumEpisodes:3,maximumAllocationMicrounits:'6000000',expiresAt:f.profile.validUntil};
  const continuationKey=createHmac('sha256',INERT_ROOT).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:f.businessId,ownerId:f.ownerId,grantId:continuationGrantId})).digest('base64url');
  const continuationKeyHash=createHash('sha256').update(continuationKey).digest('hex');
  await db.query('insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,profile_id,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash,continuation_bounds) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [continuationGrantId,f.rootId,f.businessId,f.ownerId,f.profileId,continuationKeyHash,'6'.repeat(64),f.profile.validFrom,f.profile.validUntil,f.businessRevision,f.businessHash,continuationBounds]);
  // The public owner catalog selects the newest eligible grant per profile.
  // Drive HTTP actions with that same exact selection as the ordinary UI.
  const ownerCatalog=(await db.query('select public.r12_owner_research_read($1,$2,null) result',[f.businessId,f.goalId])).rows[0].result;
  const catalogProfile=ownerCatalog.profiles.filter(row=>row.profile.id===f.profileId);
  if(catalogProfile.length!==1||catalogProfile[0].grantId!==continuationGrantId||catalogProfile[0].profileHash!==f.input.profileHash)throw Error('Exact newest synthetic owner grant not exposed by catalog');
  return {db,metadata:{scenario:'owner-initial-'+kind,businessId:f.businessId,goalId:f.goalId,ownerId:f.ownerId,profileId:f.profileId,grantId:f.grantId,continuationGrantId,bindingId:f.bindingId,grantRootId:f.rootId,profile:f.profile,goalContent:f.content,initialInput:{...f.input,grantId:catalogProfile[0].grantId},priorRoundId:f.legacy?.rootId??null,budgetAuthorityRootId:f.legacy?.rootId??f.businessId,quote:r12QuoteFixture(),outputs:{},scopeId:null,plan:null}};
 }catch(error){await db.close();throw error;}
}
