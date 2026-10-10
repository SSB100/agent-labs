import {validatePublicResearchPolicy,type PublicResearchPolicy,type PublicResearchPhase} from './discovery-r12-public-contracts';
import {validatePublicResearchState,type PublicResearchState} from './discovery-r12-public-cycle';
export type PublicResearchDriverDecision=
 |{kind:'stage_complete';questComplete:false;researchStageOutcome:PublicResearchState['researchStageOutcome']}
 |{kind:'pause';reason:'technical_repair_requires_qualified_suffix'|'missing_command'|'cycle_state_unconfirmed'}
 |{kind:'continue_attempt';phase:PublicResearchPhase;attemptId:string}
 |{kind:'schedule';phase:PublicResearchPhase;expectedStateHash:string};
/** A deterministic controller decision, not dispatch authority. SQL still checks
 * Stop, current quote, entire financial ledger and exact phase dependencies. */
export function decidePublicResearchDriverAction(policy:PublicResearchPolicy,raw:PublicResearchState):PublicResearchDriverDecision{
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
