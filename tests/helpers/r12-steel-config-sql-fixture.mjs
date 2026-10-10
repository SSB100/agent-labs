/** Successor-only engineering fixtures. Provider, deployment, dashboard and
 * independent readback evidence is explicitly inert, never live authority. */
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import {directSonnetDatabase} from './r12-direct-sonnet-database.mjs';
import {one,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';

export const STEEL_CONFIG_MIGRATION='supabase/migrations/20261010121300_r12_steel_create_configuration.sql';
export const INERT_STEEL_CONFIG={apiKey:'inert-steel-key-no-provider-access',baseUrl:'https://api.steel.dev'};
export const INERT_STEEL_DEPLOYMENT={environment:'production',deploymentId:'dpl_inert_steel_config_21300',releaseCommitSha:'1'.repeat(40)};
export async function applySteelConfig(db){
 try{await db.exec(readFileSync(STEEL_CONFIG_MIGRATION,'utf8'));}
 catch(error){error.message+=' '+JSON.stringify({position:error.position,where:error.where,internalPosition:error.internalPosition,internalQuery:error.internalQuery});throw error;}
}
export async function steelConfigDatabase({apply=true}={}){
 const db=await directSonnetDatabase();try{if(apply)await applySteelConfig(db);return db;}catch(error){await db.close();throw error;}
}
export function inertSteelConfiguration(providerProjectId){
 const configuration={version:'r12.steel-runtime-configuration.1',provider:'steel',baseUrl:INERT_STEEL_CONFIG.baseUrl,region:null,providerProjectId,...INERT_STEEL_DEPLOYMENT};
 const configurationHash=hash(configuration);
 const credentialBindingHash=createHmac('sha256',INERT_STEEL_CONFIG.apiKey).update('r12.steel-credential-binding.1\n'+configurationHash).digest('hex');
 return{configuration,configurationHash,credentialBindingHash};
}
export function configureInertEnrollmentSteel(x){
 const config=inertSteelConfiguration(x.project);
 x.registry.browserRoute.credential_binding_hash=config.credentialBindingHash;
 return config;
}
export async function inertSteelAttestation(db,routeHash,{validUntil=new Date(Date.now()+600000).toISOString(),mutate=null}={}){
 const route=await one(db,'select * from private.r12_direct_browser_routes where route_hash=$1',[routeHash]);
 const config=inertSteelConfiguration(route.provider_project_id),now=Date.now(),sessionId=randomUUID();
 const independentReadback={version:'r12.steel-existing-session-readback.1',method:'GET',endpoint:'https://api.steel.dev/v1/sessions/'+sessionId,requestedSessionId:sessionId,returnedSessionId:sessionId,returnedProjectId:route.provider_project_id,providerStatus:'released',sessionCreatedAt:new Date(now-60000).toISOString(),observedAt:new Date(now-1000).toISOString(),responseHash:hash({inert:true,sessionId,project:route.provider_project_id}),credentialBindingHash:config.credentialBindingHash,configurationHash:config.configurationHash};
 const body={version:'r12.steel-config-attestation.1',routeHash,providerProjectId:route.provider_project_id,providerAccountHash:route.provider_account_hash,tariffHash:route.tariff_hash,...config,deploymentEvidenceHash:hash('inert-deployment-evidence'),dashboardTariffEvidenceHash:route.content.priceEvidenceHash,independentReadback,validFrom:new Date(now).toISOString(),validUntil};
 if(mutate)mutate(body);
 return{...body,attestationHash:hash(body)};
}
export async function publishInertSteelAttestation(db,routeHash,options){
 const attestation=await inertSteelAttestation(db,routeHash,options);
 const published=(await one(db,'select private.r12_steel_publish_config_attestation($1) value',[attestation])).value;
 return{attestation,published};
}
export function steelConfigRequest(scope,{scopeHash=hash(scope),setup=false,profileId=scope.profileId,configuration=inertSteelConfiguration(scope.providerProjectId)}={}){
 const requestBody={sessionId:scope.operationId,projectId:scope.providerProjectId,timeout:scope.maximumSessionMs??scope.limits.maximumSessionMs,persistProfile:setup,
  ...(setup?{}:{profileId}),debugConfig:{interactive:setup,systemCursor:setup},useProxy:false,solveCaptcha:false,
  stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true}};
 return{version:'r12.steel-create-config-admission.1',operationId:scope.operationId,scopeHash,providerProjectId:scope.providerProjectId,
  credentialBindingHash:configuration.credentialBindingHash,configurationHash:configuration.configurationHash,deploymentId:configuration.configuration.deploymentId,requestBodyHash:hash(requestBody)};
}
export const admitSteelConfig=(db,businessId,request,key)=>ownerInitialRuntimeRpc(db,'r12_steel_create_config_admit',[businessId,request,key]);
