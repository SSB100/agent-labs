# Bounded Work and raw Activity contract

This is the first Work/Activity slice of R02 in the [remaining implementation plan](AGENT_LABS_V2_IMPLEMENTATION_PLAN.md). It does not complete Library, Research, retained technical pages, private-history pagination, canonical Quest identity or work-episode Events. Release acceptance is recorded separately; source presence alone is not acceptance.

## Read and identity boundary

- The root Work and Activity views branch before the recent-80 collection and legacy detail loader. Every list uses a fixed 25-row server page plus one sentinel, exact filtered counts, and a timestamp/ID tie-break. A missing or inconsistent count is unknown.
- Work name search addresses the persisted workflow definition name; Activity search addresses event type. Neither promises full-content search. Literal percent, underscore and backslash are escaped; unsupported query shapes are rejected before a read.
- Work list rows and related-run metadata omit input/state; event list rows omit payload. Only an independently selected exact record retrieves its payload. Artifact lists omit content and JSON metadata; exact artifact content must match the selected owned Business and run.
- Exact selection is independent of the visible page and text/status filter. Returned identifiers are checked after transport as well as constrained in the query. Missing, conflicting, foreign or failed reads cannot substitute another record.
- Current execution filters require `completed_at IS NULL`; Stopped covers ended runs whose saved status remains nonterminal. The saved status remains inspectable. An unresolved notice does not make an ended execution active.
- Work child metadata is limited to 100 records per relation with exact count/sentinel completeness. This is a visible bounded window, not a complete-history claim. Cost display reuses the unchanged count-checked 1,000-row ledger boundary and preserves unavailable, pending and unknown charges.
- The global Decisions badge continues to use its existing independently counted queue and existing bounded account-request adapter. No new private read function, table permission, RLS rule or security-definer grant is introduced.

## Navigation and presentation

- All-Business browsing remains aggregate when a record is selected, paged or closed. The selected record's verified Business scopes onward Library/Connections navigation and research setup; the header explicitly retains aggregate browsing context. The global Decisions badge still links to the aggregate queue.
- Work accepts the retained `run` alias and canonical `selected` identity. Activity has an independently verified `runFilter`. These do not replace Decisions `decision` or Connections `connectionRun` semantics.
- Opening an exact artifact preserves its query and fragment. The client only reveals a server-selected artifact inside its matching run boundary. Native modal and active-editor guards prevent background focus or scroll changes.
- Compatible saved scroll/disclosure positions take precedence on Back/reload. Fresh narrow direct-selection URLs reveal the selected detail even without a fragment. Native history restores filter controls from matching URL state while unchanged refreshes preserve unfinished edits.
- List queries do not depend on the command bar's Business. An empty aggregate command preserves an existing local draft; a new typed goal remains unapproved until the existing review flow completes. Nothing starts from collection navigation.
- Motion uses the same persisted run/stage/task/worker/output receipt semantics. Types admit the minimum metadata fields rather than fabricated empty payloads. Incomplete detail is quiet, and polling does not create a new activation.
- Desktop 1280×720 and 1440×900 require one document viewport, contained long content and visible frequent controls. Narrow/zoom views retain readable reflow, keyboard access and unobscured selected headings.
- Long list names use two-line summaries and one-line Business labels; full identities remain available in keyboard-accessible context disclosures. The selected Work charge summary precedes verbose identity and completeness details. Desktop checks measure row density and visible known/unknown charges, not only document overflow.

## Verification boundaries

Fixtures use 125+ records per Business, two Businesses, duplicate/long names, tied timestamps, old active work, off-page selections, oversized child windows, null/invalid counts, failures, ignored predicates, exact artifact hashes and uncertain costs. They execute the actual root branch and read adapters against an inert owner-session transport. Provider calls, credential access, mutations, runtime RPC launches and external networking are denied.

Hosted capture requirements include the two desktop viewports, 1000-pixel single-column mode, 640-pixel zoom, 390 and 320 pixels. Native GET history, retained component navigation, modal barriers, draft preservation, artifact positioning and real rendered controls are checked. The expanded screenshot suite has a 25-minute aggregate CI allowance; individual browser test timeouts remain bounded.

Retained fixtures do **not** prove Next.js RSC transport, route-cache or server-action interruption behavior. The real Next transport gate remains in R03. Existing legacy technical workspaces remain reachable; this slice does not certify their complete histories or convert them into autonomous Quest operation.
