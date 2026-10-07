import type { R04QuestContent } from '../core/quest-contract';
import { R12_ORIGINAL_OBJECTIVE } from './discovery-r12-preparation-contract';
export const R12_PILOT_OBJECTIVE = 'Evaluate one original nature-observation T-shirt composition for a private GB design-readability experiment.';
export const R12_PILOT_QUESTION = 'Can an original leaf, winged seed and pebble composition remain distinct in one six-inch square DTG design and its private small preview?';
export type R12PilotPreparationInput = { businessId: string; sourceScopeId: string; preparationId: string; setupUntil: string };
export type R12PilotPreparationReceipt = R12PilotPreparationInput & { ownerId: string; goalId: string; goalRevision: number; goalHash: string;
  originalGoalId: string; predecessorGoalId?: string; originalClosedPlanId?: string; originalClosedPlanHash?: string; closedPlanId: string; closedPlanHash: string; acceptedReviewScopeId: string; acceptedReviewHash: string;
  rootId: string; priorId: string; installationId: string; controllerKeyHash: string; admissionKeyHash: string; authorityCreated: false };
export type R12PilotPreparationState = { message: string; receipt: R12PilotPreparationReceipt | null };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function validateR12PilotPreparation(input: R12PilotPreparationInput, now?: number) {
  if (!input || Object.keys(input).sort().join(',') !== 'businessId,preparationId,setupUntil,sourceScopeId' ||
      ![input.businessId,input.sourceScopeId,input.preparationId].every(uuid) || input.preparationId === input.sourceScopeId) throw Error('r12_pilot_preparation_invalid');
  const end = new Date(input.setupUntil);
  if (typeof input.setupUntil !== 'string' || !Number.isFinite(end.getTime()) || end.toISOString() !== input.setupUntil || end.getUTCMilliseconds() !== 0 ||
      now !== undefined && (end.getTime() <= now + 3_600_000 || end.getTime() > now + 86_400_000)) throw Error('r12_pilot_setup_window_invalid');
  return input;
}
export function r12PilotGoalContent(input: R12PilotPreparationInput, successor = false): R04QuestContent {
  validateR12PilotPreparation(input);
  return { title: successor ? 'One research-only successor for the GB nature-design pilot' : 'One original nature-design pilot for GB', originalIntent: R12_ORIGINAL_OBJECTIVE, objective: R12_PILOT_OBJECTIVE,
    parsed: { target: { amount:'1', currency:null, metric:'units' }, budget: { amount:'2', currency:'USD' },
      deadline: { date:input.setupUntil.slice(0,10), time:input.setupUntil.slice(11,19), timezone:'UTC' }, geography:['GB'],
      scope: `${R12_PILOT_QUESTION} ${successor ? 'One research-only successor preserves the closed focused attempt, its rejected review and all final charges.' : 'One new candidate derives from the closed broad nature-shirt research.'} The original four-market decision and all questions remain unresolved history. Preserve the original cumulative USD 2 funding root; this Goal does not renew it.`,
      stopConstraints: [
        `Preparation scope ${input.preparationId}. Closed ${successor ? 'immediate focused predecessor' : 'research'} scope ${input.sourceScopeId} is history only. A separately reviewed immutable pilot profile must pin its closed plan, accepted NME, source dates, one GB candidate and exact learning measurements before activation.`,
        `Only one strategy and ${successor ? 'at most ' : ''}one independent review, no search, paid retry, fallback or automatic new pilot. Keep the old Goal and exhausted plan history unchanged.`,
        'The original funding root, current Business cap and separately approved two-call policy all remain binding. Preparation itself grants no spending, credentials or provider access.',
        ...(successor ? ['Stop before the reviewer if the new strategy is NEEDS_MORE_EVIDENCE, REJECT, invalid or inconsistent. Preserve valid negative output as accepted evidence; close authority without another paid call. This approval is for exactly one successor and at most USD 0.277907 for research only.'] : []),
        'Stop on changed intent, source expiry, owner withdrawal, unknown cost, invalid output or exhausted receipts. At most 30 minutes for two dispatches and 30 more minutes for receipts; at most three receipt checks per call.',
        'Only an independently reviewed TEST can enter separate production-purpose creative approval. One original image may then be proposed with explicit print constraints, rights screening and independent pixel review. No image, publication, commerce or store action is authorized by this preparation.',
      ] }, ambiguities:[] };
}
export function r12PilotPreparationHref(input:R12PilotPreparationInput) {
  return '/dashboard?' + new URLSearchParams({view:'research',type:'r12-pilot-prepare',business:input.businessId,source:input.sourceScopeId,preparation:input.preparationId,setupUntil:input.setupUntil});
}
