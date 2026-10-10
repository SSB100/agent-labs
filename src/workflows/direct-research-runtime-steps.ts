import {FatalError} from 'workflow';
import {executePublicResearchRuntimeStep,type PublicResearchRuntimeInput} from '../products/discovery-r12-public-runtime';
export async function executeDirectResearchPhase(input:PublicResearchRuntimeInput,runtimeRunId:string){
 'use step';
 try{return await executePublicResearchRuntimeStep(input,runtimeRunId);}
 catch{throw new FatalError('Research paused. Reconcile the durable attempt and liability before any replacement call.');}
}
// A failed hosting step is never an implicit paid retry. SQL history remains
// available for the separately admitted receipt recovery or bounded repair.
executeDirectResearchPhase.maxRetries=0;
