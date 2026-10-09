/** Inert trusted-operator grant-root revision fixture. Never targets a live database. */
import {randomUUID} from 'node:crypto';
import {sha,one,ownerInitialRpc} from './r12-owner-initial-sql-fixture.mjs';

export async function appendOwnerGrantRootRevision(db,rootId,{maximumScopes,maximumAllocationMicrounits,expiresAt,approvalHash=sha(`inert-approved-extension-${rootId}-${maximumScopes}-${maximumAllocationMicrounits}`)}){
 const prior=await one(db,`select r.id root_id,r.maximum_scopes root_maximum_scopes,r.maximum_allocation_microunits root_maximum_allocation,
 private.r12_owner_grant_root_genesis(r) genesis,
 x.revision,x.content_hash,x.maximum_scopes,x.maximum_allocation_microunits
 from private.r12_owner_grant_roots r left join lateral
 (select * from private.r12_owner_grant_root_revisions where root_id=r.id order by revision desc limit 1)x on true
 where r.id=$1`,[rootId]);
 if(!prior)throw Error('fixture root missing');
 const revision=(prior.revision??0)+1;
 const previousHash=prior.content_hash??prior.genesis;
 const previousMaximumScopes=prior.maximum_scopes??prior.root_maximum_scopes;
 const previousMaximumAllocation=prior.maximum_allocation_microunits??prior.root_maximum_allocation;
 await one(db,`with proposed as (
 select $1::uuid root_id,$2::integer revision,$3::text previous_hash,$4::integer previous_maximum_scopes,
 $5::bigint previous_maximum_allocation_microunits,$6::integer maximum_scopes,$7::bigint maximum_allocation_microunits,
 $8::text approval_hash,$9::timestamptz expires_at)
 insert into private.r12_owner_grant_root_revisions(root_id,revision,previous_hash,previous_maximum_scopes,previous_maximum_allocation_microunits,maximum_scopes,maximum_allocation_microunits,approval_hash,expires_at,content_hash)
 select p.*,private.stage14_hash(jsonb_build_object('version','r12.owner-grant-root-revision.1','rootId',p.root_id,'revision',p.revision,
 'previousHash',p.previous_hash,'previousMaximumScopes',p.previous_maximum_scopes,'previousMaximumAllocationMicrounits',p.previous_maximum_allocation_microunits::text,
 'maximumScopes',p.maximum_scopes,'maximumAllocationMicrounits',p.maximum_allocation_microunits::text,'approvalHash',p.approval_hash,'expiresAt',p.expires_at)) from proposed p
 returning root_id,revision,content_hash,maximum_scopes,maximum_allocation_microunits,expires_at`,
 [rootId,revision,previousHash,previousMaximumScopes,previousMaximumAllocation,maximumScopes,maximumAllocationMicrounits,approvalHash,expiresAt]);
 return (await one(db,`select jsonb_build_object('rootId',root_id,'revision',revision,'hash',content_hash,'maximumScopes',maximum_scopes,
 'maximumAllocationMicrounits',maximum_allocation_microunits::text,'expiresAt',expires_at) result
 from private.r12_owner_grant_root_revisions where root_id=$1 and revision=$2`,[rootId,revision])).result;
}

export async function enrollOwnerExtensionGrant(db,f,revision,{maximumEpisodes=1,maximumAllocationMicrounits=revision.maximumAllocationMicrounits}={}){
 const grantId=randomUUID(),bootstrapKey=`inert-extension-${grantId}`;
 await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,
 server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds,maximum_scopes,maximum_allocation_microunits,root_revision,root_revision_hash,created_at)
 select $1,root_id,business_id,owner_id,business_revision,business_hash,profile_id,$2,$3,valid_from,valid_until,
 jsonb_build_object('maximumEpisodes',$4::integer,'maximumAllocationMicrounits',$5::text,'expiresAt',valid_until),$6::integer,$7::bigint,$8::integer,$9::text,
 greatest(clock_timestamp(),(select max(created_at)+interval '1 microsecond' from private.r12_owner_bootstrap_grants where business_id=$11))
 from private.r12_owner_bootstrap_grants where id=$10`,[grantId,sha(bootstrapKey),sha(`inert-approval-${grantId}`),maximumEpisodes,maximumAllocationMicrounits,revision.maximumScopes,revision.maximumAllocationMicrounits,revision.revision,revision.hash,f.grantId,f.businessId]);
 return {...f,grantId,bootstrapKey,input:{...f.input,grantId},server:(op,payload,key=bootstrapKey)=>ownerInitialRpc(db,f.ownerId,'r12_owner_research_server',[f.businessId,op,payload,key])};
}
