import type { AdaptiveResearchAction } from "./discovery-r12-adaptive-action";
import type { AdaptivePreparationSnapshot } from "./discovery-r12-adaptive-preparation";
import type { AdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import type { AdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";
import type { AdaptiveOwnerResearchProfile, OwnerResearchPublicSelection, selectAdaptiveOwnerResearchPublicScope } from "./discovery-r12-goal-scope";
import type { OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { discoveryV2Hash } from "./discovery-v2";
import type { OwnerObservationSelection } from "./discovery-r12-owner-observation";

/** Readback only: none of these owner-visible packets is a send capability. */
export type AdaptiveOwnerActionRecord = {
  action: AdaptiveResearchAction;
  actionHash: string;
  state: "admitted" | "running" | "settling" | "completed" | "failed" | "stopped";
  outcome: "TEST" | "NEEDS_MORE_EVIDENCE" | "REJECT" | null;
  committedMicrounits: string;
  unresolvedQuestions: string[];
};
export type AdaptiveOwnerSelection = ReturnType<typeof selectAdaptiveOwnerResearchPublicScope> & {
  marketSetKey: OwnerResearchPublicSelection["marketSetKey"];
  topicKey: OwnerResearchPublicSelection["topicKey"];
};
export type AdaptiveOwnerReceipt = {
  version: "r12.owner-adaptive-receipt.1";
  businessId: string; goalId: string;
  setupId: string; setupHash: string; scopeId: string;
  profileId: string; grantId: string; submissionId: string;
  policyId: string; policyHash: string;
  preview: AdaptiveResearchPreview;
  selection: AdaptiveOwnerSelection;
  quote: AdaptiveResearchQuote;
  ownerObservationRef: OwnerObservationSelection | null;
  approvalHash: string;
  confirmed: boolean; activated: boolean; stopped: boolean;
  planId: string | null; planHash: string | null;
  actions: AdaptiveOwnerActionRecord[];
};
export type AdaptiveOwnerCatalog = {
  version: "r12.owner-adaptive-catalog.1";
  businessId: string; goalId: string;
  eligible: boolean; reason: string | null;
  predecessorClosure: OwnerEpisodeClosure | null;
  predecessorClosureHash: string | null;
  imports: AdaptiveResearchPreview["imports"];
  business: AdaptivePreparationSnapshot["business"] & { revision: number; hash: string };
  funding: AdaptivePreparationSnapshot["funding"] | null;
  deadline: string;
  profiles: Array<{ profile: AdaptiveOwnerResearchProfile; profileHash: string }>;
  grants: AdaptivePreparationSnapshot["grant"][];
  setups: AdaptiveOwnerReceipt[];
  activation: { setupId: string; scopeId: string; stopped: boolean; pendingReceiptReadback: boolean; pendingReceiptCount: number;
    pauseReason: "owner_source_operation_required" | null } | null;
  actions: AdaptiveOwnerActionRecord[];
};
export type AdaptiveOwnerSetupAction = { businessId: string; setupId: string; setupHash: string; submissionId: string };

/** Same canonical fingerprint reconstructed by SQL at confirmation. */
export function adaptiveOwnerSetupHash(packet: Pick<AdaptiveOwnerReceipt,"selection"|"grantId"|"approvalHash"|"quote"|"preview"|"submissionId"|"ownerObservationRef">) {
  return discoveryV2Hash({version:"r12.owner-adaptive-setup.1",selection:packet.selection,grantId:packet.grantId,
    approvalHash:packet.approvalHash,quote:packet.quote,preview:packet.preview,submissionId:packet.submissionId,ownerObservationRef:packet.ownerObservationRef});
}
