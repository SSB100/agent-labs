import type {SteelBrowserAdapter} from './providers/steel';
import {discoveryV2Hash as hash} from '../products/discovery-v2-hash';
import {handoffAssert as check,handoffHash,handoffUuid} from '../accounts/etsy-steel-handoff-contracts';

type Usage=Awaited<ReturnType<SteelBrowserAdapter['retrieveScopedTerminalUsage']>>;
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const money=(x:unknown):x is string=>typeof x==='string'&&/^[1-9][0-9]{0,15}$/.test(x);
/** Trusted server bridge only. Observations come from the admitted provider GET
 * and actual port disposal, never owner forms, models or a synthetic receipt.
 * All reservations remain held; this bridge cannot assert invoice settlement. */
export async function recordEtsySteelBoundedPending(input:{
 operationId:string;providerProjectId:string;routeHash:string;requestedTimeoutMs:number;maximumMicrounits:string;
 terminalReceipt:Record<string,unknown>;
 release:{sessionId:string;released:boolean;terminalReadback:boolean;observersDisposed:boolean;disposalProofHash:string};
 /** True only for the exact admitted create body with all extras disabled. */
 extraServicesDisabled:boolean;
 readUsage(sessionId:string,projectId:string):Promise<Usage>;
 rpc(operation:'read'|'bind_session'|'receipt'|'evidence'|'reconcile',payload:Record<string,unknown>):Promise<unknown>;
}){
 check(handoffUuid(input.operationId)&&handoffUuid(input.providerProjectId)&&handoffHash(input.routeHash)&&integer(input.requestedTimeoutMs)&&money(input.maximumMicrounits),'steel_accounting_input_invalid');
 const {release}=input;
 check(release.sessionId===input.operationId&&release.released&&release.terminalReadback&&release.observersDisposed&&handoffHash(release.disposalProofHash),'steel_disposal_unconfirmed');
 const read=await input.rpc('read',{});check(object(read)&&read.operationId===input.operationId&&read.operationMaximumMicrounits===input.maximumMicrounits&&object(read.qualification),'steel_route_unconfirmed');const q=read.qualification;
 check(q.providerProjectId===input.providerProjectId&&q.routeHash===input.routeHash&&handoffHash(q.providerAccountHash)&&handoffHash(q.tariffHash)&&handoffHash(q.qualificationHash)&&integer(q.maximumSessionMs)&&money(q.maximumSessionMicrounits),'steel_route_mismatch');
 const usage=await input.readUsage(input.operationId,input.providerProjectId);
 check(usage.version==='etsy.steel-terminal-usage.1'&&usage.sessionId===input.operationId&&usage.providerProjectId===input.providerProjectId&&['released','failed'].includes(usage.providerStatus),'steel_readback_mismatch');
 const bound=await input.rpc('bind_session',{sessionId:input.operationId,providerProjectId:input.providerProjectId,providerAccountHash:q.providerAccountHash});
 check(object(bound)&&bound.operationId===input.operationId&&handoffHash(bound.usageIdentityHash),'steel_session_binding_unconfirmed');
 const receipt=input.terminalReceipt,{receiptHash,...body}=receipt;
 check(receipt.operationId===input.operationId&&receiptHash===hash(body)&&(handoffHash(receipt.scopeHash)&&receipt.scopeHash===read.scopeHash||handoffHash(receipt.requestHash)&&receipt.requestHash===read.requestHash),'steel_terminal_receipt_unconfirmed');
 const stored=await input.rpc('receipt',receipt);check(object(stored)&&stored.persisted===true&&stored.receiptHash===receiptHash,'steel_receipt_unconfirmed');
 const providerReadbackHash=hash(usage),pins={operationId:input.operationId,sessionId:input.operationId,providerProjectId:input.providerProjectId};
 const releaseContent={...pins,terminal:true,observersDisposed:true,providerStatus:usage.providerStatus,providerReadbackHash,disposalProofHash:release.disposalProofHash};
 const rel=await input.rpc('evidence',{kind:'release',providerRecordId:`steel-release:${input.operationId}:${providerReadbackHash}`,content:releaseContent});
 check(object(rel)&&rel.evidenceHash===hash(releaseContent),'steel_release_evidence_unconfirmed');
 const expectedBound={version:'r12.steel-usage-bound.1',maximumProxyBytes:0,tariffCoversSessionAndProfileLifecycle:true,captchaDisabled:true,extraServicesDisabled:true};
 const within=q.revoked===false&&hash(q.usageBound??null)===hash(expectedBound)&&input.requestedTimeoutMs>=15000&&input.requestedTimeoutMs<=q.maximumSessionMs&&usage.providerTimeoutMs===input.requestedTimeoutMs&&integer(usage.durationMs)&&usage.durationMs<=input.requestedTimeoutMs&&usage.proxyBytesUsed===0&&usage.proxySource===null&&usage.solveCaptcha===false&&input.extraServicesDisabled===true&&BigInt(q.maximumSessionMicrounits)<=BigInt(input.maximumMicrounits);
 const usageContent={...pins,usageIdentityHash:bound.usageIdentityHash,tariffHash:q.tariffHash,qualificationHash:q.qualificationHash,withinQualifiedLimits:within,maximumMicrounits:q.maximumSessionMicrounits,requestedTimeoutMs:input.requestedTimeoutMs,providerTimeoutMs:usage.providerTimeoutMs,durationMs:usage.durationMs,proxyBytesUsed:usage.proxyBytesUsed,proxySource:usage.proxySource,solveCaptcha:usage.solveCaptcha,extraServicesDisabled:input.extraServicesDisabled,providerReadbackHash};
 const us=await input.rpc('evidence',{kind:'usage_bound',providerRecordId:`steel-usage:${input.operationId}:${providerReadbackHash}`,content:usageContent});
 check(object(us)&&us.evidenceHash===hash(usageContent),'steel_usage_evidence_unconfirmed');
 const result=await input.rpc('reconcile',{releaseProofHash:rel.evidenceHash,usageProofHash:us.evidenceHash,billingProofHash:null});
 check(object(result)&&typeof result.accepted==='boolean','steel_accounting_unconfirmed');
 // Anomaly persistence is an honest result; it never releases or hides liability.
 return{accepted:result.accepted,releaseEvidenceHash:rel.evidenceHash,usageEvidenceHash:us.evidenceHash,result};
}
