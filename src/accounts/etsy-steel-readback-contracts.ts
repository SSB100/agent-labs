import {discoveryV2Hash as hash} from '../products/discovery-v2-hash';
export type SteelReadbackStatus={version:'r12.owner-steel-config-readback.1';businessId:string;targetHash:string|null;status:'ready'|'pending'|'verified'|'failed'|'cancelled'|'expired'|'review_required';observedAt:string|null;proofHash:string|null};
export type SteelReadbackConfiguration={version:'r12.steel-runtime-configuration.1';provider:'steel';baseUrl:'https://api.steel.dev';region:string|null;providerProjectId:string;environment:'production';deploymentId:string;releaseCommitSha:string};
export type SteelReadbackTarget={version:'r12.steel-config-readback-target.1';businessId:string;ownerId:string;providerProjectId:string;knownSessionId:string;knownBefore:string;observedTerminalState:'Completed';expectedCreatedAt:string|null;expectedProviderStatus:'released'|'failed'|null;configuration:SteelReadbackConfiguration;configurationHash:string;deploymentEvidenceHash:string;routeReviewHash:string;tariffEvidenceHash:string;validFrom:string;expiresAt:string;targetHash:string};
export type SteelReadbackClaim={version:'r12.steel-config-readback-claim-response.1';targetHash:string;mayFetch:true;claim:{id:string;hash:string;expiresAt:string};target:SteelReadbackTarget}|{version:'r12.steel-config-readback-claim-response.1';targetHash:string;mayFetch:false;status:SteelReadbackStatus};
export const steelReadbackHash=hash;
export function steelReadbackAssert(x:unknown):asserts x{if(!x)throw Error('steel_readback_unavailable');}
export const steelReadbackUuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
export const steelReadbackDigest=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function exact(x:unknown,keys:string):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(x)).every(d=>'value'in d)&&Object.keys(x).sort().join(',')===keys.split(',').sort().join(',');}
export function steelReadbackTime(x:unknown):number{steelReadbackAssert(typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x));const n=Date.parse(x);steelReadbackAssert(Number.isFinite(n)&&new Date(n).toISOString()===x);return n;}
export function validateSteelReadbackStatus(raw:unknown,businessId:string,targetHash?:string|null):SteelReadbackStatus{
 steelReadbackAssert(exact(raw,'version,businessId,targetHash,status,observedAt,proofHash')&&raw.version==='r12.owner-steel-config-readback.1'&&raw.businessId===businessId&&steelReadbackUuid(businessId));
 steelReadbackAssert(typeof raw.status==='string'&&['ready','pending','verified','failed','cancelled','expired','review_required'].includes(raw.status)&&(raw.targetHash===null?raw.status==='review_required':steelReadbackDigest(raw.targetHash))&&(targetHash===undefined||raw.targetHash===targetHash));
 if(raw.status==='verified'){steelReadbackAssert(steelReadbackDigest(raw.proofHash)&&raw.targetHash!==null);steelReadbackTime(raw.observedAt);}else steelReadbackAssert(raw.observedAt===null&&raw.proofHash===null);
 return {...raw}as SteelReadbackStatus;
}
export function validateSteelReadbackTarget(raw:unknown,expected:{businessId:string;ownerId:string;targetHash:string},now=Date.now()):SteelReadbackTarget{
 steelReadbackAssert(exact(raw,'version,businessId,ownerId,providerProjectId,knownSessionId,knownBefore,observedTerminalState,expectedCreatedAt,expectedProviderStatus,configuration,configurationHash,deploymentEvidenceHash,routeReviewHash,tariffEvidenceHash,validFrom,expiresAt,targetHash')&&raw.version==='r12.steel-config-readback-target.1');
 for(const k of ['businessId','ownerId','targetHash']as const)steelReadbackAssert(raw[k]===expected[k]);
 for(const k of ['businessId','ownerId','providerProjectId','knownSessionId']as const)steelReadbackAssert(steelReadbackUuid(raw[k]));
 for(const k of ['targetHash','configurationHash','deploymentEvidenceHash','routeReviewHash','tariffEvidenceHash']as const)steelReadbackAssert(steelReadbackDigest(raw[k]));
 steelReadbackAssert(raw.observedTerminalState==='Completed'&&[null,'released','failed'].includes(raw.expectedProviderStatus as null|string));
 const prior=steelReadbackTime(raw.knownBefore),from=steelReadbackTime(raw.validFrom),until=steelReadbackTime(raw.expiresAt);
 steelReadbackAssert(Number.isSafeInteger(now)&&prior<now&&prior<=from&&from<=now&&until>now&&until>from&&until<=from+86400000);
 if(raw.expectedCreatedAt!==null)steelReadbackAssert(steelReadbackTime(raw.expectedCreatedAt)<prior);
 const c=raw.configuration;steelReadbackAssert(exact(c,'version,provider,baseUrl,region,providerProjectId,environment,deploymentId,releaseCommitSha')&&c.version==='r12.steel-runtime-configuration.1'&&c.provider==='steel'&&c.baseUrl==='https://api.steel.dev'&&c.providerProjectId===raw.providerProjectId&&c.environment==='production');
 steelReadbackAssert((c.region===null||typeof c.region==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(c.region))&&typeof c.deploymentId==='string'&&/^dpl_[A-Za-z0-9_-]{1,124}$/.test(c.deploymentId)&&typeof c.releaseCommitSha==='string'&&/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(c.releaseCommitSha));
 steelReadbackAssert(hash(c)===raw.configurationHash);const{targetHash,...body}=raw;steelReadbackAssert(hash(body)===targetHash);
 return {...raw,configuration:{...c}}as SteelReadbackTarget;
}
export function validateSteelReadbackClaim(raw:unknown,expected:{businessId:string;ownerId:string;targetHash:string;submissionId:string},now=Date.now()):SteelReadbackClaim{
 steelReadbackAssert(exact(raw,'version,targetHash,mayFetch,status')||exact(raw,'version,targetHash,mayFetch,claim,target'));const r=raw;
 steelReadbackAssert(r.version==='r12.steel-config-readback-claim-response.1'&&r.targetHash===expected.targetHash&&steelReadbackDigest(expected.targetHash)&&steelReadbackUuid(expected.submissionId));
 if(r.mayFetch===false){steelReadbackAssert(exact(r,'version,targetHash,mayFetch,status'));return{version:'r12.steel-config-readback-claim-response.1',targetHash:expected.targetHash,mayFetch:false,status:validateSteelReadbackStatus(r.status,expected.businessId,expected.targetHash)};}
 steelReadbackAssert(r.mayFetch===true&&exact(r,'version,targetHash,mayFetch,claim,target')&&exact(r.claim,'id,hash,expiresAt')&&steelReadbackUuid(r.claim.id)&&steelReadbackDigest(r.claim.hash));
 const target=validateSteelReadbackTarget(r.target,expected,now),expiry=steelReadbackTime(r.claim.expiresAt);
 steelReadbackAssert(expiry>now&&expiry<=now+20000&&expiry<=steelReadbackTime(target.expiresAt));
 steelReadbackAssert(r.claim.hash===hash({version:'r12.steel-config-readback-claim.1',id:r.claim.id,targetHash:expected.targetHash,submissionId:expected.submissionId,expiresAt:r.claim.expiresAt}));
 return{version:'r12.steel-config-readback-claim-response.1',targetHash:expected.targetHash,mayFetch:true,claim:{...r.claim}as{id:string;hash:string;expiresAt:string},target};
}
