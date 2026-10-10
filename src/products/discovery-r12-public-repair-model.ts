/** Explicit .2 entrypoint; shared serializer/normalization keep .1 semantics exact. */
import { readPublicResearchModelInputs, buildPublicResearchModelRequest, inspectPublicResearchModelWire, projectPublicResearchModelPhase, type PublicResearchModelContext, type PublicResearchModelInputExpectation } from "./discovery-r12-public-model";
import { publicResearchFail } from "./discovery-r12-public-utils";
export function readPublicResearchRepairModelInputs(raw:unknown,expected:PublicResearchModelInputExpectation):PublicResearchModelContext{
 if((raw as {version?:string})?.version!=="r12.public-research-phase-inputs.2")return publicResearchFail();return readPublicResearchModelInputs(raw,expected);
}
export const buildPublicResearchRepairModelRequest=buildPublicResearchModelRequest;
export const inspectPublicResearchRepairModelWire=inspectPublicResearchModelWire;
export const projectPublicResearchRepairModelPhase=projectPublicResearchModelPhase;
