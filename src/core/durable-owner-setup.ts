/** A finite projection for the existing Workflow step runner, not another
 * orchestrator. SQL owns immutable checkpoints, CAS, release/owner admission and
 * dispatch markers. No decision returned here is authority to call a provider. */
export const OWNER_SETUP_PHASES = Object.freeze(['prepared','create_marked','session_saved','preparing','disconnected',
  'awaiting_owner','returned','profile_pending','pending_verification','complete','cleanup_pending','terminal'] as const);
export type OwnerSetupPhase = typeof OWNER_SETUP_PHASES[number];
export type DurableOwnerSetupSnapshot = {
  version:'core.durable-owner-setup.1'; operationId:string; businessId:string; ownerId:string;
  requestHash:string; scopeHash:string; revision:number; phase:OwnerSetupPhase;
  approvedAt:string; expiresAt:string; stopped:boolean; revoked:boolean;
  createMarked:boolean; sessionCheckpointHash:string|null; disconnectProofHash:string|null;
  handoffRecordHash:string|null; ownerReturned:boolean; terminalProofHash:string|null;
  profileReadyProofHash:string|null;
};
export type OwnerSetupWake = {
  action:'admit_create'|'reconcile_create'|'admit_prepare'|'publish_saved_handoff'|'wait_for_owner'|
    'release_exact_session'|'read_exact_profile'|'await_separate_verification'|'finish';
  reason:string; operationId:string; expectedRevision:number; deadline:string;
};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const fail=():never=>{throw Error('owner_setup_checkpoint_unverified');};
function check(v:unknown):asserts v{if(!v)fail();}
const isHash=(v:unknown):v is string=>typeof v==='string'&&HASH.test(v);
const instant=(v:unknown):number=>{check(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v));const n=Date.parse(v);check(Number.isFinite(n)&&new Date(n).toISOString()===v);return n;};
/** Read-only wake planning. The SQL transition must re-read all authority after
 * locking and compare expectedRevision; a stale planned action is not usable. */
export function planOwnerSetupWake(raw:DurableOwnerSetupSnapshot,now=Date.now()):OwnerSetupWake{
  check(raw!==null&&typeof raw==='object'&&Object.getPrototypeOf(raw)===Object.prototype);
  const keys='version,operationId,businessId,ownerId,requestHash,scopeHash,revision,phase,approvedAt,expiresAt,stopped,revoked,createMarked,sessionCheckpointHash,disconnectProofHash,handoffRecordHash,ownerReturned,terminalProofHash,profileReadyProofHash';
  check(Object.keys(raw).sort().join(',')===keys.split(',').sort().join(','));
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(raw)))check('value'in descriptor&&!descriptor.get&&!descriptor.set&&descriptor.enumerable);
  const s=structuredClone(raw);
  check(s.version==='core.durable-owner-setup.1'&&[s.operationId,s.businessId,s.ownerId].every(v=>typeof v==='string'&&UUID.test(v))&&
    [s.requestHash,s.scopeHash].every(isHash)&&Number.isSafeInteger(s.revision)&&s.revision>=0&&Number.isSafeInteger(now)&&
    OWNER_SETUP_PHASES.includes(s.phase)&&[s.stopped,s.revoked,s.createMarked,s.ownerReturned].every(v=>typeof v==='boolean'));
  check([s.sessionCheckpointHash,s.disconnectProofHash,s.handoffRecordHash,s.terminalProofHash,s.profileReadyProofHash].every(v=>v===null||isHash(v)));
  const start=instant(s.approvedAt),end=instant(s.expiresAt);check(start<end);
  check(!s.sessionCheckpointHash||s.createMarked);
  check(!s.disconnectProofHash||s.sessionCheckpointHash);
  check(!s.handoffRecordHash||s.disconnectProofHash);
  check(!s.ownerReturned||s.handoffRecordHash);
  check(!s.profileReadyProofHash||s.ownerReturned&&s.terminalProofHash);
  check(s.phase!=='prepared'||!s.createMarked);
  check(!['session_saved','preparing','disconnected','awaiting_owner','returned','profile_pending','pending_verification','complete'].includes(s.phase)||s.sessionCheckpointHash);
  check(!['disconnected','awaiting_owner','returned','profile_pending','pending_verification','complete'].includes(s.phase)||s.disconnectProofHash);
  check(!['awaiting_owner','returned','profile_pending','pending_verification','complete'].includes(s.phase)||s.handoffRecordHash);
  check(!['returned','profile_pending','pending_verification','complete'].includes(s.phase)||s.ownerReturned);
  check(!['pending_verification','complete'].includes(s.phase)||s.profileReadyProofHash);
  check(!['create_marked','cleanup_pending'].includes(s.phase)||s.createMarked);
  const wake=(action:OwnerSetupWake['action'],reason:string):OwnerSetupWake=>Object.freeze({action,reason,operationId:s.operationId,expectedRevision:s.revision,deadline:s.expiresAt});
  if(s.phase==='terminal'){
    check(!s.createMarked||s.terminalProofHash);return wake('finish','terminal_history_preserved');
  }
  if(s.stopped||s.revoked||now>=end){
    if(!s.createMarked||s.terminalProofHash)return wake('finish',s.stopped?'stopped':s.revoked?'revoked':'expired');
    return wake('release_exact_session','access_closed_cleanup_only');
  }
  check(now>=start);
  if(s.phase==='prepared')return wake('admit_create','fresh_marker_required');
  if(s.phase==='create_marked')return wake('reconcile_create','marked_operation_never_resends');
  if(s.phase==='session_saved')return wake('admit_prepare','exclusive_preparation_marker_required');
  if(s.phase==='preparing')return wake('release_exact_session','interrupted_observers_cannot_be_assumed_disconnected');
  if(s.phase==='disconnected')return wake('publish_saved_handoff','publish_committed_disconnect_proof_without_reconnecting');
  if(s.phase==='awaiting_owner')return wake('wait_for_owner','persisted_expiry_wake_required');
  if(s.phase==='returned'||s.phase==='cleanup_pending')return s.terminalProofHash?
    wake(s.ownerReturned?'read_exact_profile':'finish',s.ownerReturned?'same_profile_only':'terminal_history_preserved'):
    wake('release_exact_session','exact_terminal_readback_required');
  if(s.phase==='profile_pending'){
    check(s.terminalProofHash);return wake('read_exact_profile','same_profile_only');
  }
  if(s.phase==='pending_verification')return wake('await_separate_verification','ready_profile_is_not_account_verification');
  return wake('finish','setup_history_preserved');
}
