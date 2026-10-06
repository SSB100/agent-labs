/** Reviewed one-scope correction only. Import has no connection, credential or provider effect.
 * The genuine owner must revoke the unused Business6 policy, save the exact
 * Business7 content, and confirm its replacement before this activation.
 * Existing source/installation/operation history is never rewritten.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ACTIVATION_SQL} from './r12-research-bootstrap.mjs';
export const REBIND = Object.freeze({
  "expectedRevision": 6,
  "expectedPreviousHash": "97441d08503e1640763a6da50c191ae13aa4b23e86ffe0e2b25b3789005ead12",
  "expectedResultRevision": 7,
  "preference": "setup",
  "content": {
    "brandContext": "Agent Labs original Business. Preserve existing research history and its financial records.",
    "allowedActivity": "One owner-approved R12 evidence-led research packet for original nature T-shirts for adult outdoor/nature enthusiasts, comparing US, GB, AU and NZ and at most three original concept hypotheses. This permission applies only to Goal 3548865c-238a-48ed-8469-6b0f32ac0f95 and source scope 33bbb31d-b7ef-4ac2-9937-a282a550c209: planner, one public search, exact-span evidence selector, strategist and independent reviewer. The result may recommend a research TEST, REJECT or NEEDS_MORE_EVIDENCE; it grants no creative or commerce permission.",
    "operatingRules": "This exact R12 permission supersedes the obsolete R11-only research limits in Business revision 6 without changing any historical revision, result, charge or approval. Preserve the original research funding root 3ebba15b-eaac-457e-8828-1311070b89fa, its cumulative USD 2 allowance and all prior rounds. Include all prior Business exposure in the USD 1.053587 lifetime ceiling; this one packet permits at most USD 0.406736 additional model/search cost and five dispatches. There is no budget reset, increase beyond those amounts, additional collection, generation retry, repair, pivot or provider fallback. Setup and Goal end at 2026-10-06T08:20:35.000Z. Final reviewed activation starts a separate dispatch window of at most thirty minutes, followed by at most thirty minutes solely for existing receipts; dispatch must end by the setup cutoff, and receipt-only work must end no later than thirty minutes after that dispatch deadline. Each of the five phases permits at most three separately claimed single metadata GETs, fifteen total, separated by at least 120 seconds and any longer Retry-After. The assistant may operate the genuine owner Continue/Stop controls within this one approved packet. Save bounded responses privately before receipt lookup; preserve original generation identity and known or unresolved cost. Admit the next phase only after valid saved output, known in-cap cost and a correlated provider/model receipt. Use fresh age-aware five-minute quotes at or below each approved phase ceiling. Stop the packet after the final independent research outcome (TEST, REJECT or NEEDS_MORE_EVIDENCE), or earlier on terminal failure, changed scope, expiry, unknown or over-limit cost, invalid evidence, exhausted receipts or owner withdrawal. A valid strategist proposal still goes to the independent reviewer. Revoke the exact policy and its two scoped verifier enrollments at closeout. No R11 renewal or new key entry is authorized.",
    "restrictions": "Use only attributed minimal public factual snippets from the reviewed ipsos.com/mdpi.com scope and its exact generic nonpersonal query; exclude Etsy marketplace content, individual reviews, participant quotations and artwork. The first four inference phases use OpenRouter Azure-US Luna and the independent review uses Bedrock-US Haiku, with qualified no-training/ZDR inference and no fallback. Exa search-query retention is separately disclosed and is not inference ZDR. Only the original research objective, adult audience/country scope, pinned public guidance, original hypotheses and necessary public evidence/analysis may reach inference. No credentials, customer records, personal participant data or private customer strategy. No image or creative generation, product drafts, listings, publication, orders, commerce, store access or account changes are permitted by this R12 packet. Existing store connections and their separately approved bounded read/refresh permissions are not expanded by this amendment. No downstream workflow beyond these five research phases may run."
  },
  "policyRebind": {
    "oldPolicyId": "11d8c7a5-a4a0-4949-ac38-dd880b65a926",
    "oldPolicyHash": "fbaba11a6cbf22ae0bc482d065697fb8bbe4fa22330c3feea0fa7c40bfb6228c",
    "businessRevision": 7,
    "expectedCapRevision": 7,
    "resultCapRevision": 8,
    "businessLifetimeLimitMicrounits": "1053587",
    "policyLimitMicrounits": "406736",
    "maximumDispatches": 5
  },
  "status": "review draft; no mutation performed",
  "expectedResultHash": "0e6081637effbcc059277327b6d4672c0170d58c013555db1bd5030ca68e5ba1",
  "previousContent": {
    "brandContext": "Agent Labs original Business. Preserve existing research history and its financial records.",
    "restrictions": "No commerce, product selection, artwork copying, Etsy access, account changes, private Business or buyer data, or downstream workflow launch. Stop on unknown or over-cap cost, invalid evidence, stale source authority, or owner withdrawal.",
    "operatingRules": "Preserve all five prior permissions and four paid charges, including the unused third permission. The fifth search failed with final HTTP 404 after three receipt attempts; this does not prove every attempt was 404. Later metadata availability does not qualify old output. Permit one separately owner-approved durable-recovery attempt on the same Goal, within a fixed thirty-minute maximum: one search and one selector. The assistant may operate Continue through the existing authenticated owner session. Each phase permits at most three separately claimed single metadata GETs for its exact saved generation, six total, with at least 120 seconds between claims and any longer Retry-After respected. Bounded schema-validated responses are retained privately as immutable audit data, not qualified evidence until checks pass. Runtime content access ends at the original receipt grace; there is no physical TTL purge. Publication content remains held separately. Stop on terminal failure, success, withdrawal or exhausted authority; transient metadata unavailability may remain pending for an authorized Continue. No generation retry, provider fallback, new key entry, renewal or new budget. Additional maximum is USD 0.211245 within the remaining original allowance; lifetime ceiling stays USD 0.848063 including all prior exposure",
    "allowedActivity": "R11 public-research qualification: retrieve bounded public factual snippets and return an attributed evidence pack."
  }
});
const baseSha256='03243e3ce22913ad25abe6048c3824bb12ebaa341cdf70510075492377221133';
if(createHash('sha256').update(readFileSync(new URL('./r12-research-bootstrap.mjs',import.meta.url))).digest('hex')!==baseSha256)throw Error('Reviewed bootstrap source changed');
function replace(sql,from,to,count=1){if(sql.split(from).length-1!==count)throw Error('Rebind source pin drift: '+from);return sql.replaceAll(from,to);}
let sql=ACTIVATION_SQL;
sql=replace(sql,"s.revision=6 and v.preference='setup' and v.content_hash='"+REBIND.expectedPreviousHash+"'","s.revision=7 and v.preference='setup' and v.content_hash='"+REBIND.expectedResultHash+"'");
sql=replace(sql,"'businessRevision',6","'businessRevision',7",2);
sql=replace(sql,"'businessHash','"+REBIND.expectedPreviousHash+"'","'businessHash','"+REBIND.expectedResultHash+"'");
sql=replace(sql,"'expectedCapRevision',6","'expectedCapRevision',7");
sql=replace(sql,"if cap.revision<>7 or cap.maximum_microunits<>1053587","if cap.revision<>8 or cap.maximum_microunits<>1053587");
const oldPolicyCheck=`
 -- Only the already staged and still unused approved scope may be rebound.
 if sid<>'33bbb31d-b7ef-4ac2-9937-a282a550c209'::uuid or g<>'3548865c-238a-48ed-8469-6b0f32ac0f95'::uuid
  or not exists(select 1 from private.r04_business_versions where business_id=b and revision=6 and content_hash='${REBIND.expectedPreviousHash}')
  or not exists(select 1 from private.r05_policies old_policy where old_policy.id='${REBIND.policyRebind.oldPolicyId}'::uuid and old_policy.business_id=b and old_policy.actor_id=owner_id and old_policy.content_hash='${REBIND.policyRebind.oldPolicyHash}' and old_policy.payload->>'goalId'=g::text and old_policy.payload->'businessRevision'='6'::jsonb and exists(select 1 from private.r05_revocations where policy_id=old_policy.id))
  or exists(select 1 from private.r05_requests where policy_id='${REBIND.policyRebind.oldPolicyId}'::uuid)
  or exists(select 1 from private.r05_policy_proofs where policy_id='${REBIND.policyRebind.oldPolicyId}'::uuid)
  then raise exception 'bootstrap_rebind_exact_unused_revoked_policy_required';end if;
`;
sql=replace(sql," foreach field in array array['policyHash'",oldPolicyCheck+" foreach field in array array['policyHash'");
export const REBOUND_ACTIVATION_SQL=sql;
