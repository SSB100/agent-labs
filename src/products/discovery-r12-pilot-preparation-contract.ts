import type { R04QuestContent } from '../core/quest-contract';
import { R12_ORIGINAL_OBJECTIVE } from './discovery-r12-preparation-contract';
export const R12_PILOT_OBJECTIVE = 'Evaluate one original nature-observation T-shirt composition for a private GB design-readability experiment.';
export const R12_PILOT_QUESTION = 'Can an original leaf, winged seed and pebble composition remain distinct in one six-inch square DTG design and its private small preview?';
export type R12PilotPreparationInput = { businessId: string; sourceScopeId: string; preparationId: string; setupUntil: string };
export type R12PilotPreparationReceipt = R12PilotPreparationInput & { ownerId: string; goalId: string; goalRevision: number; goalHash: string;
  originalGoalId: string; predecessorGoalId?: string; unsentClosureHash?: string; pretransportClosureHash?: string; originalClosedPlanId?: string; originalClosedPlanHash?: string; closedPlanId: string; closedPlanHash: string; acceptedReviewScopeId: string; acceptedReviewHash: string;
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
export function r12PilotGoalContent(input: R12PilotPreparationInput, successor = false, recovery = false, technical = false): R04QuestContent {
  validateR12PilotPreparation(input);
  if (technical && (!successor || recovery)) throw Error('r12_pilot_preparation_kind_invalid');
  return { title: technical ? 'One terminal technical qualification for the GB nature-design pilot' : recovery ? 'One proven-unsent recovery for the GB nature-design pilot' : successor ? 'One research-only successor for the GB nature-design pilot' : 'One original nature-design pilot for GB', originalIntent: R12_ORIGINAL_OBJECTIVE, objective: R12_PILOT_OBJECTIVE,
    parsed: { target: { amount:'1', currency:null, metric:'units' }, budget: { amount:'2', currency:'USD' },
      deadline: { date:input.setupUntil.slice(0,10), time:input.setupUntil.slice(11,19), timezone:'UTC' }, geography:['GB'],
      scope: `${R12_PILOT_QUESTION} ${technical ? 'One separately approved terminal technical qualification preserves the failed recovery, its immutable pretransport reconciliation, the consumed recovery slot and all earlier results and charges.' : recovery ? 'One explicitly approved recovery preserves the stopped unsent attempt, its released reservation, the earlier rejected review and all final charges.' : successor ? 'One research-only successor preserves the closed focused attempt, its rejected review and all final charges.' : 'One new candidate derives from the closed broad nature-shirt research.'} The original four-market decision and all questions remain unresolved history. Preserve the original cumulative USD 2 funding root; this Goal does not renew it.`,
      stopConstraints: [
        `Preparation scope ${input.preparationId}. Closed ${technical ? 'reconciled failed recovery' : recovery ? 'proven-unsent successor' : successor ? 'immediate focused predecessor' : 'research'} scope ${input.sourceScopeId} is history only. A separately reviewed immutable pilot profile must pin its closed plan, accepted NME, source dates, one GB candidate and exact learning measurements before activation.`,
        `Only one strategy and ${successor ? 'at most ' : ''}one independent review, no search, paid retry, fallback or automatic new pilot. Keep the old Goal and exhausted plan history unchanged.`,
        'The original funding root, current Business cap and separately approved two-call policy all remain binding. Preparation itself grants no spending, credentials or provider access.',
        ...(successor ? [`Stop before the reviewer if the new strategy is NEEDS_MORE_EVIDENCE, REJECT, invalid or inconsistent. Preserve valid negative output as accepted evidence; close authority without another paid call. This approval is for exactly one ${technical ? 'terminal technical qualification' : recovery ? 'proven-unsent recovery' : 'successor'} and at most USD 0.277907 for research only.`] : []),
        'Stop on changed intent, source expiry, owner withdrawal, unknown cost, invalid output or exhausted receipts. At most 30 minutes for two dispatches and 30 more minutes for receipts; at most three receipt checks per call.',
        ...(recovery ? ['Only one recovery is permitted for this funding root. The abandoned Goal, request, quote, wire and revoked policy remain closed; fresh authority is required. A second recovery or recursive successor is forbidden.'] : []),
        ...(technical ? ['This is the single terminal technical qualification for this funding root and failed recovery. The earlier recovery slot remains consumed. This qualification cannot be a predecessor for any successor, recovery or further technical qualification, even if preparation, activation or dispatch fails. Use fresh Goal, policy, verifier and wire identities; never resend the closed request.'] : []),
        'Only an independently reviewed TEST can enter separate production-purpose creative approval. One original image may then be proposed with explicit print constraints, rights screening and independent pixel review. No image, publication, commerce or store action is authorized by this preparation.',
      ] }, ambiguities:[] };
}
export function r12PilotPreparationHref(input:R12PilotPreparationInput) {
  return '/dashboard?' + new URLSearchParams({view:'research',type:'r12-pilot-prepare',business:input.businessId,source:input.sourceScopeId,preparation:input.preparationId,setupUntil:input.setupUntil});
}
