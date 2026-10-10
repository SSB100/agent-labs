import{validatePublicResearchRepairPolicy,validatePublicResearchRepairState,type PublicResearchRepairPolicy,type PublicResearchRepairState}from './discovery-r12-public-repair';
import {validatePublicResearchPolicy,type PublicResearchPolicy,type PublicResearchPhase} from './discovery-r12-public-contracts';
import {validatePublicResearchState,type PublicResearchState} from './discovery-r12-public-cycle';
export type PublicResearchDriverDecision=
 |{kind:'stage_complete';questComplete:false;researchStageOutcome:PublicResearchState['researchStageOutcome']}
 |{kind:'pause';reason:'technical_repair_requires_qualified_suffix'|'missing_command'|'cycle_state_unconfirmed'|'source_access_reconciliation_required'|'review_closure_required'}
 |{kind:'continue_attempt';phase:PublicResearchPhase;attemptId:string}
 |{kind:'schedule';phase:PublicResearchPhase;expectedStateHash:string};
/** A deterministic controller decision, not dispatch authority. SQL still checks
 * Stop, current quote, entire financial ledger and exact phase dependencies. */
export function decidePublicResearchDriverAction(policy:PublicResearchPolicy|PublicResearchRepairPolicy,raw:PublicResearchState|PublicResearchRepairState):PublicResearchDriverDecision{
 if(policy.version==='r12.direct-etsy-attempt-policy.2'){
  const p=validatePublicResearchRepairPolicy(policy),s=validatePublicResearchRepairState(raw,p);
  if(s.researchWindowComplete||s.terminal)return{kind:'stage_complete',questComplete:false,researchStageOutcome:s.researchStageOutcome};
  if(s.nextAction==='source_paused')return{kind:'pause',reason:'source_access_reconciliation_required'};
  if(s.nextAction==='accept_review')return{kind:'pause',reason:'review_closure_required'};
  if(s.nextAction==='dispatch_scheduled'||s.nextAction==='receipt_only'){const call=s.actualPhaseCalls.at(-1);if(!call)return{kind:'pause',reason:'cycle_state_unconfirmed'};return{kind:'continue_attempt',phase:call.phase,attemptId:call.phaseAttemptId};}
  if(s.nextPhase&&['initial_cycle','next_cycle','next_phase','repair_model'].includes(s.nextAction))return{kind:'schedule',phase:s.nextPhase,expectedStateHash:s.stateHash};
  return{kind:'pause',reason:'cycle_state_unconfirmed'};
 }
 const p=validatePublicResearchPolicy(policy),s=validatePublicResearchState(raw,p);
 if(s.researchWindowComplete||s.terminal)return{kind:'stage_complete',questComplete:false,researchStageOutcome:s.researchStageOutcome};
 const last=s.attempts.at(-1);
 if(last?.status==='technical_failed')return{kind:'pause',reason:'technical_repair_requires_qualified_suffix'};
 if(last?.status==='running'){
  const d=last.dispatches.at(-1);if(!d)return{kind:'pause',reason:'cycle_state_unconfirmed'};
  if(d.receiptHash===null)return{kind:'continue_attempt',phase:d.phase,attemptId:d.attemptId};
  const next=({plan:'source',source:'strategy',strategy:'review',review:null} as const)[d.phase];
  return next?{kind:'schedule',phase:next,expectedStateHash:s.stateHash}:{kind:'pause',reason:'cycle_state_unconfirmed'};
 }
 if(!s.pendingCommand)return{kind:'pause',reason:'missing_command'};
 return{kind:'schedule',phase:'plan',expectedStateHash:s.stateHash};
}
