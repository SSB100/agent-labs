# Installable Packs

Stage 10 adds declarative Capability, Knowledge, Worker, and Workflow Packs. Platform registration installs definitions in the existing Core catalog. Business activation stores an immutable dependency snapshot. Each launched Workflow Run copies that snapshot, so activating another release only affects future launches.

`packs/catalog.json` contains the synthetic qualification releases. A manifest declares its identity, kind, UI metadata, exact dependencies, required evaluations, and one matching definition collection. Only exact semantic versions are accepted. Missing dependencies, conflicts, cycles, stale required knowledge, ambiguous definitions, and undeclared worker scope fail closed.

## Register a new release

1. Add a JSON manifest following the types in `src/packs/types.ts` and validation in `src/packs/registry.ts`.
2. Run `npm run pretest` to compile the manifest validator.
3. Create a tracked migration with `supabase migration new register_example_pack`.
4. Run `node scripts/register-pack.mjs new-pack.json supabase/migrations/<created-migration>.sql packs/catalog.json`. The optional last argument supplies dependency releases already in the catalog.
5. Review and apply the generated migration. It calls the private registrar and creates an experimental release. Re-registering identical content is idempotent; changing content requires a new version.
6. Run the declared evaluations and record passing platform evidence with the private qualification function in a reviewed migration. Owners cannot register or qualify releases.
7. An authenticated Business owner can activate the qualified release from **Packs** and launch its workflows. No Core workflow code change is required.

## Execution boundary

One generic Vercel Workflow interpreter executes the manifest's bounded, sequential stages. Each stage receives one durable Task Contract and only its referenced Artifacts. A stage reads workflow input or the completed output of an earlier stage. Knowledge includes provenance, version, verification time, and a freshness window.

The trusted executors are structured field mapping and the qualified standard Model Router. Manifests contain data and instructions; they cannot register scripts, SQL, network destinations, or browser handles. External capability adapters require separate Core implementation and qualification. Completion validates Worker and Workflow output schemas. Retries reuse saved outputs and deterministic durable records. Failures close active tasks, workers, and stages.

## Verification

`tests/packs.test.mjs` exercises the four manifest kinds, dependency failures, scope, arbitrary executor rejection, new catalog entries, output validation, and version pinning. `supabase/tests/stage10_packs.sql` verifies definition installation, activation, owner isolation, qualification restrictions, immutable run pins, idempotency, scoped runtime access, receipt versions, and execution of a reserved v1 run after activating v2. All database test changes roll back.
