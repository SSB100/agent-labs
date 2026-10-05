# R11 public factual research qualification

Status: implemented candidate awaiting separate production, source and paid-proof qualification. No production migration, source policy, financial authority, paid call or live qualification has been activated by this work. R11 remains active in the [canonical implementation plan](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). R12 is not started.

## Useful permitted lane

Retain Exa search through OpenRouter, followed by a separate exact-span evidence selector. Each approved task selects a useful generic, nonpersonal question and one to six relevant reviewed public domains. The implementation does not select a permanent niche or restrict useful research to government statistics and openly licensed numeric feeds.

Exa explicitly documents [OpenRouter search, extractive highlights and citation annotations](https://exa.ai/docs/integrations/openrouter), and [market/product/competitor research use](https://exa.ai/docs/search/data/news). The reviewed basis is ordinary attributed factual-snippet analysis through the documented API. It is not an assertion that the application owns publisher content or that every page has an open-content license. Missing CC licensing alone is not a blanket prohibition on this use. Applicable source restrictions, access conditions and documented API terms still matter.

Keep Etsy hosts, APIs, listing/shop artifacts and known copied or rehosted Etsy listing content excluded from research/model ingestion. Independent reporting that incidentally mentions Etsy is not automatically an Etsy listing derivative. Exclude incompatible publisher restrictions, login-only/paywalled access, customer/personal data, secret or unpublished business context, bulk reproduction and training corpora. Do not copy competitor artwork, photographs, slogans or listing copy into product assets. A source review records the specific factual use basis and its evidence hash rather than inventing a bespoke license requirement.

Search observations are evidence for later hypotheses. They do not prove sales, demand, low competition or profitability. This R11 proof collects and selects evidence only; R12 owns product research/planning and later production-purpose model qualification.

## Pre-model source and recipient boundary

The search wire retains explicit `engine: "exa"`, `mode: "fast"`, one search use, four results, four total results and at most 1,800 characters per result. It sends both `allowed_domains` and `excluded_domains` to the provider before highlights reach the model. At minimum the exclusions include `etsy.com`, `etsy.me` and `etsystatic.com`; the reviewed task may add exclusions. The selector sends no search tool but carries the same immutable source scope into admission.

[OpenRouter's server-search contract](https://openrouter.ai/docs/guides/features/server-tools/web-search) documents these filters. An OpenAI-native search route would silently ignore exclusions, so it is not interchangeable with this explicit Exa lane. Conflicting locked workspace domain settings can reject a request; that is a failure, not a reason to switch providers or broaden the scope. Domain filters do not guarantee that an allowed publisher has never copied restricted material. Source review and returned-source checks remain necessary, without imposing universal pre-fetching of every page.

Only the exact approved generic public query enters search. The selector receives that query and bounded attributed source excerpts with citation dates/URLs. It does not receive Business IDs, shop identity, customer data, workflow capabilities, private Knowledge context, unpublished strategy or credentials. Each actual POST has exact reviewed bytes, one fixed inference endpoint, required parameters, price caps and no redirects or fallback. A rejected or unavailable route does not authorize another call.

## Privacy disclosure

The inference request sets `data_collection: "deny"` and `zdr: true` and pins an exact endpoint. [OpenRouter documents these inference controls and exact endpoint routing](https://openrouter.ai/docs/guides/routing/provider-selection). Its tool backend is a separate recipient. [Exa's public privacy policy](https://exa.ai/privacy-policy) permits query-data retention and use for improvement/training; no special mediated-account exemption is established here. Model ZDR is not Exa ZDR.

Generic nonpersonal public questions can be qualified with that disclosed retention behavior. This does not require an enterprise ZDR agreement unless the owner actually requires it. The application retains bounded citation/excerpt evidence needed for audit, not a scraped source corpus. Evidence freshness is not a promise to delete records on that date.

## Immutable policy and actual dispatch

The candidate policy binds its exact Business, current owner, existing workflow/goal and confirmed R05 policy; exact query review; allowed/excluded domains and reviewed factual-use basis; recipients/retention; model/endpoint; two finite unit reservations; exact quote and validity; and independent review/approval hashes. A structurally valid object supplied by a form, prompt or caller is not an eligible policy. No policy or authority row is seeded by the migration.

Four additive private RLS tables retain the policy, revocation, trusted collection and phase binding. Direct application-role reads/writes are closed. The new server RPC authenticates through the existing R05 server authority, not Accounts custody keys. Owner revocation does not need a server key. No existing migration or R05 financial function body/ACL is rewritten.

Admission uses the original R05 prepare and guard path in one transaction. It checks the exact R05 policy actually chosen, not just the goal, before attaching a source binding. The binding distinguishes the logical request hash, raw wire-body hash and PostgreSQL descriptor hash. A new trigger at R05's actual sent marker rechecks the immutable binding, current owner/root, source policy, key, expiry and revocation after waits. Old prepare/dispatch/guard entry points cannot bypass source proof, including `research.model` relabelled as source-free. Other source-bearing model operations remain unqualified.

The trusted source producer must follow an actually marked, settled search with the exact provider receipt claim. It persists the bounded collection, raw canonical serialization, content hashes and immutable policy/search lineage before selection. The selector's exact request/wire is bound to that collection. Removing tools or changing labels cannot erase source origins. Revocation serializes with dispatch through the same Business/policy locks; expiry is checked with the current clock after lock waits.

The runtime preserves financial receipts before validating source/model output. Missing, uncertain or oversized charges stop further calls and retain liability. There is one search and one selector slot per policy, with no automatic paid retry. A persisted complete collection can resume an unmarked selector without repeating search. Repeated starts, interrupted admission, lost responses and malformed outputs cannot mint a fresh phase slot or reset a budget.

## Exact endpoint quote and bounded proof proposal

Candidate model: `openai/gpt-5.6-luna`, exact endpoint `azure/us`, returned provider identity `Azure`. These identities must be reverified from the [model endpoint catalog](https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints) and [ZDR endpoint list](https://openrouter.ai/api/v1/endpoints/zdr) immediately before each dispatch. The quote is at most five minutes old and binds exact endpoint identity, supported parameters, all price tiers, context limits and conservative allowances. It ignores irrelevant catalog telemetry, not changed routing or pricing.

At the reviewed catalog snapshot, the regional endpoint has a higher price than base Azure: prompt/completion $0.22/$1.32 per million, and a higher-context tier of $0.44/$1.98. Cache-write liability reaches $0.55 per million. The conservative estimate uses the worst listed tier, including cache writes, plus the documented $0.007 Exa fast-search fee rather than the endpoint's separate native-search price.

- Search reservation: 149,560 microusd using 128,000 input and 8,000 output token allowances
- Selector reservation: 26,311 microusd using at most 16,384 request bytes plus 8,192 formatting tokens and 1,000 output tokens
- Total estimate: 175,871 microusd ($0.175871)
- Proposed additional proof cap: $0.25 USD; this document is not spending approval or an invoice guarantee

The proof permits no extra model-qualification call, fallback, repeated attempt, product selection, creative generation, store mutation or commerce operation. The separate browser allowance cannot fund model calls.

## Live exit and release gates

Before a live proof, reconcile the existing Business's exact historical research reservations, settlements, root funding and R05 exposure. Preserve the original records, canonical root and all unknown liability. Do not create a replacement Business/Quest or reinterpret old funding as new authority. The prior 26 reservations and single funding approval require explicit accounting reconciliation; earlier totals are historical observations, not a fresh spendable balance.

The exact activation packet must include reviewed source domains/query, provider/model/endpoint, generic-query retention disclosure, recipient/data classes, source/terms evidence, immutable policy hash, fresh unit quote, R04/R05/root state, migration bytes, release head/tree and full test evidence. Applying production schema, installing new access/authority or running the paid proof requires the corresponding explicit approval. Existing own-store read/refresh permissions do not supply it.

The final gate must include focused policy/wire/runtime fixtures, the entire quality/build gate, isolated full migration replay/ACL/rollback tests, actual PostgreSQL revocation/expiry/concurrency tests, an independent boundary review and exact-head hosted CI. Until those pass and the separate live proof is approved and recorded, this remains an unqualified R11 candidate.
