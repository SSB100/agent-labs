# Login-free research entry

Status: implementation and draft qualification.
Baseline: PR 89 merge `76abe0c35fcbb403b1d5569c241690f27a4f26f4`,
tree `63331c2cf81b97389412d2b5a234429c246e5274`.

## Small, useful scope

The existing private owner-observation store already requires only an authenticated
Agent Labs owner and the exact owned Business. It does not require an Etsy OAuth
connection, a stored browser session or a research grant. This change makes that
existing path visible before optional operator setup and paid research controls.

- Start with the actual saved Quest and an explicit evidence choice.
- Explain genuine Etsy observations separately from reviewed public-source options.
- Lead fresh entries with private evidence intake. Exact saved packet URLs still
  lead with that packet and its Stop controls.
- Move the non-authorizing grant-UUID verifier into a closed Advanced section.
  Opening or closing it does not submit the verifier.
- Explain preparation blockers using the same predicates as the existing button.
  Saving private evidence stays available when research preparation is blocked.
- Keep historical formats, negative observations, cumulative costs and stopped
  packets unchanged. Findings remain hypotheses unless evidence supports more.

No API, database migration, engine, grant producer, source importer, account access
or execution handler is added. The existing encrypted OAuth and optional stopped
browser flow are not on this journey's critical path.

## Boundaries that remain enforced

“No shop login” does not mean anonymous access. Agent Labs owner authentication
and Business ownership still protect every record.

The capture form accepts genuine aggregate Etsy observations with exact source
URL, reporting dates, displayed text, limitations and privacy review. It is not a
general URL importer, automatic marketplace scraping or a Marketplace Insights
API. A saved owner capture is attributed, untrusted evidence, not independently
verified demand. Missing or adverse evidence remains visible.

The existing three-role Etsy-observation lane is continuation-only: it still
requires an eligible closed predecessor, retained imports, reviewed profile and
finite grant, clean funding, current window, selected observations and exact
scope choices. A new Quest can save evidence without being able to run that lane.
Earlier five-phase packets retain their recorded roles and costs.

Preparation only produces the existing fresh quote and review packet. Exact
source disclosure, recipients, policy hash and cumulative costs must still be
reviewed before confirmation. Confirmation does not silently dispatch. Stop,
expiry, one-shot admission and existing receipt reconciliation are unchanged.
The old stopped Steel envelope, held liability, counters and expiry are not reused.

## Qualification

- 27 focused owner research UI tests passed, including eleven preparation-blocker
  cases with private intake still available and zero preparation calls.
- 12 private-capture, bootstrap-route and evidence tests passed.
- Nine release-gate tests passed. Typecheck and lint passed.
- The actual Next owner journey now checks closed/inert advanced setup, missing
  adaptive permission, direct private-evidence navigation and unchanged provider
  calls. The existing capture, exact quote/disclosure, consent reset, history,
  keyboard/mobile, interruption and Stop journeys remain required in full CI.
- This executor's known Chromium socket restriction is unchanged; no repeated
  browser launch or alternate-machine attempt is made. Hosted actual Chromium
  acceptance and all normal exact-head release gates remain required.

The exact draft branch is Vercel-nondeploying and runs the normal complete CI gate.
No qualification dependency is removed or weakened. No live grant, paid run,
provider session or new source operation is part of this implementation check.
