import type {SteelBrowserAdapter} from '../browser/providers/steel';
import {etsySteelHash as hash,handoffAssert as check,handoffExact,handoffHash,handoffUuid} from './etsy-steel-handoff-contracts';
type Usage=Awaited<ReturnType<SteelBrowserAdapter['retrieveScopedRecoveryUsage']>>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v);
/** Exact-operation recovery only. Provider termination is not an observation of
 * old application observers being disposed. The SQL proof names this distinct
 * pre-handoff case and keeps the whole reservation pending invoice settlement. */
export async function recoverEtsySteelPreHandoff(input:{businessId:string;operationId:string;failedReceiptHash:string;signal:AbortSignal;
 rpc(operation:'inputs'|'record',payload:Record<string,unknown>):Promise<unknown>;
 readUsage(sessionId:string,projectId:string,signal:AbortSignal):Promise<Usage>;
 release(sessionId:string,projectId:string):Promise<{sessionId:string;released:boolean;terminalReadback:boolean}>;
}){
 check(handoffUuid(input.businessId)&&handoffUuid(input.operationId)&&handoffHash(input.failedReceiptHash),'steel_recovery_identity_required');
 input.signal.throwIfAborted();
 const pins={operationId:input.operationId,failedReceiptHash:input.failedReceiptHash};
 const c=await input.rpc('inputs',pins);check(object(c),'steel_recovery_context_required');
 handoffExact(c,'version,businessId,operationId,scopeHash,testEnvelopeId,testEnvelopeHash,providerProjectId,routeHash,requestedTimeoutMs,maximumBrowserMicrounits,failedReceiptHash,configurationAdmissionHash,qualification,contextHash','steel_recovery_context_required');
 const{contextHash,...body}=c;
 check(c.version==='etsy.steel-recovery-context.1'&&c.businessId===input.businessId&&c.operationId===input.operationId&&c.failedReceiptHash===input.failedReceiptHash&&contextHash===hash(body)&&handoffUuid(c.testEnvelopeId)&&handoffUuid(c.providerProjectId)&&[c.scopeHash,c.testEnvelopeHash,c.routeHash,c.configurationAdmissionHash].every(handoffHash)&&Number.isSafeInteger(c.requestedTimeoutMs)&&Number(c.requestedTimeoutMs)>=15000&&money(c.maximumBrowserMicrounits)&&object(c.qualification),'steel_recovery_context_mismatch');
 const project=c.providerProjectId as string;
 const read=async()=>{input.signal.throwIfAborted();const u=await input.readUsage(input.operationId,project,input.signal);input.signal.throwIfAborted();check(u.version==='etsy.steel-recovery-usage.1'&&u.sessionId===input.operationId&&u.providerProjectId===project&&['live','released','failed'].includes(u.providerStatus),'steel_recovery_provider_mismatch');return u;};
 let usage=await read();
 if(usage.providerStatus==='live'){
  const released=await input.release(input.operationId,project);input.signal.throwIfAborted();
  check(released.sessionId===input.operationId&&released.released&&released.terminalReadback,'steel_recovery_release_unconfirmed');usage=await read();
 }
 check(usage.providerStatus!=='live','steel_recovery_terminal_required');
 input.signal.throwIfAborted();
 const result=await input.rpc('record',{...pins,usage:{...usage,version:'etsy.steel-terminal-usage.1'}});
 check(object(result),'steel_recovery_record_unconfirmed');handoffExact(result,'version,operationId,recoveryHash,failedReceiptHash,accountingRecordHash,status,heldMaximumMicrounits,testExposure','steel_recovery_record_unconfirmed');
 check(result.version==='etsy.steel-recovery-receipt.1'&&result.operationId===input.operationId&&result.failedReceiptHash===input.failedReceiptHash&&result.heldMaximumMicrounits===c.maximumBrowserMicrounits&&['qualified_bounded_pending','final_actual','unknown'].includes(String(result.status))&&object(result.testExposure),'steel_recovery_record_unconfirmed');
 if(['qualified_bounded_pending','final_actual'].includes(String(result.status)))check(handoffHash(result.recoveryHash)&&handoffHash(result.accountingRecordHash),'steel_recovery_record_unconfirmed');
 else check(result.recoveryHash===null&&result.accountingRecordHash===null,'steel_recovery_record_unconfirmed');
 return result;
}
