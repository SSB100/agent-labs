import {createHmac} from 'node:crypto';
import {discoveryV2Hash as hash} from '../products/discovery-v2-hash';

/** Trusted server only. None of these bindings belongs in owner forms, model
 * inputs or public release records. A fingerprint proves configuration equality,
 * not provider account ownership or tariff qualification. SQL authenticates the
 * separately reviewed attestation and consumes the permit at create admission. */
export type SteelCreateDeployment={environment:'production';deploymentId:string;releaseCommitSha:string};
export type SteelCredentialConfiguration={apiKey:string;baseUrl:string;region?:string|null};
export type SteelCreateConfigurationAdmission={
 version:'r12.steel-create-config-admission.1';operationId:string;scopeHash:string;providerProjectId:string;
 credentialBindingHash:string;configurationHash:string;deploymentId:string;requestBodyHash:string;
};
export type SteelCreateConfigurationPermit={
 version:'r12.steel-create-config-permit.1';operationId:string;scopeHash:string;providerProjectId:string;
 requestBodyHash:string;configurationHash:string;credentialBindingHash:string;deploymentId:string;
 attestationHash:string;admissionHash:string;validUntil:string;
};
export type SteelCreateConfigurationGuard={scopeHash:string;deployment:SteelCreateDeployment;
 admit(request:Readonly<SteelCreateConfigurationAdmission>,signal:AbortSignal):Promise<unknown>;
 now?:()=>number;
};
const fail=():never=>{throw Error('steel_create_configuration_unqualified');};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:unknown,keys:string):x is Record<string,unknown>=>object(x)&&Object.keys(x).sort().join(',')===keys.split(',').sort().join(',');
const digest=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
function deployment(raw:unknown):Readonly<SteelCreateDeployment>{
 if(!exact(raw,'environment,deploymentId,releaseCommitSha')||raw.environment!=='production'||typeof raw.deploymentId!=='string'||!/^dpl_[A-Za-z0-9_-]{1,124}$/.test(raw.deploymentId)||typeof raw.releaseCommitSha!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(raw.releaseCommitSha))return fail();
 return Object.freeze({environment:'production',deploymentId:raw.deploymentId,releaseCommitSha:raw.releaseCommitSha});
}
/** Missing platform identity fails closed; never derive it from an owner field. */
export function getSteelCreateDeployment(env:NodeJS.ProcessEnv=process.env):Readonly<SteelCreateDeployment>{
 return deployment({environment:env.VERCEL_ENV,deploymentId:env.VERCEL_DEPLOYMENT_ID,releaseCommitSha:env.VERCEL_GIT_COMMIT_SHA});
}
export function captureSteelCreateGuard(raw:SteelCreateConfigurationGuard):Readonly<SteelCreateConfigurationGuard>{
 if(!raw||!digest(raw.scopeHash)||typeof raw.admit!=='function'||raw.now!==undefined&&typeof raw.now!=='function')return fail();
 return Object.freeze({scopeHash:raw.scopeHash,deployment:deployment(raw.deployment),admit:raw.admit,...(raw.now?{now:raw.now}:{})});
}
export function steelCreateConfigurationAdmission(config:SteelCredentialConfiguration,guard:SteelCreateConfigurationGuard,operationId:string,providerProjectId:string,requestBody:string):Readonly<SteelCreateConfigurationAdmission>{
 const d=deployment(guard.deployment);
 if(!digest(guard.scopeHash)||!uuid(operationId)||!uuid(providerProjectId)||typeof config.apiKey!=='string'||config.apiKey.length<1||config.apiKey.length>4096||config.apiKey!==config.apiKey.trim()||/[\r\n\u0000]/.test(config.apiKey)||config.baseUrl!=='https://api.steel.dev'||config.region!==undefined&&config.region!==null&&(typeof config.region!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(config.region)))return fail();
 if(typeof requestBody!=='string'||Buffer.byteLength(requestBody)>16384)return fail();
 let body:unknown;try{body=JSON.parse(requestBody);}catch{return fail();}
 if(!object(body)||body.sessionId!==operationId||body.projectId!==providerProjectId)return fail();
 const configurationHash=hash({version:'r12.steel-runtime-configuration.1',provider:'steel',baseUrl:config.baseUrl,region:config.region??null,providerProjectId,...d});
 const credentialBindingHash=createHmac('sha256',config.apiKey).update('r12.steel-credential-binding.1\n'+configurationHash).digest('hex');
 return Object.freeze({version:'r12.steel-create-config-admission.1',operationId,scopeHash:guard.scopeHash,providerProjectId,credentialBindingHash,configurationHash,deploymentId:d.deploymentId,requestBodyHash:hash(body)});
}
export function validateSteelCreateConfigurationPermit(raw:unknown,request:SteelCreateConfigurationAdmission,now=Date.now()):Readonly<SteelCreateConfigurationPermit>{
 if(!exact(raw,'version,operationId,scopeHash,providerProjectId,requestBodyHash,configurationHash,credentialBindingHash,deploymentId,attestationHash,admissionHash,validUntil')||raw.version!=='r12.steel-create-config-permit.1'||!Number.isSafeInteger(now))return fail();
 for(const key of ['operationId','scopeHash','providerProjectId','requestBodyHash','configurationHash','credentialBindingHash','deploymentId']as const)if(raw[key]!==request[key])return fail();
 if(!digest(raw.attestationHash)||!digest(raw.admissionHash)||typeof raw.validUntil!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.validUntil))return fail();
 const expires=Date.parse(raw.validUntil);if(!Number.isFinite(expires)||new Date(expires).toISOString()!==raw.validUntil||expires<=now||expires>now+30000)return fail();
 const{admissionHash,...body}=raw;if(admissionHash!==hash(body))return fail();
 return Object.freeze({...raw})as SteelCreateConfigurationPermit;
}
