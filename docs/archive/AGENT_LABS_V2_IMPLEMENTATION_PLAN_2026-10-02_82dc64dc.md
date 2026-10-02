# Agent Labs V2
## Source of Truth: Architecture and High-Level Implementation Plan

**Repository:** SSB100/agent-labs  
**Document role:** Authoritative V2 architecture and implementation plan  
**Status:** Approved foundation for implementation  
**Deployment:** Vercel  
**Backend:** Supabase  
**Initial production pack:** Etsy Print-on-Demand Commerce  
**Architecture:** Cloud-first, workflow-first, modular AI workforce platform

---

# 1. Executive summary

Agent Labs V2 is a clean rebuild of Agent Lab.

V1 demonstrated that it is possible to create durable AI execution, authority boundaries, browser controls, model routing, project state and autonomous Quest concepts. It also exposed the main architectural problem: the system became too broad and too permission-heavy before its workers and workflows had clearly defined jobs.

V2 takes the opposite approach.

Agent Labs will be built as a **modular AI workforce platform**.

The permanent platform, called **Agent Labs Core**, provides the infrastructure needed by any specialised AI workflow:

- durable workflows
- specialist workers
- Task Contracts
- model routing
- remote browser operation
- connected accounts
- tool and provider adapters
- business state
- knowledge retrieval
- business memory
- artifacts and evidence
- events
- financial controls
- human intervention
- observability
- simulation
- evaluation
- deployment
- audit receipts

Specialised expertise does not belong in Core.

Instead, expertise is installed through modular packs:

1. **Capability Packs** provide integrations with real systems.
2. **Knowledge Packs** provide specialised domain knowledge.
3. **Worker Packs** provide trained specialist roles.
4. **Workflow Packs** combine capabilities, knowledge and workers into reliable business processes.

The first Workflow Pack will be **Etsy Print-on-Demand Commerce**.

Future packs may turn the same Agent Labs installation into:

- a social media growth team
- a Shopify dropshipping operator
- a website development agency
- an SEO/content operation
- a customer support operation
- other specialised AI businesses or professions

The central product principle is:

> **Core provides capability. Packs provide expertise. Workflows provide process. Workers perform bounded jobs. Models are replaceable. Humans intervene only for meaningful business decisions or exceptional states.**

---

# 2. Why V2 exists

V1 became too general too early.

The system attempted to support a broad idea similar to:

> Give a group of agents an open-ended Quest and let them determine how to achieve it.

That created several recurring problems:

- workers repeatedly reconsidered the same problems
- multiple agents performed overlapping reasoning
- Critic and Analyst loops did not necessarily create progress
- planning and execution were too loosely separated
- large numbers of model calls could occur without creating a durable business outcome
- permissions were expressed as implementation-level technical capabilities
- normal work was interrupted by authority prompts
- browser, research and file permissions became visible product concepts
- model reliability problems became tangled with workflow logic
- the UI exposed too much internal machinery
- new functionality increased the number of interacting states rather than extending a simple execution model

V2 must avoid recreating those problems.

The new system will not ask general agents what to do next.

The workflow determines the current state. The current state determines the next type of work. A Task Contract tells the worker exactly what must be produced. The worker completes that job and stops.

---

# 3. Product definition

Agent Labs V2 is:

> **A modular platform for running specialised AI workflows that can research, create, operate external accounts, use browsers, publish work, measure outcomes and improve over time.**

The first commercial application is:

> **Discover viable original print-on-demand products, create them, publish them through approved commerce channels, market them through connected social accounts, fulfil paid orders through third-party manufacturers, measure realised profit, and continuously improve the business.**

Agent Labs is not initially intended to be:

- a universal autonomous AGI
- a free-form multi-agent discussion environment
- an unrestricted computer-use system
- a generic shell executor
- a system that asks the owner to approve routine browser actions
- a system that exposes implementation-level permissions to normal users

---

# 4. Core architectural principles

## 4.1 Workflow-first

Every real task must belong to a defined workflow.

The system should prefer:

    Research Product Candidate
    → Evaluate Candidate
    → Create Design Brief
    → Generate Assets
    → Review Assets
    → Configure Product
    → Create Listing
    → Review Listing
    → Publish
    → Promote
    → Measure
    → Scale / Iterate / Retire

over:

    Orchestrator
    → Explorer
    → Analyst
    → Critic
    → repeat until something happens

## 4.2 Task Contracts

Every worker invocation must have a Task Contract.

A Task Contract defines:

- workflow
- workflow version
- stage
- worker role
- objective
- input artifacts
- permitted capabilities
- required knowledge
- required output schema
- completion criteria
- failure criteria
- explicit non-goals
- escalation rules

Example:

    Workflow: Etsy POD Product Discovery
    Stage: Market Validation
    Worker: Market Researcher

    Objective:
    Collect enough evidence to assess demand and competition for
    retro camping T-shirts.

    Inputs:
    Candidate C-104
    Target market: US outdoor enthusiasts

    Capabilities:
    web.research
    browser.observe

    Required output:
    Market Evidence Pack

    Done when:
    At least three independent sources and enough evidence to
    assess demand, competition and buyer intent.

    Do not:
    Create designs
    Select the final product
    Publish anything
    Modify the workflow
    Start unrelated research

The worker completes the contract and stops.

## 4.3 Progress must be durable

A model turn is justified only when it can produce a durable progress delta.

Useful progress includes:

- new evidence
- new artifact
- completed task
- verified result
- specific repair request
- new executable task
- measured outcome
- justified workflow transition
- justified strategy change based on new evidence

If another model call would only repeat prior reasoning, the workflow should not call the model.

## 4.4 APIs before browsers

When a supported API exists and is appropriate, use it.

Browser automation is important, but it should not replace reliable APIs.

Examples:

- Etsy API for listings/orders when supported
- Printful API for catalogue/products/orders
- Instagram publishing API where supported
- TikTok approved posting APIs where supported
- Shopify Admin API for store operations
- browser automation for unsupported flows, human-visible operations, account setup, verification and UI-only processes

## 4.5 Scope instead of constant approval

Workers should be constrained by:

- workflow state
- Task Contracts
- account scope
- business scope
- tool scope
- financial policy
- deterministic validation

They should not be constrained by dozens of owner-facing permission prompts.

## 4.6 Observable autonomy

The user must be able to understand what the system is doing without reading logs.

The UI must provide visual cues for:

- current workflow
- current stage
- current worker
- current task
- browser activity
- current action
- next action
- evidence collected
- artifacts created
- outcome measurements
- owner intervention requirements

---

# 5. Cloud infrastructure

## 5.1 GitHub

Canonical repository:

**SSB100/agent-labs**

This repository starts clean.

V1 may be consulted for lessons or reusable ideas, but V2 should not inherit V1 architecture by default.

## 5.2 Vercel

Vercel is the primary application and deployment platform.

Use:

- Next.js App Router
- TypeScript
- Vercel Preview Deployments
- Vercel Production
- Vercel Workflows / Workflow SDK
- Vercel Functions where appropriate
- Vercel environment variables
- Vercel observability/logging

The Agent Labs Vercel project does not yet exist.

Create it during Stage 1 after the initial Next.js application scaffold exists in GitHub.

Environments:

### Development

Used for local development and synthetic fixtures.

No uncontrolled real-world publishing or spend.

### Preview

Every pull request or feature branch should be able to create a realistic hosted preview.

Preview can use real read-only integrations and controlled test/draft operations.

### Production

Real connected businesses, listings, social accounts, orders, fulfilment and financial activity.

## 5.3 Supabase

Use the existing **Agent Labs** Supabase project.

Current state at document creation:

- active and healthy
- Sydney region
- clean public schema
- no V2 application tables yet

This is ideal because V2 can begin with a deliberate migration history.

Supabase responsibilities:

- PostgreSQL
- Auth
- Row Level Security
- Storage where appropriate
- Realtime
- workflow/task state
- business state
- events
- artifacts metadata
- financial ledger
- knowledge metadata
- vector search where beneficial
- UI subscriptions

Do not make business logic depend unnecessarily on direct Supabase client calls.

Use repository/service abstractions so the underlying Postgres provider can be changed later if needed.

## 5.4 Why Supabase instead of Neon

Neon is a strong Postgres platform and remains a valid future option.

Supabase is preferred for V2 because Agent Labs needs an integrated set of backend capabilities:

- Postgres
- authentication
- RLS
- storage
- realtime
- vector support

Using Supabase reduces the number of separate infrastructure services required for the first production version.

---

# 6. High-level system architecture

    ┌────────────────────────────────────────────────────┐
    │                    AGENT LABS UI                    │
    │                                                    │
    │ Dashboard | Workflow | Businesses | Needs You      │
    │ Live Browser | Products | Metrics | Artifacts      │
    └───────────────────────┬────────────────────────────┘
                            │
                            ▼
    ┌────────────────────────────────────────────────────┐
    │                  AGENT LABS CORE                   │
    │                                                    │
    │ Workflow Runtime                                   │
    │ Task Contract Runtime                              │
    │ Worker Runtime                                     │
    │ Model Router                                       │
    │ Browser Service                                    │
    │ Capability Registry                                │
    │ Account Service                                    │
    │ Knowledge Service                                  │
    │ Artifact/Evidence Service                          │
    │ Event Bus                                          │
    │ Financial Policy Engine                            │
    │ Owner Intervention Service                         │
    │ Audit / Action Receipts                            │
    │ Evaluation / Simulation                            │
    └───────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          Supabase       Vercel       Providers
                                      OpenRouter
                                      Browserbase/Steel
                                      Etsy
                                      Printful
                                      Instagram
                                      TikTok
                                      Shopify
                                      GitHub
                                      etc.
                            │
                            ▼
    ┌────────────────────────────────────────────────────┐
    │                    PACK RUNTIME                    │
    │                                                    │
    │ Etsy POD | Social Growth | Website Builder | ...   │
    └────────────────────────────────────────────────────┘

---

# 7. Agent Labs Core domains

## 7.1 Identity

Core owns:

- users
- authentication
- sessions
- businesses/workspaces
- membership
- owner role
- future team roles

V2 can begin owner-focused while remaining multi-business ready.

## 7.2 Business

A Business is the durable container for specialised work.

A Business may contain:

- brand profile
- goals
- installed packs
- connected accounts
- products
- campaigns
- orders
- assets
- knowledge
- experiments
- workflows
- metrics
- profit ledger

A Business may activate multiple packs simultaneously.

Example:

    Etsy POD
    +
    Social Growth
    +
    Website Builder

All three packs can share the same brand and product information while keeping their own workflows and worker expertise.

## 7.3 Goals

Goals store owner intent.

Examples:

- Reach NZD 10,000 cumulative realised profit.
- Grow Instagram to 25,000 relevant followers.
- Build and deploy a production website.
- Validate five product concepts.

A goal is not executable authority.

A workflow interprets the goal into known work.

## 7.4 Workflow Runtime

Core owns the generic workflow engine.

A workflow definition contains:

- pack ID
- workflow ID
- workflow version
- supported start conditions
- stages
- transitions
- completion states
- failure states
- human intervention states
- schedules
- event subscriptions

A Workflow Run contains:

- workflow definition/version
- Business
- Goal
- current stage
- current state
- current Task Contract
- state history
- event history
- artifacts
- measurements
- owner intervention state

Vercel Workflows should provide durable execution.

## 7.5 Task Contract Runtime

Task Contracts are durable records.

They must not exist only in prompts.

Core validates the Task Contract before invoking a worker.

## 7.6 Worker Runtime

Workers are specialist roles, not free-form autonomous personalities.

Core provides:

- worker loading
- Worker Pack version selection
- context assembly
- knowledge retrieval
- tool exposure
- model selection
- output validation
- evaluation metadata
- escalation
- worker execution receipts

## 7.7 Model Router

Model selection is Core infrastructure.

Workers declare requirements.

The Model Router chooses the least expensive model currently qualified for that contract.

Initial intended tiers:

### Standard workhorse

GPT-5.6 Luna-class model.

Use for:

- routine management
- research synthesis
- product strategy
- content planning
- copy
- browser planning
- structured decisions

### Independent review

Claude Haiku-class model.

Use to provide model-family independence for Reviewer roles where useful.

### High-power escalation

GPT-5.6 Sol-class model.

Use for:

- difficult reasoning
- complex debugging
- architecture
- repeated worker failures
- difficult coding
- strategy changes

### High-power independent review

Claude Sonnet-class model.

### Large-context specialist

Gemini Flash-class model where large context materially helps.

Do not hardcode these model names into workflows.

## 7.8 Capability Registry

Core owns the trusted capability contracts.

Example capabilities:

- web.research
- browser.observe
- browser.interact
- browser.upload
- browser.takeover
- image.generate
- marketplace.etsy
- fulfilment.print
- social.instagram
- social.tiktok
- commerce.shopify
- code.repository
- deploy.vercel
- database.supabase
- money.spend

Packs request capabilities.

Packs do not create unrestricted privileged tools.

## 7.9 Provider adapters

Capabilities may have multiple provider adapters.

Example:

    fulfilment.print

may be implemented by:

- Printful
- Printify
- Gelato

Example:

    browser

may be implemented by:

- Browserbase
- Steel

Example:

    model inference

may be implemented through:

- OpenRouter
- provider-specific fallback later

Workflow Packs should not care which provider is active unless provider-specific behaviour is essential to the domain.

## 7.10 Connected Account Service

Core owns account connectivity.

Connected accounts may include:

- Etsy
- Printful
- Instagram
- TikTok
- Shopify
- GitHub
- Vercel
- future providers

A connected account record should describe:

- Business
- provider
- external account identifier
- connection status
- scopes
- token/session state
- last verified time
- health
- account capabilities

Secrets must never be inserted into normal model context.

## 7.11 Browser Service

Browser is a Core capability.

See Section 13 for detailed design.

## 7.12 Knowledge Service

Knowledge is stored durably and retrieved intentionally.

Knowledge sources can include:

- pack knowledge
- current platform policy
- business knowledge
- brand guides
- product data
- prior experiments
- approved examples
- technical documentation
- current operational rules

Knowledge retrieval must be scoped by Task Contract.

Workers should not receive the entire knowledge base.

## 7.13 Business Memory

Business memory is different from worker conversation history.

Examples:

- this niche was tested previously
- Product P-14 failed because margin was too low
- the business prefers a minimalist brand voice
- Instagram hooks of type X historically perform well
- supplier Y caused two late deliveries
- Product P-22 is currently the best performer

Business memory is durable evidence.

It does not automatically grant authority or override current policy.

## 7.14 Artifact Service

Workers communicate primarily through durable artifacts, not conversations.

Core artifact types should support generic metadata.

Examples:

- Research Evidence Pack
- Product Decision
- Design Brief
- Generated Design
- Product Package
- Listing Package
- Campaign Package
- Measurement Report
- Review Report
- Build Artifact
- Deployment Report

## 7.15 Evidence Service

Important decisions must link back to evidence.

Example:

    Claim:
    Camping gift niche shows promising buyer demand.

    Evidence:
    E-102
    E-107
    E-113

    Used by:
    Product Decision PD-19

This allows Reviewer workers and owners to understand why a decision was made.

## 7.16 Event Bus

Core provides standard events.

Examples:

- workflow.started
- workflow.stage.started
- workflow.stage.completed
- workflow.failed
- worker.started
- worker.completed
- worker.failed
- product.created
- product.approved
- listing.published
- order.paid
- order.fulfilled
- campaign.published
- campaign.performance.updated
- budget.exhausted
- owner.action.required

Workflow Packs subscribe to events without directly coupling themselves to each other.

## 7.17 Action Receipts

Every external mutation must produce a durable receipt.

Example:

    intent: publish-product-184
    capability: marketplace.etsy
    action: listing.publish
    external_resource_id: 12345
    confirmed_state: active
    timestamp: ...
    verified: true

Workers should not be trusted merely because they claim an action succeeded.

## 7.18 Idempotency

Every consequential external operation must have an idempotency/intention identity where possible.

If a network request times out, the system must reconcile external state before retrying.

Never blindly repeat:

- listing publication
- social publication
- supplier order
- fulfilment request
- refund
- paid action

## 7.19 Scheduling

Scheduling is Core infrastructure.

Workflows should be able to:

- wait until a date
- wait for a measurement window
- schedule social posts
- schedule recurring checks
- wake on a webhook
- wake on an external event

Do not use AI calls as timers.

---

# 8. Modular Pack architecture

Agent Labs V2 has four primary module types.

## 8.1 Capability Packs

Capability Packs connect Core to real systems.

Examples:

- Etsy
- Printful
- Instagram
- TikTok
- Shopify
- GitHub
- Vercel

A Capability Pack includes:

- capability implementation
- account connection requirements
- input/output schemas
- provider API adapter
- browser fallback where justified
- health checks
- action receipts
- error classification
- evals
- version information

## 8.2 Knowledge Packs

Knowledge Packs provide domain expertise.

Examples:

- Etsy Seller Knowledge
- Print-on-Demand Knowledge
- Social Marketing Knowledge
- Next.js Knowledge
- SEO Knowledge
- Conversion Optimisation Knowledge

Knowledge must support:

- version
- source
- effective date
- last verified date
- optional expiry date
- freshness state

Time-sensitive knowledge should be considered stale after its configured lifetime.

## 8.3 Worker Packs

Worker Packs define specialist workers.

A Worker Pack should contain:

    worker/
      manifest
      charter
      input schema
      output schema
      capability policy
      model requirements
      prompts/instructions
      examples
      negative examples
      evals
      knowledge requirements
      escalation policy

Workers can be reused across Workflow Packs.

## 8.4 Workflow Packs

Workflow Packs provide specialised processes.

Examples:

- etsy-pod
- social-growth
- shopify-dropshipping
- website-builder

A Workflow Pack declares:

- name
- version
- workflows
- required capabilities
- required knowledge
- required worker packs
- supported Business types
- UI metadata
- events emitted
- events consumed
- migrations/extensions
- evals
- qualification state

## 8.5 Pack manifests

Every pack must have a machine-readable manifest.

Example:

    id: etsy-pod
    name: Etsy Print-on-Demand
    version: 1.0.0

    requires:
      capabilities:
        - marketplace.etsy
        - fulfilment.print
        - web.research
        - browser
        - image.generate

      knowledge:
        - etsy-selling
        - print-on-demand
        - social-marketing

    workflows:
      - product-discovery
      - product-launch
      - campaign
      - measurement
      - optimisation

    workers:
      - commerce-manager
      - market-researcher
      - product-strategist
      - creative-director
      - listing-specialist
      - content-specialist
      - reviewer

## 8.6 Pack versioning

Every pack is versioned.

Example:

- etsy-pod 1.0.0
- etsy-pod 1.1.0
- etsy-pod 2.0.0

Workflow Runs remain pinned to the pack/workflow versions they started with unless a deliberate migration is performed.

Installing a new pack version must not silently change a running workflow.

## 8.7 Pack trust model

Installing a pack must not mean trusting arbitrary privileged code.

Core validates:

- manifest
- dependencies
- capabilities
- schemas
- migrations
- worker definitions
- UI extensions
- eval status

A pack cannot:

- access another Business without scope
- obtain database admin access
- bypass financial controls
- access secrets directly
- execute arbitrary shell commands
- create unrestricted network tools

---

# 9. Universal Core data contracts

To allow packs to cooperate, Core should define generic shared objects early.

Initial universal concepts:

- User
- Business
- Goal
- InstalledPack
- WorkflowDefinition
- WorkflowRun
- WorkflowStageRun
- TaskContract
- WorkerDefinition
- WorkerRun
- ConnectedAccount
- Artifact
- Evidence
- ExternalResource
- ActionIntent
- ActionReceipt
- Event
- OwnerIntervention
- MoneyPolicy
- SpendAuthorization
- FinancialEntry
- Measurement
- Experiment
- KnowledgeDocument
- BusinessMemory

Commerce-oriented Core contracts may additionally define reusable generic entities:

- Product
- ProductVariant
- Listing
- Campaign
- Order
- Fulfilment

These should remain provider-neutral.

For example, Core should not require a field named etsy_listing_id.

Instead:

    ExternalResource
      provider: etsy
      type: listing
      external_id: ...

The Etsy pack interprets Etsy-specific metadata.

---

# 10. Supabase data architecture

The exact schema should be created through migrations during implementation.

Likely table groups:

## Identity and business

- profiles
- businesses
- business_members

## Packs

- packs
- pack_versions
- business_installed_packs

## Goals and workflows

- goals
- workflow_definitions
- workflow_runs
- workflow_stage_runs
- task_contracts
- task_runs

## Workers

- worker_definitions
- worker_versions
- worker_runs
- worker_evaluations

## Accounts and providers

- connected_accounts
- provider_connections
- account_health_events

## Artifacts and evidence

- artifacts
- artifact_versions
- evidence
- artifact_evidence_links

## Knowledge and memory

- knowledge_packs
- knowledge_documents
- knowledge_versions
- business_memories

## Browser

- browser_sessions
- browser_actions
- browser_replays

## Events

- events
- webhook_receipts

## Financial

- money_policies
- spend_authorizations
- financial_ledger
- financial_events

## Experiments

- experiments
- experiment_variants
- experiment_measurements
- experiment_decisions

## Commerce shared model

- products
- product_variants
- listings
- campaigns
- orders
- fulfilments

## External actions

- action_intents
- action_receipts
- external_resources

All exposed tables must use appropriate Row Level Security.

Do not expose service-role credentials to the browser.

---

# 11. Worker architecture and training

## 11.1 Training does not initially mean fine-tuning

Worker training should initially mean creating a strong Worker Pack.

Each Worker Pack has:

- role charter
- structured inputs
- structured outputs
- explicit scope
- allowed capabilities
- forbidden actions
- positive examples
- negative examples
- evaluation fixtures
- qualification criteria
- model requirements

Fine-tuning should only be considered after significant real-world accepted examples exist and a repeatable model-behaviour problem has been demonstrated.

## 11.2 Initial reusable workers

### Manager

Purpose:

- determine the correct workflow transition
- choose the correct specialist for a known stage
- interpret structured stage results

The Manager must not:

- perform research
- create designs
- publish
- browse freely
- create arbitrary tasks outside the workflow

Output should be highly constrained:

- current state
- next state
- worker required
- reason
- optional intervention requirement

### Market Researcher

Purpose:

- collect specified evidence
- distinguish evidence from inference
- stop when evidence contract is satisfied

Must not:

- choose the final business strategy
- create a product
- publish
- continue searching after completion

### Product Strategist

Purpose:

- evaluate structured evidence
- choose TEST / REJECT / NEEDS_MORE_EVIDENCE
- create product/business recommendations within its contract

Must not browse unless the workflow explicitly gives it a research capability.

### Creative Director

Purpose:

- create structured creative briefs
- translate product strategy into asset requirements

### Listing/Copy Specialist

Purpose:

- create accurate structured listing/content packages
- use only verified product claims
- follow pack knowledge and brand voice

### Content Specialist

Purpose:

- create platform-specific social content packages
- hooks
- captions
- asset instructions
- CTA variants

### Reviewer

Purpose:

- verify predetermined acceptance criteria

Primary outputs:

- PASS
- FAIL + failed criteria + one bounded repair instruction

Reviewer should not invent a new workflow or start new research.

### Browser Planner

Purpose:

- choose one browser action from a structured browser observation and Task Contract

Must never receive raw credentials.

Must not invent selectors.

Must operate against stable element identifiers supplied by Browser Service.

### Future specialist workers

Workflow Packs may add:

- Frontend Engineer
- Backend Engineer
- QA Engineer
- SEO Specialist
- Supplier Analyst
- Campaign Analyst
- Customer Support Specialist

---

# 12. Worker qualification and evaluation

Every worker must graduate through staged evaluation.

## Level 1: schema fixtures

Synthetic structured inputs and outputs.

Validate:

- schema
- role boundaries
- correct completion decisions
- forbidden behaviours

## Level 2: mocked capabilities

Worker interacts with deterministic mock tools.

Validate:

- correct tool use
- no fabricated results
- stops after completion
- handles errors correctly

## Level 3: simulated workflow environment

Example fake marketplace or fake browser site.

Validate complete stage behaviour.

## Level 4: real read-only external systems

Validate:

- real API interpretation
- browser observations
- source handling
- operational robustness

## Level 5: limited real mutations

Only after lower levels pass.

Examples:

- create draft listing
- upload test asset
- publish to controlled test account where supported

Worker qualification state:

- experimental
- qualified
- assisted
- autonomous

---

# 13. Browser architecture

Autonomous browser use is a core product feature.

## 13.1 Managed remote browser

Use Browserbase or Steel initially.

Evaluate both before locking provider.

Required capabilities:

- remote Chromium
- persistent authenticated context
- WebRTC or equivalent live view
- iframe/embed support for Agent Labs UI
- human takeover
- return control to automation
- replay
- isolated sessions
- Playwright compatibility
- file upload
- good session reliability
- clear pricing

## 13.2 Browser identity

Each connected browser-based account receives an isolated browser identity/session context.

Example:

- Etsy Brand A
- Instagram Brand A
- TikTok Brand A
- Shopify Brand A

Credentials remain in secure account/provider infrastructure.

Models receive opaque account/session identities.

## 13.3 Observe → Plan → Validate → Execute

Browser execution loop:

    Capture browser observation
    → Create stable page/element model
    → Browser Planner chooses ONE action
    → Core validates action against Task Contract
    → Browser executor performs action
    → Capture result
    → Store browser event
    → repeat if stage requires more work

The model does not receive unrestricted Playwright.

## 13.4 Browser action vocabulary

Core browser actions may include:

- navigate
- follow link
- click
- type
- select
- scroll
- upload
- submit
- wait
- read
- switch tab

The owner should not see these as permission categories.

## 13.5 Live browser UI

Any browser-driven workflow should expose:

- live browser view
- current worker
- current task
- current action
- next expected action
- agent-control state
- Take Control button
- Return Control button
- pause
- fullscreen
- session replay after completion

## 13.6 Human takeover

Human takeover is for:

- MFA
- CAPTCHAs where manual action is permitted
- identity verification
- unusual login prompts
- unexpected account states
- manual owner actions

Human takeover is not treated as a permission failure.

## 13.7 Browser replay

Important sessions should be replayable from workflow history.

This helps:

- debugging
- trust
- support
- reviewing unexpected outcomes
- worker eval creation

---

# 14. UI and UX

The V2 UI should be modern, visual and simple.

Discard the V1 OSRS visual metaphor.

Use a modern dark/futuristic SaaS control-centre aesthetic.

## 14.1 Primary navigation

Recommended top-level sections:

- Dashboard
- Workflow
- Products / primary pack entities
- Campaigns
- Orders
- Accounts
- History
- Needs You
- Settings

Pack UI metadata may add or rename domain views.

## 14.2 Workflow execution screen

The Workflow screen should be the operational centre.

Recommended layout:

### Left

Visual workflow timeline.

Example Etsy POD stages:

- Opportunity
- Research
- Validate
- Design
- Product
- Publish
- Campaign
- Measure

Use:

- completed state
- active state
- upcoming state
- blocked/Needs You state

### Centre

Large reusable Workspace.

Tabs should switch the expensive screen real estate between useful views.

Initial tabs:

- Live Browser
- Products
- Metrics
- Artifacts

Pack-specific examples:

#### Social Growth

- Live Browser
- Content
- Calendar
- Analytics
- Artifacts

#### Website Builder

- Live Browser
- Preview
- Code
- Tests
- Deployments

### Right

Current Worker panel:

- worker
- specialty
- status
- current Task Contract summary
- current action
- risk/business context
- next step
- model tier optionally hidden under details

### Bottom

Live Activity Feed:

- workflow event
- worker activity
- browser activity
- artifact creation
- publication
- metrics
- order
- fulfilment
- intervention

The Activity Feed should show business-readable summaries.

## 14.3 Dashboard

Dashboard should answer:

- What is Agent Labs doing?
- Is anything stuck?
- Do I need to do anything?
- What has it achieved?
- Is it making or losing money?

Initial cards may include:

- realised profit
- active products
- active workflows
- campaigns
- orders
- current experiments
- Needs You count

## 14.4 Needs You

Needs You is the only normal interruption surface.

Examples:

### Spend request

    Requested: NZD 50
    Purpose: Instagram test campaign
    Product: P-22
    Duration: 7 days
    Current product margin: NZD 18.60
    Recommendation: Run test

    Approve / Adjust / Decline

### MFA

    Instagram requires verification.
    Take Control

### Cost anomaly

    Supplier cost increased.
    This order would fall below minimum margin.
    Review

### Legal/identity

    Etsy requires updated seller terms.
    Open Etsy

Never show implementation-level capability names as the primary message.

## 14.5 History

History should contain:

- completed workflows
- workflow stages
- artifacts
- decisions
- browser replay
- action receipts
- product history
- campaign history
- measurements
- failures

---

# 15. Autonomy and owner intervention

V2 deliberately avoids V1's granular permission model.

## 15.1 Standing operational authority

Connecting an account and enabling it for an approved Business workflow grants standing operational authority to use that account for normal workflow operations.

For example, an Etsy workflow should generally be able to:

- read listings
- search
- create drafts
- edit drafts
- upload assets
- publish workflow-approved listings
- read orders
- read metrics
- manage product workflow state

without repeated owner prompts.

## 15.2 Workflow as authority boundary

Capabilities are exposed only when the workflow stage requires them.

Example:

    Listing reviewed
    → state = READY_TO_PUBLISH
    → publish capability becomes available
    → publish
    → verify external listing
    → record receipt

The worker cannot publish at a random stage simply because it knows how.

## 15.3 Money Policy Engine

Money is the primary explicit owner authority system.

A Business has standing financial policies.

Example:

    Marketplace listing fees:
    NZD 20 per month

    Advertising:
    Disabled

    Product samples:
    Requires owner approval

    Automatic refunds:
    Up to NZD 30 per order

    Supplier fulfilment:
    Allowed against confirmed paid customer orders

Agent Labs can act within approved financial envelopes.

It asks only when it wants to create or expand a financial commitment outside that envelope.

## 15.4 Customer-funded fulfilment

Paid customer fulfilment should normally be autonomous when:

- customer payment is confirmed
- supplier order matches purchased product
- fulfilment cost remains within expected range
- workflow checks pass

If supplier cost changes enough to create an unexpected loss or violate a configured margin boundary, create a Needs You item.

## 15.5 Advertising

Advertising is governed by standing budgets.

Example:

    Maximum total campaign spend: NZD 50
    Maximum daily spend: NZD 10
    Expiry: 7 days
    Product: P-22

The AI may optimise within this approved envelope.

It cannot increase the envelope itself.

## 15.6 Owner-only actions

Some actions remain owner-only, but they are not exposed as routine permissions.

Examples:

- password changes
- disabling MFA
- recovery email changes
- payout/bank changes
- account ownership transfer
- deleting an account/shop
- tax declarations
- identity verification
- legal agreements
- materially new contractual terms where owner acceptance is required

## 15.7 Destructive actions

Prefer reversible operations:

- archive
- retire
- pause
- disable

instead of permanent deletion.

Permanent destructive account/business actions should generally remain owner-only.

## 15.8 Pause Business

Core must provide immediate reversible controls:

- Pause Business
- Pause Workflow
- Pause Pack
- Pause Account
- Pause Campaign

Pausing stops new external mutations/spend while preserving durable state.

---

# 16. Financial ledger

Realised profit must be deterministic.

Never let an LLM calculate authoritative business profit.

Example:

    realised profit =
      settled sale revenue
      - marketplace fees
      - payment fees
      - production
      - shipping subsidy
      - refunds
      - advertising
      - directly attributable costs

Core Financial Ledger records:

- revenue
- fees
- supplier cost
- shipping
- refund
- advertising
- other direct cost
- realised profit

All revenue-generating Workflow Packs emit standard financial events into the same ledger.

---

# 17. Experiment Registry

Agent Labs must remember what has already been tested.

The Experiment Registry records:

- hypothesis
- candidate/product
- variables
- audience
- creative
- price
- channel
- start/end
- measurement requirements
- outcome
- decision
- relevant artifacts/evidence

This prevents:

- repeating failed tests
- rediscovering the same product idea
- repeatedly testing the same copy
- endless strategy cycling

A strategy change should reference new evidence or experiment results.

---

# 18. Knowledge freshness

Platform rules and operational knowledge change.

Time-sensitive Knowledge Documents should support:

- source
- version
- effective date
- last verified
- expires/refresh date
- freshness state

Examples:

- Etsy seller policy
- Instagram publishing rules
- TikTok API rules
- marketplace fees
- supplier requirements

A workflow should refresh stale critical knowledge before performing an affected action.

---

# 19. Simulation and promotion

Simulation is a first-class Core capability.

## 19.1 Simulation mode

A Workflow Pack should be runnable without performing real-world mutations.

Simulated:

- marketplace publication
- supplier order
- social publication
- financial spending
- webhooks
- orders
- campaign results where appropriate

Simulation must still exercise:

- Task Contracts
- workers
- model routing
- state transitions
- artifacts
- events
- receipts
- Needs You states

## 19.2 Workflow promotion levels

Recommended states:

- Experimental
- Qualified
- Assisted
- Autonomous

### Experimental

Synthetic environments only.

### Qualified

Eval suite and simulations pass.

### Assisted

Real accounts, but selected consequential transitions may require owner confirmation while operational reliability is proven.

### Autonomous

Routine workflow operations execute automatically inside standing business/financial policy.

This is a reliability promotion system, not a sprawling owner permission system.

---

# 20. Initial Workflow Pack: Etsy Print-on-Demand Commerce

This is the first production proof of the platform.

## 20.1 Scope

Initial supported business:

- original print-on-demand T-shirts
- Etsy sales
- Printful fulfilment initially
- organic social acquisition
- Instagram
- TikTok where platform workflow permits
- no paid advertising initially
- no generic reselling/dropshipping on Etsy
- no arbitrary customer service automation initially

## 20.2 Initial workers

- Commerce Manager
- Market Researcher
- Product Strategist
- Creative Director
- Listing Specialist
- Content Specialist
- Reviewer
- Browser Planner

## 20.3 Opportunity Discovery Workflow

    Goal
    → define bounded market/niche question
    → Market Researcher
    → Evidence Pack
    → Product Strategist
    → candidate decisions
    → Reviewer
    → approved/rejected candidates

Evidence may include:

- marketplace search observations
- listing density
- price ranges
- review patterns
- product styles
- public trend signals
- buyer language
- seasonality
- social signals

The Researcher does not choose the final product.

## 20.4 Product Validation Workflow

Product Strategist evaluates:

- demand
- competition
- differentiation potential
- estimated margin
- creative opportunity
- seasonality
- production complexity
- policy/IP risk
- marketing potential

Output:

- TEST
- REJECT
- NEEDS_MORE_EVIDENCE

NEEDS_MORE_EVIDENCE must specify the exact missing evidence.

## 20.5 IP and policy screening

Before design generation, screen for:

- brand names
- trademarks
- copyrighted characters
- sports teams
- logos
- celebrity likeness
- copied artwork
- marketplace policy concerns

Ambiguous cases go to Needs You or a specialised review path.

## 20.6 Creative Brief Workflow

Creative Director creates a structured brief:

- audience
- concept
- style
- hierarchy
- typography direction
- placement
- garment compatibility
- colour constraints
- forbidden elements
- originality requirements

## 20.7 Asset Generation Workflow

Use an image-generation provider through image.generate capability.

Store:

- asset ID
- prompt
- model/provider
- generation time
- product candidate
- version
- hash
- source brief

Do not let generated assets bypass review.

## 20.8 Creative Review

Reviewer checks against:

- brief
- print constraints
- originality/policy rules
- target audience
- visual clarity

Output:

- PASS
- FAIL + exact repair

Allow a bounded repair cycle.

Repeated failure escalates to stronger model or owner only when justified.

## 20.9 Print Provider Workflow

Initial provider: Printful.

Capabilities:

- retrieve catalogue
- retrieve variants
- retrieve print requirements
- estimate product cost
- create/configure product
- create variants
- store external IDs
- submit paid-order fulfilment

Use Core external resource mapping.

## 20.10 Pricing

Pricing calculations are deterministic.

Inputs:

- product cost
- marketplace fees
- payment fees
- shipping
- discount allowance
- refund allowance if configured
- margin target

Worker may select among valid price strategies.

Financial service calculates economics.

## 20.11 Listing Package Workflow

Listing Specialist receives:

- approved Product Package
- Brand Guide
- current Etsy Knowledge Pack
- keyword evidence
- verified claims
- pricing
- production/fulfilment details

Produces:

- title
- description
- tags
- attributes
- image order
- alt text
- disclosure information where required

Reviewer verifies:

- factual accuracy
- policy compliance
- no unsupported claims
- production disclosure
- required AI disclosure
- product details
- keyword quality

## 20.12 Etsy Publication

Preferred execution:

- Etsy API where supported
- browser only where necessary

Process:

    create draft
    → upload images
    → configure inventory/attributes
    → verify draft
    → publish
    → verify listing
    → store external resource
    → create Action Receipt

No owner permission required for routine publication once the workflow is Autonomous.

## 20.13 Social Campaign Workflow

    product published
    → campaign brief
    → content package
    → review
    → schedule
    → publish
    → collect metrics
    → campaign evaluation

Content Package may include:

- short-form video concepts
- Reel concepts
- carousel ideas
- captions
- hooks
- CTA variants
- hashtags
- product references
- required assets

## 20.14 Instagram

Use official API where appropriate for professional accounts.

Support:

- media preparation
- publication
- post identity
- metrics
- campaign linkage

## 20.15 TikTok

Follow current TikTok app/API requirements.

Where direct autonomous publishing is not permitted by platform rules or application status, use an explicit user-confirmation publishing flow.

This is a platform requirement state, not a generic permission system.

## 20.16 Measurement Workflow

Product measurements may include:

- views
- listing visits
- favourites
- clicks
- orders
- conversion
- revenue
- fulfilment cost
- fees
- realised profit
- social impressions
- engagement
- traffic source

Measurement windows should prevent premature strategy changes.

Example:

- minimum seven days
- or minimum impression threshold
- or minimum listing traffic threshold

## 20.17 Product Decision

After sufficient measurement:

- SCALE
- ITERATE
- CONTINUE_TEST
- RETIRE

Decision must reference the measurement evidence.

## 20.18 Scaling

Winning product workflows may create:

- colour variants
- related products
- new creatives
- price tests
- thumbnail tests
- new organic campaigns
- later paid test proposals

Each is a separate workflow/experiment rather than uncontrolled free-form expansion.

## 20.19 Order and fulfilment state machine

Order lifecycle:

    order.paid
    → order.validated
    → fulfilment.created
    → supplier.confirmed
    → production
    → shipped
    → delivered
    → profit.realised

Prefer webhooks over repeated browser checking.

---

# 21. Future Workflow Pack: Social Growth

The Social Growth pack should reuse Core and relevant shared workers.

Capabilities:

- Instagram
- TikTok
- web research
- image generation
- video generation later
- browser

Knowledge:

- platform-specific publishing
- current platform rules
- content strategy
- hook writing
- trend research
- analytics

Workers:

- Trend Researcher
- Content Strategist
- Creative Director
- Copy Specialist
- Social Publisher
- Performance Analyst
- Reviewer

Workflows:

- Build Strategy
- Research Trends
- Create Content Batch
- Review Content
- Schedule Content
- Publish
- Measure
- Optimise

---

# 22. Future Workflow Pack: Shopify Dropshipping

Generic dropshipping should not reuse Etsy policy assumptions.

Capabilities:

- Shopify
- supplier integrations
- web research
- browser
- social marketing
- fulfilment

Workflows:

    supplier discovery
    → supplier verification
    → product validation
    → economics validation
    → Shopify product creation
    → marketing
    → order
    → supplier fulfilment
    → tracking
    → delivery
    → realised profit

This pack should be developed only after the first Etsy POD end-to-end loop proves the platform.

---

# 23. Future Workflow Pack: Website Builder

Capabilities:

- GitHub
- code editing
- browser QA
- Supabase
- Vercel deployment

Knowledge:

- Next.js
- React
- accessibility
- UX
- SEO
- Supabase
- Vercel

Workers:

- Product Manager
- UX Designer
- Frontend Engineer
- Backend Engineer
- QA Engineer
- Reviewer

Workflows:

    Requirements
    → Architecture
    → Design
    → Implementation
    → Testing
    → Browser QA
    → Preview
    → Review
    → Production deployment

The same Agent Labs Core becomes a development agency by installing this pack.

---

# 24. Cross-pack cooperation

Packs cooperate through Core events and universal data contracts.

Example:

    Etsy Product Launch
    → product.published

Social Growth listens:

    product.published
    → create launch campaign

Later:

    campaign.performance.updated
    → high-performing product detected

Website Builder may listen:

    product.high_growth
    → propose dedicated landing page

Packs should not directly call each other's internal implementation.

---

# 25. Customer service

Customer service is not part of initial autonomous scope, but Core should be ready for it.

Unexpected customer events should create:

- owner intervention
- future Support Workflow input
- order issue
- refund request
- delivery issue

Do not allow customer problems to disappear because the current pack focuses on acquisition.

---

# 26. Error and recovery philosophy

Failures should not immediately trigger free-form replanning.

Classify first.

Examples:

- provider_unavailable
- malformed_model_output
- rate_limited
- authentication_required
- expired_token
- platform_permission
- validation_failed
- supplier_unavailable
- browser_changed
- ambiguous_external_result
- owner_action_required

Each class has a known recovery strategy.

Repeated unknown failures may invoke a specialised debugging worker.

Do not let general workers endlessly reinterpret the problem.

---

# 27. Observability

Every workflow should expose business-readable events.

Example:

    09:14 Research started
    09:18 8 market signals collected
    09:19 Candidate approved for test
    09:23 4 designs generated
    09:24 Design #3 approved
    09:25 Product cost calculated
    09:27 Etsy draft created
    09:28 Listing published
    09:31 Instagram campaign scheduled

Technical logs remain available under advanced diagnostics.

Core observability should capture:

- workflow state
- Task Contract
- worker
- model route
- model usage/cost
- browser session
- tool calls
- action receipts
- provider errors
- measurements
- owner interventions

---

# 28. Cost model

Do not recreate V1's over-restrictive AI spend caps.

Track AI cost and browser/provider cost accurately.

Use model routing to prefer economical qualified models.

Owner-facing hard financial controls should focus on actual business spending:

- advertising
- listing fees
- supplier fulfilment
- refunds
- samples
- purchases/subscriptions initiated by the workflow

AI infrastructure spend may later support optional owner-configured operational budgets, but it should not silently stop low-cost work because of arbitrary tiny default ceilings.

---

# 29. Repository architecture

Recommended initial structure:

    agent-labs/

      apps/
        web/

      packages/

        core/
          workflows/
          tasks/
          workers/
          events/
          artifacts/
          evidence/
          accounts/
          browser/
          models/
          money/
          knowledge/
          memory/
          experiments/
          audit/

        capabilities/
          web-research/
          browser/
          image-generation/

        providers/
          openrouter/
          browserbase/
          steel/

        packs/
          commerce-core/

          etsy/
            capability/
            knowledge/

          printful/
            capability/

          social-marketing/
            workers/
            knowledge/

          etsy-pod/
            manifest/
            workflows/
            workers/
            knowledge/
            policies/
            evals/
            ui/

          website-builder/
            ...

      supabase/
        migrations/
        seed/

      docs/

      tests/

Exact structure may change during Stage 1 if the chosen Vercel Workflow SDK imposes a cleaner pattern.

The architectural separation must remain.

---

# 30. Source-of-truth governance

This document is the high-level source of truth.

Implementation-specific documents may exist beneath it.

When implementation requires changing a major principle in this document:

1. identify the architectural reason
2. update this document
3. record the decision
4. then implement the change

Do not allow architecture to drift silently through code changes.

---

# 31. Implementation strategy

V2 should be built in vertical slices.

Do not build all Core infrastructure before proving anything.

Each stage should produce something visible and testable.

Avoid broad speculative abstractions.

Build only the abstraction required by the current slice while preserving the modular boundaries defined in this document.

---

# 32. Implementation stages

## Stage 0: Foundation confirmation

Objective:

Freeze V2 product and architectural decisions before code.

Tasks:

- keep this document as source of truth
- confirm GitHub repository
- confirm Supabase project
- confirm Vercel team
- confirm Supabase as backend
- confirm no V1 code migration
- define initial naming conventions
- define initial MVP

Exit criteria:

- V2 repo exists
- Agent Labs Supabase exists and is clean
- implementation document committed
- team agrees first production proof is Etsy POD

Current status:

**Complete except implementation document commit and Vercel project creation, which begins Stage 1.**

---

## Stage 1: Cloud application scaffold

Objective:

Create the smallest deployable Agent Labs application.

Implement:

- Next.js TypeScript application
- monorepo/package structure
- lint/typecheck/test baseline
- environment configuration
- Supabase client/server integration
- basic authentication shell
- initial database migration system
- Vercel project
- Preview Deployment
- Production Deployment shell
- CI checks

Create first Supabase migrations for:

- profiles
- businesses
- business_members

UI:

- modern V2 shell
- navigation skeleton
- authenticated landing/dashboard placeholder

Exit criteria:

- GitHub push triggers Vercel preview
- production environment deploys
- Supabase auth works
- authenticated Business can be created/read
- RLS is verified
- no workflow logic yet

---

## Stage 2: Universal Core data contracts

Objective:

Build the minimum durable shared language for modular packs.

Implement Core contracts for:

- Goal
- Pack
- WorkflowDefinition
- WorkflowRun
- WorkflowStageRun
- TaskContract
- WorkerDefinition
- WorkerRun
- Artifact
- Evidence
- Event
- ExternalResource
- ActionIntent
- ActionReceipt
- OwnerIntervention

Add corresponding Supabase schema.

Build repository/service interfaces.

Exit criteria:

- contracts validated
- state persisted
- RLS verified
- one synthetic workflow can create records
- no pack-specific Etsy fields leak into Core

---

## Stage 3: Vercel Workflow runtime

Objective:

Prove durable workflow execution.

Implement:

- workflow registry
- Vercel Workflow integration
- stage transitions
- wait
- retry
- fail
- completion
- human-intervention state
- event emission
- workflow history

Create synthetic workflow:

    Start
    → Worker Task
    → Wait
    → Review
    → Complete

Exit criteria:

- workflow survives process/deployment boundaries
- current state visible from UI
- history durable in Supabase
- duplicate execution prevented

---

## Stage 4: Worker Pack runtime

Objective:

Run one specialist worker against a Task Contract.

Implement:

- Worker Pack manifest
- worker charter
- input/output schemas
- knowledge requirements
- model requirements
- output validation
- worker receipts
- failure classification

Initial worker:

- Generic Researcher fixture

Exit criteria:

- worker gets only Task Contract context
- output validates
- no unrestricted conversation history
- worker stops on completion

---

## Stage 5: Model Router

Objective:

Create reliable model selection.

Implement:

- model registry
- capability metadata
- structured-output qualification
- tool-use qualification
- cost metadata
- routing requirements
- retry/fallback
- escalation
- provider telemetry

Initial policy:

- Luna-class default
- independent Claude reviewer route
- Sol-class escalation
- Gemini-class large-context route where justified

Avoid universal use of one cheap model.

Exit criteria:

- each worker contract resolves to qualified route
- fallback is a genuinely useful alternative
- model/provider failures do not cause workflow loops
- costs visible

---

## Stage 6: Worker evaluation framework

Objective:

Make worker competence testable.

Implement:

- Worker Pack eval fixtures
- schema tests
- role-boundary tests
- mocked capability tests
- positive examples
- negative examples
- qualification score/status

Promotion:

- Experimental
- Qualified
- Assisted
- Autonomous

Exit criteria:

- workers cannot be marked Qualified without passing required evals
- model changes rerun relevant evals
- failed real-world cases can be converted into regression fixtures

---

## Stage 7: Core UI and live activity

Objective:

Make workflow execution understandable.

Implement V2 visual design:

- Dashboard
- Workflow screen
- Needs You
- History
- Accounts
- Settings

Workflow screen:

- visual stage timeline
- current worker
- current task
- current action
- next step
- Activity Feed
- reusable central Workspace tabs

Workspace initial tabs:

- Live Browser placeholder
- Products placeholder
- Metrics placeholder
- Artifacts

Use Supabase Realtime or equivalent event streaming for live activity.

Exit criteria:

- user can understand synthetic workflow progress without reading logs
- current worker/state updates live
- Needs You state is visually obvious

---

## Stage 8: Browser provider qualification

Objective:

Select and integrate the remote browser platform.

Prototype both where practical:

- Browserbase
- Steel

Evaluate:

- live embed
- persistent sessions
- human takeover
- replay
- Playwright reliability
- uploads
- session isolation
- cost
- API quality

Build Core browser abstraction.

Exit criteria:

- one provider selected as default
- alternative remains architecturally replaceable
- browser session launches from workflow
- live view renders in central Workspace
- Take Control works
- Return Control works
- replay accessible

---

## Stage 9: Browser Planner qualification

Objective:

Train and qualify Browser Planner.

Implement structured observation:

- URL
- title
- visible content
- forms
- controls
- links
- stable element IDs

Action contract:

- one browser action at a time

Train/evaluate against:

1. synthetic pages
2. mock commerce site
3. real read-only sites
4. controlled draft mutation

Exit criteria:

- no invented selectors
- no unrestricted Playwright exposure
- browser actions visible in UI
- failures produce bounded recovery

---

## Stage 10: Pack framework

Objective:

Make specialist functionality installable.

Implement:

- Capability Pack manifest
- Knowledge Pack manifest
- Worker Pack manifest
- Workflow Pack manifest
- dependency resolution
- version pinning
- pack registry
- Business pack activation
- UI metadata
- pack qualification state

Create synthetic sample pack.

Exit criteria:

- new pack can be registered without modifying Core workflow code
- installed pack can add workflow/worker/knowledge definitions
- running workflows stay pinned to versions

---

## Stage 11: Web Research capability

Objective:

Provide reliable evidence collection as a reusable Core capability.

Implement:

- web research provider abstraction
- source records
- URLs
- timestamps
- evidence extraction
- deduplication
- freshness metadata
- citation/source linkage

Integrate with Researcher Worker.

Exit criteria:

- Market Researcher can produce structured Evidence Pack
- sources remain inspectable
- unsupported claims rejected

---

## Stage 12: Etsy and POD knowledge foundation

Objective:

Create the first real domain expertise.

Implement Knowledge Packs:

- etsy-selling
- etsy-current-policy
- print-on-demand
- product-research
- social-marketing baseline

Include:

- source
- version
- verification date
- freshness

Implement first Etsy-specific Worker Packs:

- Market Researcher configuration
- Product Strategist
- Reviewer

Exit criteria:

- Etsy Product Discovery workflow can run in simulation
- workers use scoped domain knowledge
- no publication yet

---

## Stage 13: Product discovery and experiment system

Objective:

Run real product research and preserve learning.

Implement:

- Product Candidate
- Experiment Registry
- evidence links
- candidate scoring
- TEST / REJECT / NEEDS_MORE_EVIDENCE
- duplicate experiment prevention
- measurement plans

UI:

- Products workspace
- candidate cards
- evidence view
- decision view

Exit criteria:

- system can research real candidate opportunities
- decisions link to evidence
- repeated candidate loops prevented

---

## Stage 14: Creative pipeline

Objective:

Turn an approved candidate into reviewed production assets.

Implement:

- Creative Director
- Design Brief
- image.generate capability
- asset storage
- asset versions
- design review
- bounded repair
- IP/policy screen

UI:

- Artifacts workspace
- design gallery
- review state

Exit criteria:

- approved candidate produces reviewed product-ready design
- generated assets and prompts are traceable

---

## Stage 15: Printful Capability Pack

Etsy POD topology clarification (2026-10-02): the intended selling connection is an Etsy-linked Printful store. Native Manual/API-store qualification is a separate bounded implementation and does not automatically associate products with Etsy or route customer orders. Stage 15 product mapping must establish the exact selling-store variant relationship before later selling readiness can be claimed. See [the topology checkpoint](checkpoints/ETSY_PRINTFUL_TOPOLOGY.md) for the current gaps and proposed linked-product/draft-adoption sequence. Account connection or a store-type change alone cannot close them.

Objective:

Create real production-ready POD products.

Implement:

- Printful account connection
- catalogue
- variants
- print constraints
- pricing/cost inputs
- product creation
- product mapping
- order/fulfilment support foundation

Exit criteria:

- product can be configured through Printful
- cost data enters deterministic pricing
- external resource/action receipts exist

---

## Stage 16: Etsy Capability Pack

Objective:

Create draft Etsy listings safely.

Implement:

- account connection
- listing reads
- draft creation
- image upload
- product attributes
- pricing
- external resource mapping
- receipt verification

Use API-first execution.

Browser fallback only where required.

Remain draft-only initially.

Exit criteria:

- approved Product Package produces a real Etsy draft
- no owner implementation permissions required
- duplicate draft publication prevented

---

## Stage 17: Listing Specialist and review

Objective:

Build reliable listing packages.

Train/evaluate:

- title
- description
- tags
- attributes
- image order
- disclosures
- factual claims

Reviewer validates before publication.

Exit criteria:

- listing package passes evals
- real drafts match verified product data
- policy knowledge freshness checked

---

## Stage 18: Assisted Etsy publication

Objective:

Prove publication in real environment.

Workflow:

    reviewed draft
    → Assisted owner confirmation
    → publish
    → verify
    → receipt

This temporary Assisted stage is for qualification, not permanent permission design.

Exit criteria:

- repeated publications succeed
- verification is reliable
- browser/API failures understood
- no duplicate listings

---

## Stage 19: Autonomous Etsy publication

Objective:

Promote listing publication to Autonomous.

Remove routine owner confirmation.

Workflow state and Reviewer approval become sufficient for routine publication.

Exit criteria:

- qualification threshold met
- action receipts verified
- Pause controls work
- Needs You reserved for exceptional cases

---

## Stage 20: Social Growth base and Instagram

Objective:

Promote products organically.

Implement:

- Content Specialist
- Campaign Package
- schedule
- Instagram account integration
- publication
- metrics
- campaign linkage

Exit criteria:

- published product creates social campaign automatically
- content passes review
- posts scheduled/published
- metrics returned

---

## Stage 21: TikTok integration

Objective:

Support TikTok within current platform requirements.

Implement:

- account integration
- Content Posting API where approved
- creator/platform-required consent states
- Assisted publish where required
- metrics where available

Do not fake autonomy that the platform explicitly disallows.

Exit criteria:

- compliant posting workflow
- current platform requirement surfaced clearly
- user only intervenes where platform requires it

---

## Stage 22: Order and fulfilment automation

Provider-native Etsy order import is not evidence that this stage is implemented. Initial product/listing qualification must preserve manual supplier order confirmation, with the actual store setting and exact Etsy-to-Printful variant association verified before future publication readiness. Automatic supplier confirmation/payment activation cannot bypass this stage's financial and duplicate-prevention controls. The current app does not inspect or change supplier confirmation settings; those controls remain an implementation gap.

Objective:

Complete the commercial loop.

Implement:

- order webhooks
- order validation
- Printful fulfilment
- supplier cost check
- shipping/tracking
- delivery state
- realised profit entry

Financial policy:

- paid-order fulfilment autonomous inside policy
- unexpected loss/cost anomaly → Needs You

Exit criteria:

- paid order can flow to fulfilment
- external receipt verified
- realised profit calculated deterministically

---

## Stage 23: Measurement and optimisation

Objective:

Allow Agent Labs to learn from actual performance.

Implement:

- measurement windows
- metrics
- Product Decision worker
- SCALE / ITERATE / CONTINUE_TEST / RETIRE
- experiment linkage
- business memory updates
- repeat-test prevention

Exit criteria:

- system makes evidence-based decisions after sufficient measurement
- no premature re-planning loops

---

## Stage 24: Money Policy Engine

Objective:

Introduce meaningful owner financial control.

Implement UI:

- marketplace fees
- advertising
- samples
- refunds
- fulfilment rules

Implement:

- standing financial envelope
- spend authorisation
- expiry
- purpose
- product/campaign scope
- deterministic enforcement

Needs You requests must be contextual business decisions.

Exit criteria:

- workers cannot increase their own financial authority
- routine operations inside envelope continue autonomously
- no technical permission prompts

---

## Stage 25: Full simulation and production qualification

Objective:

Qualify the complete Etsy POD pack.

Run:

    research
    → validate
    → design
    → product
    → listing
    → publish
    → social
    → order
    → fulfil
    → measure
    → realised profit

Exercise:

- failures
- model fallback
- browser interruption
- account expiry
- supplier anomaly
- owner intervention
- pause/resume
- replay
- duplicate prevention

Exit criteria:

At least one complete real workflow reaches verified realised profit with:

- observable UI
- no duplicated external action
- no unexplained human intervention
- reliable recovery
- acceptable provider/model cost
- complete receipts/evidence

Only after repeated success should additional business packs become priority.

---

## Stage 26: Social Growth pack expansion

Build Social Growth as an independent reusable Workflow Pack rather than Etsy-specific marketing code.

Prove it can operate on a Business without Etsy.

---

## Stage 27: Shopify Dropshipping pack

Build generic zero-inventory dropshipping as a separate workflow model.

Do not apply Etsy-specific rules.

Use Shopify and approved supplier adapters.

---

## Stage 28: Website Builder pack

Prove Agent Labs can change professions without rebuilding Core.

Use:

- GitHub
- Vercel
- Supabase
- browser QA
- coding specialists
- deployment workflow

This stage validates the future-proof modular architecture.

---

# 33. MVP definition

The first real V2 MVP is intentionally narrow.

One Business.

One owner.

One Etsy account.

One Printful account.

One Instagram account.

One TikTok account where practical.

One category:

- original print-on-demand T-shirts

One objective:

> Discover, create, publish and test original POD products, fulfil paid orders and measure realised profit.

Initially exclude:

- paid advertising
- generic Etsy dropshipping
- automatic large refunds
- broad customer service
- arbitrary account changes
- unrestricted web/computer access
- additional marketplaces

The MVP is successful when the complete real business loop works repeatedly.

---

# 34. Non-goals for early V2

Do not add early:

- a huge generic Permission Centre
- arbitrary shell access
- dozens of agents
- worker-created workers without a pack definition
- universal autonomous replanning
- complex model-budget enforcement
- multiple commerce channels before Etsy POD works
- numerous browser providers in production
- fine-tuning without evidence that it is required
- complicated organisation/team features before single-owner use works
- marketplace-style third-party pack installation before the internal pack architecture is proven

---

# 35. Definition of a healthy V2 workflow

A healthy workflow should have:

- clear start condition
- finite or measurable stage progression
- bounded workers
- minimal duplicated reasoning
- durable artifacts
- evidence-linked decisions
- observable actions
- deterministic money/account boundaries
- known recovery routes
- clear completion
- clear owner-intervention conditions

A workflow is unhealthy if it repeatedly invokes models without changing durable state.

---

# 36. Final design rules

These rules should guide implementation decisions.

1. **Workflow before worker.**
2. **Task Contract before model call.**
3. **Artifact before conversation history.**
4. **API before browser when practical.**
5. **Browser observation before action.**
6. **One bounded browser action per planning step.**
7. **Evidence before business claim.**
8. **Measurement before strategy change.**
9. **Simulation before autonomous production.**
10. **Financial envelope before spend.**
11. **Owner intervention should be a business decision.**
12. **Core provides capability.**
13. **Packs provide expertise.**
14. **Models are replaceable.**
15. **Provider adapters are replaceable.**
16. **Running workflow versions are immutable unless deliberately migrated.**
17. **No external success is trusted without a receipt or verified state.**
18. **Repeated real failures become eval fixtures.**
19. **Do not add complexity until the current vertical slice proves it is required.**
20. **If Agent Labs is working correctly, the user should be able to understand what it is doing by looking at the UI.**

---

# 37. Immediate next action

With this plan committed, implementation should begin with **Stage 1: Cloud application scaffold**.

The first implementation stage should:

1. scaffold the Next.js/TypeScript repository
2. connect the existing Agent Labs Supabase project
3. create the first Supabase migrations
4. implement Supabase Auth
5. implement the initial Business model and RLS
6. establish the V2 UI shell
7. create the Agent Labs Vercel project
8. deploy Preview and Production shells
9. establish typecheck/lint/test CI
10. stop before implementing workflows

The objective is a clean, deployed, database-backed foundation on which every later stage can be built without repeating V1's architectural mistakes.

## 2026-10-02 activation qualification note

Etsy automation and API-content research remain on an operational hold pending written clarification/authorization for the exact application purpose and operations. Key issuance, personal API access and seller consent are separate from that qualification. UI implementation and synthetic verification may continue without enabling provider actions. See [Etsy activation gates](ETSY_ACTIVATION_GATES.md) for current primary-source terms references and the required evidence. This note does not change schema, permissions or existing runtime policy.
