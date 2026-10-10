import 'server-only';
import {randomUUID} from 'node:crypto';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {boundedRpc,requestDeadline} from '../core/request-deadline';
import {getSteelConfig} from '../browser/providers/steel';
import {getSteelCreateDeployment} from '../browser/etsy-steel-create-binding';
import {qualifySteelExistingSessionReadback} from '../browser/etsy-steel-config-readback';
import {steelReadbackAssert as check,steelReadbackUuid,steelReadbackDigest,steelReadbackHash as hash,steelReadbackTime,validateSteelReadbackStatus,validateSteelReadbackClaim,type SteelReadbackStatus} from './etsy-steel-readback-contracts';

/** Deployed same-owner read-only action implementation. No endpoint or form is
 * installed by this module. Private targets are independently reviewed SQL
 * records; the owner supplies only a reference. This never publishes a route,
 * attestation or grant, and cannot create/list sessions or expose private proof. */
async function owner(context:OwnerUiContext,businessId:string){
 check(steelReadbackUuid(businessId)&&steelReadbackUuid(context.userId)&&await verifyOwnerBusiness(context,businessId));
 const claims=await context.supabase.auth.getClaims();check(!claims.error&&claims.data?.claims?.sub===context.userId);
}
function serverKey(){
 const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();check(process.env.VERCEL_ENV==='production'&&root&&root.length>=32&&root.length<=200);
 return root;
}
class SteelReadbackAuthorityUnavailable extends Error {
 constructor(){super('Steel configuration readback authority is unavailable.');this.name='SteelReadbackAuthorityUnavailable';}
}
function rethrowAuthority(error:unknown){if(error instanceof SteelReadbackAuthorityUnavailable)throw error;}
async function rpc(context:OwnerUiContext,businessId:string,operation:'claim'|'record'|'fail'|'cancel',payload:unknown,key:string,signal?:AbortSignal){
 const deadline=AbortSignal.any([requestDeadline(15000),...(signal?[signal]:[])]);
 deadline.throwIfAborted();const result=await boundedRpc(context.supabase.rpc('r12_steel_config_readback_server',{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:key}),deadline,10000);
 if(result.error?.code==='42501')throw new SteelReadbackAuthorityUnavailable();
 check(!result.error&&result.data!==null);return result.data;
}
export async function readSteelConfigReadback(context:OwnerUiContext,businessId:string,targetHash?:string):Promise<SteelReadbackStatus>{
 await owner(context,businessId);check(targetHash===undefined||steelReadbackDigest(targetHash));
 const r=await boundedRpc(context.supabase.rpc('r12_owner_steel_config_readback',{p_business_id:businessId,p_target_hash:targetHash??null}),requestDeadline(15000),10000);check(!r.error&&r.data!==null);
 return validateSteelReadbackStatus(r.data,businessId,targetHash);
}
export async function cancelSteelConfigReadback(context:OwnerUiContext,businessId:string,targetHash:string):Promise<SteelReadbackStatus>{
 await owner(context,businessId);check(steelReadbackDigest(targetHash));
 try{return validateSteelReadbackStatus(await rpc(context,businessId,'cancel',{targetHash},serverKey()),businessId,targetHash);}
 catch(error){rethrowAuthority(error);return readSteelConfigReadback(context,businessId,targetHash);}
}
export async function runSteelConfigReadback(context:OwnerUiContext,businessId:string,targetHash:string,signal?:AbortSignal):Promise<SteelReadbackStatus>{
 await owner(context,businessId);check(steelReadbackDigest(targetHash));signal?.throwIfAborted();
 const key=serverKey(),submissionId=randomUUID(),expected={businessId,ownerId:context.userId,targetHash,submissionId};
 let admission;
 try{admission=validateSteelReadbackClaim(await rpc(context,businessId,'claim',{targetHash,submissionId},key,signal),expected);}
 catch(error){rethrowAuthority(error);return readSteelConfigReadback(context,businessId,targetHash);}
 if(!admission.mayFetch)return admission.status;
 const {target,claim}=admission,pins={targetHash,claimId:claim.id,claimHash:claim.hash};
 let result;
 try{
  signal?.throwIfAborted();const config=Object.freeze({...getSteelConfig()}),deployment=getSteelCreateDeployment();
  const configuration={version:'r12.steel-runtime-configuration.1',provider:'steel',baseUrl:config.baseUrl,region:config.region??null,providerProjectId:target.providerProjectId,...deployment};
  check(hash(configuration)===target.configurationHash);
  const remaining=steelReadbackTime(claim.expiresAt)-Date.now();check(remaining>0);
  const bounded=AbortSignal.any([requestDeadline(remaining),...(signal?[signal]:[])]);
  result=await qualifySteelExistingSessionReadback({sessionId:target.knownSessionId,providerProjectId:target.providerProjectId,knownBefore:target.knownBefore,observedTerminalState:target.observedTerminalState,...(target.expectedCreatedAt===null?{}:{sessionCreatedAt:target.expectedCreatedAt}),...(target.expectedProviderStatus===null?{}:{providerStatus:target.expectedProviderStatus})},{config,deployment,signal:bounded});
  signal?.throwIfAborted();check(result.privateEvidence.configurationHash===target.configurationHash&&Date.now()<steelReadbackTime(claim.expiresAt));
 }catch{
  try{return validateSteelReadbackStatus(await rpc(context,businessId,signal?.aborted?'cancel':'fail',signal?.aborted?{targetHash}:{...pins,reason:'provider_readback_unverified'},key),businessId,targetHash);}
  catch(error){rethrowAuthority(error);return readSteelConfigReadback(context,businessId,targetHash);}
 }
 try{
  const status=validateSteelReadbackStatus(await rpc(context,businessId,'record',{...pins,proof:result.privateEvidence},key),businessId,targetHash);
  check(status.status==='verified'&&status.proofHash===hash(result.privateEvidence)&&status.observedAt===result.privateEvidence.observedAt);return status;
 }catch(error){
  rethrowAuthority(error);
  // A lost record acknowledgment is a read-only reconciliation, never another
  // provider call or an invented failure after a possibly committed proof.
  return readSteelConfigReadback(context,businessId,targetHash);
 }
}
