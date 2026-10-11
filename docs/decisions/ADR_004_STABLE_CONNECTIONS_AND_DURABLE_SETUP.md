# ADR 004: Stable permission, qualified releases, durable account setup

Status: prospective browser design; focused R11 implementation independently reviewed.
No production activation.
Baseline: main `a4aa0e6166a04915cfe9079ad5d6cfbcc23c6d6e`.
Owner direction: 11 October 2026, revised structural approach approved for implementation.

## Smallest useful implementation slice

The fresh, explicitly authorized 11 October own-shop check demonstrated that R11
already separates its account binding and bounded read window from deployment
identity. Do not add a release registry to R11 or reinterpret historical rows as
new consent. Its existing exact-tree release qualification gate stays in place.

The first useful release therefore improves this established OAuth-first path:
owner-safe verified status and historical result, exact eligibility/recovery
messages, immutable executing-release provenance on new dispatch stages, and
status-only reconciliation of the same interrupted operation. Reconnect means a
fresh exact read-only grant plus actual Etsy consent, never repairing an uncertain
refresh or silently renewing a window. The UI must say when that approval is not
ready. The original grant producer and owner consent remain unchanged.

The stable-permission and durable-browser modules in this change are inert design
contracts only. They do not replace any production authority gate and are not
imported by the R11 runtime. The remaining sections specify future browser/model
adoption, which is separate from this focused release. No usable resumable Steel
handoff is claimed by the OAuth improvement.

## Decision

Separate three facts, then require their intersection immediately before every
external effect. A connection is not a spending approval; a software release is
not an account grant. Keep the existing R05 financial admission, R07 attempt and
receipt rules, immutable evidence and R11 encrypted OAuth implementation.

1. **Operating envelope**: the exact owned Business/Quest, immutable funding
   root, confirmed policy and bounds, allowed operations, source/data recipients,
   expiry and Stop. The existing ledger owns amounts, reservations, unknown
   liability, used attempts and cumulative counters. No new parallel ledger.
2. **Connection revision**: the exact owned account/provider/project/application,
   secret reference and keyed configuration binding, scopes, endpoint policy,
   data/retention facts and access expiry. A stable configuration hash excludes
   deployment identifiers. Changing a key, account, scope, recipient, tariff or
   retention fact creates a different revision and needs the applicable approval.
   Public research and private owner observations need no account connection.
3. **Qualified release**: exact repository/commit/tree/deployment, complete current
   database-definition/ACL fingerprint, migration inventory and qualification
   evidence. An independent review binds this exact release to a semantic
   security-contract hash. No wildcard, version range, self-declared compatibility
   or unqualified deployment is admitted.

All three remain expiry/revocation checked. A routine compatible release replaces
only the third record, after the normal exact-tree qualification gate. It does not
change the first two records, refresh their dates, move liabilities or grant new
access. Every dispatch and receipt records its exact executing release. A delayed
receipt may be ingested after Stop or release revocation but cannot launch work.

## Preserve the full fingerprint

Do not shrink `r12_direct_enrollment_definition_hash`, omit UI-named functions,
weaken ACL checks or accept any deployment with a claimed contract version. Move
full current-definition equality to the qualified-release gate. The independently
reviewed semantic contract describes the security invariants that a release must
implement; its hash is a compatibility label only when backed by a trusted,
append-only exact-release compatibility record.

A deployment has to be identified from the trusted runtime, never owner form
fields. SQL validates it at model and browser transport admission, including the
existing setup, verification and source consume markers. Short-lived permits pin
the exact operation/request body, stable permission revisions, current release,
current database fingerprint and expiration. Permit reuse never resends an effect.

## Prospective adoption only

Legacy enrollment and its historical release pins remain unchanged. Existing
successor, replacement, setup and consumed envelopes cannot opt themselves into
this contract. There is no migration seed, fallback mapping, default grant or
automatic legacy conversion. New adoption requires a fresh reviewed packet and
whatever specific access/financial approval that packet needs. An absent or
uninstalled contract is Blocked, not a repeated request to approve missing code.

The stopped 11 October test stays stopped: its USD 0.025 held maximum/unknown
actual, USD 10 ceiling, eight remaining research units, lifetime ceiling 57,
original funding root and 12 October 02:06 UTC expiry remain historical facts.
They are not reset, extended, reallocated or carried to another research mode by
this software change. No new OAuth grant, browser profile, provider activation,
server key or paid call is authorized by the implementation approval.

## Durable setup on the existing Workflow runtime

Persist one immutable operation identity and exact intended request before a
transport marker. Reuse the existing financial and browser-operation ledger.
Do not wrap the old all-in-one begin function inside one retried Workflow step.
Do not introduce a new orchestrator or force browser work into R07's current
OpenRouter-specific prepared-call adapter.

Each wake reconstructs a saved lifecycle and performs at most one guarded phase:

- prepared: approved scope and exact request exist; reserve and mark atomically
- create marked: exactly one create may be sent by the marker winner
- create uncertain: only exact operation/project readback; never another create
- session observed: encrypt/checkpoint returned provider session/profile identity
- entry preparation: use the reviewed fixed navigation and observer boundary
- owner ready: publish only a persisted, verified physical-disconnect proof
- owner returned: invalidate viewer first, then exact-session release/readback
- profile pending: poll the same persisted profile until READY or deadline
- verification pending: separate, explicitly approved read-only identity check
- complete, blocked, stopped, expired: no new effects; cleanup/reconciliation only

Creation, connection/navigation, disconnect/publication, owner wait, profile
readback and cleanup have separate finite deadlines, each bounded by the original
access/session expiry. UI polling reads stored state and does not run a phase.
Repeated clicks, request cancellation, lost HTTP replies and newer navigation
return to the same operation. They do not consume another attempt or create a
successor. Missing provider response or 404 is not proof that no effect occurred.

An interrupted active observer phase cannot resume arbitrary pages or claim that
disconnect was witnessed. Reconcile and clean up safely unless an independently
qualified exact-session preparation procedure can establish its full invariants.
A provider's live status is not a physical-disconnect proof, authenticated shop
identity or demand evidence.

Stop commits viewer invalidation and dispatch revocation before cleanup. A durable
Workflow cleanup path reads the private exact-session cleanup record without
requiring an active handoff, create permit, owner-view lease or unexpired access.
Cleanup may outlive owner access, but can only release/read back the same session
and retain/settle liability from qualified evidence. Unknown cost remains held.

## Owner journey and evidence boundaries

The normal entry offers permitted research and saved owner observations without
requiring Steel or OAuth. Existing R12 owner-observation intake and its reviewed
three-role research engine are reused. A researched hypothesis is not proven
Etsy demand; imported observations remain owner supplied and date/source bound.

Connections shows Etsy own-shop API access separately from optional browser-only
access. Inspect the existing Personal Access app and current nonsecret status,
scopes and account binding before proposing new access. Reuse R11 PKCE/encrypted
OAuth with minimum scopes. Never create a duplicate app/key or silently upgrade
`shops_r`/`listings_r` to write scopes. A present application key does not establish
valid OAuth, shop identity or approved analytics use.

No documented Marketplace Insights API is assumed. Own-shop OAuth does not grant
Marketplace Insights or blanket marketplace analytics/scraping permission. A
browser session is optional, task-specific and needs its own exact persistent
access approval and legal/source eligibility. A handoff is ready only when the
real private viewer has been published and its security boundary verified.

## Coherent implementation stages

1. Design and independently review the future semantic/browser contracts. Keep
   them inert; do not modify the legacy stopped enrollment or its global hash.
2. Qualify the smaller R11 OAuth-first owner journey using existing gates: clear
   saved connection status, current-sign-in/refresh eligibility, exact-operation
   reconciliation and Stop, with appended executing-release receipts. Use the
   existing native SQL and real Next test jobs, not a new qualification system.
   The additive migration remains uninstalled until its exact reviewed bundle is
   approved; old callers remain supported during migration-first rollout.
3. Separately implement the optional browser lifecycle only when its genuinely
   necessary task and access approval are established. The full durable crash,
   duplicate-session, cleanup and compatible-release cases below must pass before
   calling that browser handoff ready. No new research engine is needed.

## Decisive regressions

- Two exact qualified deployments supporting one independently reviewed semantic
  contract preserve the identical connection/envelope IDs, dates and counters.
- Unknown/unqualified/mismatched/revoked/expired deployment or database fingerprint
  blocks dispatch. Missing release receipt blocks model and every browser marker.
- Changed key/project/account/scopes/endpoint/source/recipient/retention/tariff,
  policy/budget/counters or expiry cannot be hidden by a compatible release label.
- Cross-owner/Business/Quest/request/revision/contract pins fail closed. No API
  role may publish compatibility facts or mutate immutable history directly.
- Revoked/expired/Stopped access and concurrent Stop versus dispatch serialize;
  cleanup and late exact billing remain possible without renewed authority.
- Crash before mark causes zero effects; crash after mark and before/after send
  yields exact reconciliation and at most one create. Duplicate wake/click never
  reuses a consumed marker. Conflicting response and reused receipt are rejected.
- A checkpointed session survives HTTP loss/process replacement. Unverified
  observer disposal cannot expose a viewer or become a verified profile.
- Close/Cancel/Back/Forward, new navigation and reload preserve exact operation
  history and never turn page reads into setup, OAuth refresh or paid research.
- Public/owner-evidence research works with absent account login; own-shop OAuth
  never satisfies Insights/demand/source permission checks.
- Replaying all migrations leaves the legacy stopped envelope, held exposure,
  expiry and counters unchanged, with zero new grants/dispatch/session rows.
