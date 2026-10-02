# Whole-app single-viewport acceptance inventory

Updated 2026-10-02. This inventory implements the owner's latest whole-application requirement. It is not a claim that every route has already been converted.

## Release contract

For every owner-facing desktop workspace at 1280×720 and1440×900, document scrollHeight must be no greater than clientHeight (1px rounding tolerance), with no horizontal document overflow. Keep frequent actions visible, use compact rows, bounded server pages, tabs and selected-record panels. Long evidence, history and disclosures may scroll inside a clearly labelled contained viewer. Hiding or clipping inaccessible content does not satisfy this requirement.

At320/390px and200% zoom, readable reflow and accessible controls take priority over shrinking the desktop grid. Keyboard focus and anchors must remain visible beneath sticky controls and above the command bar. No important field may disappear into ellipsis without an accessible exact value. Preserve URL, Business, record identity, Back/Forward/reload and approval boundaries.

Use real source components/read contracts with realistic synthetic populated data: two Businesses, long duplicate names, mixed terminal/active states, old open requests, unknown cost, failed/incomplete reads, and100+ records where a collection exists. Test empty, loading, unavailable, stale, success and failure states too. All test provider networking/actions are denied. Source review alone and a screenshot of an empty page are insufficient.

## Route and surface inventory

Status meanings: **live** = deployed under the preceding release and evidence stated; **in progress** = current bounded implementation, not released; **held candidate** = prepared source that still needs the new visual/interaction gate; **pending** = retained route not yet converted/accepted. Nothing is outside scope merely because it is in Advanced.

| Route or surface | Current state | Required next acceptance |
| --- | --- | --- |
| `/` | Live authenticated redirect to dashboard, otherwise login; no workspace content | Preserve secure routing; no marketing landing page |
| `/login` | Existing private entry; pending whole-app visual regression | Compact viewport, validation/failure/return route; no live sign-in during fixture tests |
| `/auth/error` | Existing auth failure; pending visual regression | Clear next action and private-entry framing; no raw internal errors |
| `/dashboard` / `?view=overview` | Live compact console; seven viewport renders reviewed | Add exact1280×720 regression; preserve approved geometry and truthful global/partial state |
| Overview `centre=browser` | Live saved metadata only, no live stream | Keep explicit viewing blocker, context/history navigation and compact dimensions; real stream remains separately blocked |
| `sheet=research` | Live native modal with retained-transition/focus fix (PR42) | Retain bounded viewport, draft/consent isolation and exact return context in every originating pane |
| `?view=connections` | In progress: compact provider rows, request details and visible outcomes | Populated states and history, pending/validation/safe errors, viewport/keyboard, exact request and saved-registry truth |
| `/dashboard/accounts` | In progress: ordinary deep links adapt to root Connections | Preserve Business/request/known outcome; no silent notice loss or legacy giant-card jump |
| `/dashboard/accounts?diagnostics=platform` | Retained diagnostic page; pending compact conversion | Bring configuration/provider/history tools into consistent contained Advanced workspace, preserve known diagnostic outcomes |
| `/dashboard/accounts/secure` | In progress: isolated credential entry within console frame | Actual field validation/pending/uncertain response, exact consent/store binding, no token in URL/log/storage/fixtures; scoped root return |
| `/dashboard/accounts/registration` | Existing secure owner handoff; pending compact framing | Isolated secure surface, exact request and expiry, no captured secrets or automatic provider launch during QA |
| `/dashboard/accounts/password` | Existing secure vault entry; pending compact framing | Exact connection/revision/consent, visible outcomes and scoped return; no password exposure |
| `?view=decisions` | In progress: compact independent queue and selected failure/evidence | Exact count/page, old open records, stopped-versus-active truth, typed reviewed history, no false completion or cost settlement |
| `/dashboard/needs-you` | Existing legacy decision queue; pending adaptation | Preserve deep links/outcomes into root Decisions; no recent-window claim of a complete queue |
| `?view=work` | Existing root pane; populated candidate held | Bounded server pages/search/sort, exact selection, one-viewport populated layouts, retained-client scroll/history |
| Root Work exact `run`/artifact selection | Live exact artifact disclosure/focus; populated candidate held | Preserve exact artifact after pagination, Back/reload and sticky-toolbar changes; no legacy jump |
| `/dashboard/workflows` | Existing legacy index; pending adaptation | Root Work mapping with Business/filter/selection and accurate totals |
| `/dashboard/workflows/[workflowRunId]` | Existing protected technical detail; pending compact adaptation | Keep every tab/action/evidence/deep link, exact run and typed outcomes inside consistent viewport; bounded long content |
| Workflow `[workflowRunId]/error.tsx` | Existing recovery boundary; pending acceptance | Visible failure/recovery within frame; no stale success or unsafe action replay |
| `?view=library` (designs) | Existing root gallery; populated candidate held |25-row server pages, capped private previews, exact off-page selection, separate technical/production/print/listing state |
| `?view=library&type=research` | Existing root research; grouped candidate held | Goal/attempt grouping, bounded pages, precise field search, exact evidence and action return |
| `?view=library&type=records` | Existing exact saved-record view | Contained long JSON/evidence, exact ID/Business, accessible selection and return |
| `/dashboard/artifacts` | Existing creative approvals/receipts; exact recovery candidate held | Exact old run/approval links beyond recent windows, honest missing context, compact contained history/approvals |
| `/dashboard/products` | Existing research/candidate tools; pending conversion | Preserve manual candidate/evidence functions, fix independent-window truth, bounded read/paging and compact selected detail |
| `?view=activity` | Existing recent event view; paged candidate held | Independent count/page/filter, exact event/workflow, unknown state and long payload containment |
| `/dashboard/history` | Existing legacy history; pending adaptation | Root Activity/Work mapping, no bounded-window “Total” claims |
| `?view=advanced` | Live compact directory; child tools not all converted | Keep less-frequent tools accessible without duplicate primary navigation |
| `/dashboard/settings` | Existing owner/Business page; pending compact conversion | Owner profile and workspace controls in contained view, exact outcomes, long/multiple Business fixtures |
| `/dashboard/packs` | Existing capability setup; pending compact conversion | Compact catalog/install/qualification views, bounded rows, exact Business/action version and outcome |
| `/dashboard/model-router` | Independent legacy frame; pending conversion | Consistent console, loaded-versus-global cost/activity truth, bounded models/routes/runs, no live proof action during QA |
| `/dashboard/worker-proof` | Independent legacy frame; pending conversion | Consistent console, real receipts and unknown missing events, bounded history and exact selection |
| `/dashboard/worker-evaluations` | Independent legacy frame; pending conversion | Consistent console, bounded evaluations/promotions and honest subset metrics, preserve qualification actions |
| `/dashboard/printful` | Existing operational workspace; pending compact conversion | Exact store/Business/intervention, compact qualification/product/cost panels, existing execution gates unchanged |
| `/dashboard/etsy` | Existing operational workspace; pending compact conversion | Compact draft/listing/publication panels and exact context; no live route/provider checks while activation hold applies |

The filesystem inventory contains21 `page.tsx` routes plus the workflow error boundary. Query surfaces above are listed separately because they need their own tests. API endpoints, OAuth callbacks and server actions are not rendered pages; their owner guards, return contexts and effect boundaries remain part of each journey's acceptance.

## Intentional navigation map

The owner's later instruction permits additional focused destinations; five primary labels are not a limit. Do not add duplicate labels for the same workspace or an empty destination merely to fill the rail.

The conversion target is frequent tasks near the top: Overview, Work, Decisions, Research, Library and Connections. Research may become its own canonical root view instead of being hidden beneath Library; its former Library subtype and Products research links must retain Business/goal/attempt context. Keep Activity and Profile lower in the rail, with Profile taking the owner/Business editing responsibilities currently scattered through Settings and Connections. Connections should concentrate on actual provider access, setup status and the next connection step.

Specialist tools remain clearly grouped lower down: Packs, Model Router, Worker Proof and Evaluations can each have a focused console view, reached from the Tools group with a stable URL. Their existing paths remain aliases/adapters, not separate visual systems. Printful product preparation and Etsy listing/publication are focused operational views linked from relevant work and Connections; they must not be squeezed into the provider-status overview. A Costs destination is justified only once its bounded, truthful receipt view exists; do not invent lifetime totals or add a placeholder now.

These are target mappings, not shipped-route claims. The inventory above records current status. Each addition must identify one canonical URL, active-nav label, former deep-link mapping, scoped Back/return path and mobile navigation behavior before acceptance.

## Bounded release order and evidence

1. PR42 modal fix: deployed `d939a2b3`; exact-head and main gates each1,521 passes,120 hosted images. Actual overview pixels unchanged. Live safe-root reproduction is tracked separately from synthetic active-state tests.
2. Connections/secure entry first: visible feedback and compact in-console flow, then actual populated screenshots before merge.
3. Decisions: approved narrowly scoped terminal-review function and compact UI, independent SQL/ACL/rollback review before migration, then hosted/live read-only acceptance. Deployment never acknowledges the three existing notices; only an owner click may do so.
4. Work/Library/Activity: resume the held collection candidate, revised for this whole-app contract and all discovered lifecycle fixes.
5. Remaining setup, operational and Advanced routes: convert/adapt every pending row above; do not claim whole-app completion until each row has exact-head viewport and interaction evidence.

Private RPCs currently cap some account/Etsy/Printful histories at50 records without cursor/count contracts. Keep those limits explicit; client paging cannot recover unseen records. New historical RPC/schema scope needs its own approval, separate from the approved notice-acknowledgement function. See `POPULATED_ROUTE_AUDIT.md` for exact findings; its implementation remains in the held candidate unless a release entry says otherwise.

Etsy application-purpose/automation authorization and all commerce qualification gaps remain independent. UI conversion must not activate provider workflows, relax permission boundaries, or present configured credentials as authority to execute.
