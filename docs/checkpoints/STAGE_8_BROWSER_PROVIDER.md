# Stage 8: Browser Provider Qualification

Date: 30 September 2026

Status: **Qualified**

Stage 8 selects and integrates the remote browser provider required by the Agent Labs V2 implementation plan. Stage 9 Browser Planner work has not started.

## Provider decision

Steel is the default browser provider.

Browserbase remains implemented behind the same provider-neutral Core interface as a replaceable managed-cloud alternative.

The decision considered:

- live embedded viewing
- Business-scoped persistent browser identity
- human takeover and return control
- session replay
- Playwright over CDP
- file uploads
- isolated sessions
- provider cost
- API quality
- future self-hosting options

Steel was selected because it satisfies the complete Stage 8 capability contract, has a usage-based entry tier, and retains an open-source self-hosting path.

## Permanent implementation

Stage 8 adds:

- provider-neutral browser contracts and registry
- Steel and Browserbase adapters
- server-only provider configuration
- remote Chromium session creation, retrieval, release, and failure cleanup
- Playwright-over-CDP observation and interaction
- bounded CDP startup retries
- file-upload qualification
- persistent opaque browser profile IDs scoped to one Business
- private storage for CDP, live-view, viewer, and replay endpoints
- read-only live viewing while automation owns control
- interactive live viewing only during human control
- Take Control and Return Control owner interventions
- returned-control verification against the same session
- required preservation of the qualification upload and human interaction
- real provider replay polling before qualification
- authenticated HLS replay proxying
- HLS segment, initialization-map, and key-URI rewriting
- HTTP range response preservation for recorded media
- prevention of provider credentials being forwarded to external replay resources
- durable browser session and browser event records
- Supabase Realtime updates for browser activity
- duplicate launch prevention
- deterministic browser-cost estimation
- Accounts and central Workflow Workspace browser surfaces

## Live Steel qualification

Qualified source commit:

`8acd96edfed7f954311117aae6f43a4dfb139da4`

Qualified Vercel Preview deployment:

`dpl_GCX3H5SwtCHHHzjrb1QWbDGSR3p4`

Region:

`syd1` Vercel function, Steel managed browser region `iad`

Total live qualification duration:

`37,630 ms`

Estimated Steel browser-time cost at US$0.10 per browser hour:

approximately `US$0.00105`

The real managed session passed every required live check:

| Check | Result |
| --- | --- |
| Real Steel session creation | Passed |
| Playwright CDP connection | Passed |
| Read-only live view | Passed |
| Interactive live view | Passed |
| Persistent profile returned | Passed |
| File upload | Passed |
| Human interaction recorded | Passed |
| Return-control reconnection | Passed on first connection attempt |
| Upload preserved through takeover | Passed |
| Session release | Passed |
| HLS replay | Passed on second poll |

Replay evidence:

- content type: `application/vnd.apple.mpegurl`
- manifest size: `5,391 bytes`
- replay attempts: `2`

The qualification response returned HTTP 200 with status `passed`.

## Database and isolation qualification

The complete durable browser lifecycle was separately proven transactionally:

`reserve -> launch -> observe -> take-control -> return-control -> verify -> replay -> complete`

The proof confirmed:

- all eight Workflow stages completed
- duplicate reservation returned the existing authoritative Workflow Run
- one BrowserIdentity remained Business-scoped
- one BrowserSession remained Workflow-scoped
- wrong runtime capability was rejected
- takeover and return-control interventions used the universal options-array contract
- interactive live view was denied while automation owned control
- interactive live view was allowed during human control
- upload and owner-interaction metadata persisted
- the provider session reached released state
- replay reached ready state
- a second authenticated owner saw zero browser identities, sessions, events, or Workflow Runs belonging to the first owner
- provider endpoints remained in the private schema

After the real provider proof, the hosted Steel provider record and Stage 8 WorkflowDefinition were promoted to `qualified` with the live evidence recorded in provider evaluation metadata.

## Reliability findings resolved during qualification

The live qualification process exposed and fixed:

1. Vercel file tracing initially omitted Playwright runtime assets.
2. The Steel request used unnecessary launch overrides instead of the minimum stable session contract.
3. A private Playwright transport disconnect prevented a later CDP reconnection.
4. The workflow initially assumed replay readiness immediately after release.
5. Replay proxy requests could have forwarded the Steel key to non-Steel resource hosts.
6. HLS URI attributes and ranged media responses required explicit proxy support.

All fixes are permanent and covered by the Stage 8 regression suite.

## Cleanup

- the one-time live-provider probe route was removed
- no API key or provider credential was committed
- no disposable qualification user or Business remains
- temporary database request state and network extension were removed
- temporary Edge Functions are JWT-protected inert `404` stubs
- failed qualification sessions were released
- the canonical build remains `npm run quality && next build`

## Exit criteria

- one provider selected as default: **Passed**
- alternative remains architecturally replaceable: **Passed**
- browser session launches from a Workflow: **Passed**
- live view renders through the central Workspace contract: **Passed**
- Take Control transition works: **Passed**
- Return Control and same-session automation reconnection work: **Passed**
- replay is accessible: **Passed**

## Boundary

Stage 9 has not started.

No Browser Planner, selector planner, proof-requirement planner, recovery planner, credential-vault implementation, Etsy connection, commerce mutation, or goal-completion loop is included in this stage.
