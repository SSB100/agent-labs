# Stage 5 checkpoint: Model Router

## Source of truth

This checkpoint completes **Stage 5: Model Router** from `AGENT_LABS_V2_IMPLEMENTATION_PLAN.md`.

Stage 5 proves that a bounded Worker Pack can request a logical model route, resolve to qualified provider models, use one independent fallback, persist provider telemetry and cost, and stop without a workflow loop. It does not begin the Stage 6 Worker evaluation framework, operate a browser, connect commerce providers or install an Etsy production workflow.

## Provider and credential boundary

OpenRouter is implemented behind the provider-neutral Model Router.

The server reads only the server-side environment variable:

```text
OPENROUTER_API_KEY
```

The key is not stored in Supabase application records, committed to GitHub, exposed through `NEXT_PUBLIC_` variables or inserted into worker context.

Workers declare logical requirements. They do not contain provider model IDs.

## Registered model catalog

Stage 5 qualified these OpenRouter model definitions:

```text
luna.standard
  openai/gpt-5.6-luna
  standard workhorse

claude.haiku.review
  anthropic/claude-haiku-4.5
  independent reviewer

sol.high-power
  openai/gpt-5.6-sol
  high-power escalation

claude.sonnet.high-power
  anthropic/claude-sonnet-4.6
  independent high-power fallback

gemini.flash.large
  google/gemini-3.6-flash
  large-context specialist
```

The catalog records:

- provider and provider family
- provider model ID
- logical tier
- context window
- maximum output tokens
- structured-output support
- tool-use support
- large-context, reasoning, vision and file capabilities where applicable
- current input, output and cached-input price metadata
- qualification evidence and timestamps

Model names are not embedded in workflows. Future model substitutions can update the registry and route policy without rewriting workers.

## Logical routes

The qualified routes are:

```text
standard.default
  primary:  luna.standard
  fallback: gemini.flash.large

reviewer.independent
  primary:  claude.haiku.review
  fallback: luna.standard

escalation.high-power
  primary:  sol.high-power
  fallback: claude.sonnet.high-power

large-context
  primary:  gemini.flash.large
  fallback: luna.standard
```

Each route has:

- capability requirements
- minimum context requirements
- preferred provider family
- one genuinely different fallback provider family
- a maximum of two attempts

The Generic Researcher requests `standard.default`; it does not request an OpenAI, Google or Anthropic model directly.

## OpenRouter adapter

The adapter provides:

- strict JSON-schema response requests
- required single-tool qualification calls
- 45-second request timeout
- OpenRouter attribution headers
- provider and model identity capture
- provider request IDs
- token usage
- cached-input and reasoning token usage
- reported provider cost
- locally estimated cost
- latency
- stable provider failure categories

### Provider-safe JSON schema

The complete Worker Pack JSON Schema remains the authoritative local validator.

Before sending a schema to a model provider, Agent Labs creates a provider-safe projection that:

- preserves object and array structure
- preserves required fields
- preserves types
- preserves `additionalProperties`
- converts `const` to an equivalent one-value `enum`
- removes provider-specific unsupported constraints such as UUID format, length limits, item-count limits, numeric bounds, uniqueness and regular-expression constraints

After generation, the original complete schema and Task Contract completion criteria are applied locally. Provider compatibility therefore does not weaken Agent Labs' durable validation boundary.

## Failure classification and fallback

Provider failures are classified as:

- `configuration_required`
- `authentication_required`
- `rate_limited`
- `provider_timeout`
- `provider_unavailable`
- `provider_rejected`
- `malformed_model_output`
- `tool_qualification_failed`

Router-level failures additionally include:

- `route_unavailable`
- `all_routes_failed`

A retryable primary failure may invoke the one configured fallback. Non-retryable failures stop immediately. The router never exceeds the route's two-attempt boundary and does not create a free-form planning loop.

## Live capability qualification

All five registered models passed both required live capabilities through Vercel Preview and OpenRouter:

```text
Models tested:                   5
Structured-output proofs:       5 passed
Required tool-call proofs:      5 passed
Total live capability checks:  10 passed
Failed live capability checks:  0
```

Aggregate capability-qualification usage:

```text
Input tokens:        2,332
Output tokens:         552
Reported cost:       US$0.00728355
```

Each qualification record stores its provider model ID, provider request ID, tokens, cost, latency, source and live-validation timestamp.

## Durable normal-route proof

```text
Core Workflow Run:
00000000-0000-4000-8000-000000005511

Route:
standard.default

Selected model:
luna.standard

Provider model:
openai/gpt-5.6-luna

Attempts:
1

Result:
completed

Final stage:
complete
```

Durable invocation telemetry:

```text
Input tokens:          1,326
Output tokens:           404
Total tokens:           1,730
Cached input tokens:    1,323
Reasoning tokens:          33
Latency:                3,737 ms
Reported cost:          US$0.00051186
Estimated cost:         US$0.00025593
```

The worker output passed the complete local schema and Task Contract criteria. Its receipt records `outputValidated: true`, `routeAttemptCount: 1`, the selected model, provider, request ID, token use, cost and output Artifact.

## Durable independent-fallback proof

```text
Core Workflow Run:
00000000-0000-4000-8000-000000005512

Route:
standard.default

Attempt 1:
luna.standard
provider_unavailable, deliberately injected
zero provider tokens and zero cost

Attempt 2:
gemini.flash.large
completed

Provider model:
google/gemini-3.6-flash

Result:
completed

Final stage:
complete
```

Fallback invocation telemetry:

```text
Input tokens:          1,722
Output tokens:         1,776
Total tokens:          3,498
Reasoning tokens:      1,436
Latency:                8,703 ms
Reported cost:          US$0.00795150
Estimated cost:         US$0.01590300
```

The durable receipt records two attempts, the failed OpenAI-family primary and the completed Google-family fallback. No third attempt or workflow loop was created.

## Total live qualification cost

```text
Capability checks:     US$0.00728355
Durable route proofs:  US$0.00846336
Total reported cost:   US$0.01574691
```

These were controlled Stage 5 qualification calls, not recurring application charges.

## Durable telemetry and owner visibility

Every routed model attempt persists a `model_invocations` record containing:

- Business
- Workflow Run
- Task Contract
- Worker Run
- logical route
- selected model definition
- attempt number
- status
- provider identity
- provider model ID
- provider request ID
- failure classification
- input, output, cached-input and reasoning tokens
- reported and estimated costs
- latency
- provider metadata
- timestamps

The private Model Router page displays:

- OpenRouter readiness
- logical routes
- primary and fallback models
- capability and pricing metadata
- active and completed proofs
- individual attempts
- tokens
- costs
- latency and failure categories

## Duplicate prevention

Repeating the successful qualification launch with the same Business and idempotency key returned:

```text
should_start: false
authoritative Workflow Run count: 1
```

No duplicate Workflow Run or model invocation was created.

## RLS isolation

A second authenticated owner could see:

```text
Qualification Businesses:    0
Qualification Workflow Runs:  0
Qualification invocations:    0
```

Global model definitions, route policies and qualification status are readable to authenticated application users. Business-scoped invocation telemetry remains owner-isolated through RLS.

## Terminal transition repair

Live qualification identified a mismatch in the SQL value list used by terminal system events. The permanent fix:

- hides the previous transition implementation from API roles
- routes `worker_completed` and `worker_failed` through corrected private helpers
- retains the same one-run capability validation
- supplies explicit `actor_id = null` for system events
- preserves all durable Worker Run, Artifact, stage, event and Workflow Run updates

Both normal completion and fallback completion passed after the repair.

## Hosted migrations

Stage 5 migration history is:

```text
20260929074449_stage5_model_router_foundation
20260929074737_stage5_model_router_runtime
20260929081542_stage5_model_schema_consolidation
20260929081624_stage5_model_catalog
20260929081703_stage5_worker_route_contract
20260929081753_stage5_runtime_start_task
20260929081833_stage5_runtime_route_worker
20260929081929_stage5_runtime_invocations
20260929101714_stage5_openrouter_catalog_correction
20260929101810_stage5_live_qualification_recorder
20260929102028_stage5_live_qualification_outcomes
20260929103127_stage5_build_diagnostics
20260929104732_stage5_terminal_transition_fix
20260929105127_stage5_qualification_cleanup
```

The temporary qualification recorder and diagnostic objects were used only to capture controlled live evidence. The cleanup migration removes them and deletes both fixture Businesses with all cascading Workflow Runs and invocation telemetry.

## Qualification cleanup

After evidence capture:

- temporary qualification Businesses were deleted
- temporary Workflow Runs, Worker Runs, Artifacts and invocations were deleted by cascade
- the Preview-only qualification endpoint was removed
- one-time qualification and diagnostic scripts were removed
- temporary qualification RPCs were dropped
- the private diagnostic table was dropped
- the Vercel build override was removed
- the canonical application build command was restored
- temporary capability values are no longer present in active source
- permanent model definitions, qualifications, routes, runtime and owner telemetry remain

## Verification

Stage 5 passed:

- model registry and capability metadata
- provider-neutral logical routing
- current OpenRouter model IDs
- structured output on all five models
- required tool calls on all five models
- provider-safe schema projection
- complete local schema validation
- Luna default route
- independent Gemini fallback
- independent Claude reviewer route definition
- Sol and Claude high-power escalation route definition
- bounded maximum of two attempts
- non-retryable stop behaviour
- provider failure classification
- durable tokens, latency and cost telemetry
- durable worker receipt
- owner-facing cost visibility
- duplicate prevention
- cross-owner RLS isolation
- full lint, TypeScript, repository-test and Next.js production build gate

## Stop point

Stage 5 is complete. **Stage 6 has not been started.**
