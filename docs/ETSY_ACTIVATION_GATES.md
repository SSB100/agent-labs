# Etsy activation remains separately gated

Reviewed 2026-10-02 against [Etsy API Terms of Use](https://www.etsy.com/legal/api/), especially section3 and section5(24)–(25).

Section3 requires Etsy's approval of the application purpose. Section5 restricts automated access, analysis and scraping of Etsy services/data, and API content collection for analytics or machine-learning purposes, absent Etsy's express written authorization. An issued key, personal-access approval or seller OAuth consent must not be described as blanket permission for autonomous agents or marketplace research. This is the project's conservative operational hold pending written clarification of the exact intended functions, not a legal determination about every possible implementation.

## Current implementation boundary

- Do not activate Etsy automated research, browsing, provider actions or execution while this hold is unresolved
- Continue owner-authorized UI development and synthetic, external-network-blocked tests
- Keep account configuration, connection state, Etsy application-purpose authorization, seller consent and one-operation approval separate
- Do not mark a capability enabled solely because a credential exists or a setup form was completed
- Preserve existing closed qualification gates; no new runtime policy, schema, grant or security setting is introduced by this document

## Evidence needed before a separately reviewed activation change

Record the exact approved purpose, operations, data categories and permitted uses from Etsy's written response; reconcile that scope with the intended research/AI pipeline. Then review the application's enforcement, least-privilege access, retention, disclosure, cancellation/reconciliation and acceptance tests before any credential configuration or provider action. Owner permission alone cannot supply Etsy's authorization.

Product evidence, exact asset approval, print placement, Etsy-linked variants, shop-specific fees/currency/tax and Stage22 fulfilment remain independent technical and commercial gates. Resolving the terms question does not implement those missing contracts. Live browser watching also retains its independent privacy-safe delivery blocker.
