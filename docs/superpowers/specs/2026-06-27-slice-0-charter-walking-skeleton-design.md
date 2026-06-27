# Slice 0 — Charter Walking Skeleton (design)

- **Date:** 2026-06-27
- **Status:** Draft for founder review
- **Parent program:** `2026-06-27-recursive-charter-runtime-program-design.md` (Slice 0 of the walking-skeleton sequencing)
- **Approach:** C — headless + real kernel DB (no studio UI)
- **Scope:** new `layers/charter-runtime` (pure) + one substrate-layer integration test; **zero kernel production change**

## 1. Purpose

Prove cheaply, end-to-end through code, that the recursive Charter Node model is sound where it is risky:

1. A Charter Node (governance contract carried on `PlanNode.metadata`) **round-trips through the real `kernel.plan_node` store intact** (@2.7 contract compat; RLS/FK/acyclic-trigger/`kindRef` all accept it).
2. Inheritance (`scope` narrow-only) **works and fails closed**.
3. One **uniform, event-sourced lifecycle pass** runs and is **replay-safe** (handler exactly-once).
4. The **Kernel-Untouched Invariant** holds.

It builds *no* features and *no* UI. Its deliverable is confidence + the e2e/seam harness that every later slice extends.

## 2. Layer setup

- New sibling layer repo **`layers/charter-runtime`**, package **`@de-braighter/charter-runtime`** — plain TS lib (tsc + vitest, like the substrate libs), workspace-registered.
- Depends on `@de-braighter/substrate-contracts@^2.7` (the published `PlanTree`/`PlanNode`/`PlanTreeSchema`). Consumed locally via `workspace:*` — **npm publish deferred** until a domain consumes it (S3+), so Slice 0 skips the publish + `minReleaseAge` dance.
- **Setup prerequisite (founder-gated, outward-facing):** create the GitHub repo `de-braighter/charter-runtime` + SSH-clone it (the board-recipes new-repo precedent). I will not create the remote repo without explicit go.

## 3. Charter Node — the typed lens (`charter-node.ts`)

A Charter Node **is** a kernel `PlanNode`; the contract is a Zod-validated value namespaced under `metadata.charter` (a distinct key from the kernel's top-level reserved `__kindRef` / `__tenantPackId`, so no collision).

```ts
type CharterRole = 'product' | 'task';                 // skeleton subset; full set later
interface CharterContract {
  role: CharterRole;
  mission: { objective: string; outcome: string };
  scope: { allowedPathPrefixes: string[] };            // the field inheritance narrows
}
// Lens (no kernel type extension):
readCharter(node: PlanNode): CharterContract | null;   // parse metadata.charter (Zod), null if absent/invalid
writeCharter(node: PlanNode, c: CharterContract): PlanNode;  // set metadata.charter
```

Deferred (same `metadata` mechanism, later slices): `autonomy`, `quality`, `acceptance`; roles beyond product/task.

## 4. Inheritance — fail-closed (`inheritance.ts`)

```ts
validateInheritance(parent, child): Result<void, InheritanceViolation>;  // scope narrow-only
effectiveScope(chain: CharterContract[]): { allowedPathPrefixes: string[] };  // intersection (derived, never stored)
```

- **Narrow-only:** every `child.scope.allowedPathPrefixes` entry must be covered by some `parent` prefix. A child prefix outside the parent → **violation (error, not warning)** = fail-closed.
- `effectiveScope` = the running intersection down the ancestor chain — a derived view.
- **Tests:** a golden table (covered/widening/equal/empty cases) + a fail-closed bite (widening child must error) + an `effectiveScope` derivation test.

## 5. Uniform lifecycle — event-sourced (`lifecycle.ts`)

```
intake → validate (runs validateInheritance) → execute (ACTION_REGISTRY dispatch → emit event) → record → resolve(done)
```

```ts
type CharterEvent = { type: 'charter:NoteRecorded.v1'; nodeId: string; payload: { note: string }; occurredAt: string };
const ACTION_REGISTRY: ReadonlyMap<'record-note', Handler>;   // closed map; unknown kind throws
runLifecyclePass(node, ctx): { events: CharterEvent[]; resolution: 'done' | 'blocked' | 'rejected' };
foldCharterState(events): ProjectedState;                     // pure fold
```

- The one action `record-note` is a no-op-ish handler that **emits one event** (proves the declaration⊥actuation seam without real side effects).
- **Replay/idempotency acids:** `foldCharterState(E)` is deterministic; `foldCharterState(E) deepEquals foldCharterState([...E, ...E])` (duplicate-append safe); the handler is **not** invoked during fold (exactly-once — execution emits, replay folds).
- `occurredAt` is injected (no `Date.now()` in the fold path — replay-stability, the foundry's seeded-determinism lesson).

## 6. Real-DB round-trip (Approach C)

Two complementary proofs:

- **Charter mapping (charter layer, fake delegate):** save the 2-node charter tree through `PrismaPlanTreeStore` with the array-backed `FakePlanTreePrisma`, load back, assert **deep-equal** — proves the charter contract on `metadata` survives the store's domain↔row mapping. Pure, fast.
- **Real kernel schema (substrate integration spec):** a NEW `prisma-plan-tree.store.db.spec.ts` in `layers/substrate` saves a **generic metadata-rich** `PlanTree` (deeply-nested `metadata`, no charter vocabulary) to **real Postgres** (reuse `vitest.db.config.ts` + `tools/db/vitest-db-global-setup`), loads back, asserts deep-equal — proves RLS/FK/acyclic-trigger/`kindRef` accept it. Fills a genuine kernel test gap; charter-agnostic, so the Invariant holds.

## 7. Kernel-Untouched Invariant (workstream T, established here)

- **Zero-diff guard** — a CI assertion that these **production** paths are unchanged vs `origin/main`: `substrate-contracts/src/plan-tree/plan-tree-schemas.ts`, `plan-tree-store.port.ts`, `substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts`, and the `kernel.plan_node` migration. (Adding a *test* file to substrate is allowed — tests are not kernel production surface.)
- **Boundary acid** — a source scan asserting (a) no charter vocabulary (`charter`, `CharterContract`, role names) appears under `layers/substrate/**` (production), and (b) `layers/charter-runtime` consumes `substrate-contracts` only via its published surface, adding **zero fields** to `PlanNode`/`PlanTree` (the zero-diff guard backs this).

## 8. The e2e/seam capstone

One integration test threading the whole skeleton:
`build 2-node fixture → validate (pass) → negative: widening child fails → lifecycle pass (execute → event → replay-once) → kernel save/load (deep-equal)`. This is the harness later slices extend.

## 9. Acceptance criteria

- [ ] `@de-braighter/charter-runtime` builds + is workspace-registered.
- [ ] Charter Node lens reads/writes the contract on `metadata.charter`, Zod-validated.
- [ ] Inheritance passes valid trees, **errors on widening** (fail-closed); `effectiveScope` derived correctly. Golden + bite green.
- [ ] Lifecycle pass emits the event; fold deterministic + duplicate-safe; handler exactly-once.
- [ ] Real-DB round-trip: a metadata-rich `PlanTree` saves+loads deep-equal against real Postgres.
- [ ] Kernel-Untouched Invariant: 4 production paths unchanged; no charter vocab under `layers/substrate`.
- [ ] e2e capstone green.
- [ ] `ci:local` green for `charter-runtime` + `substrate` (added integration spec).

## 10. Quality plan

Non-trivial + cross-repo (`charter-runtime` + `substrate`) → **full verifier wave** (local-ci · reviewer · charter-checker · qa-engineer) + opus whole-branch review. PR-gated per repo. `charter-checker` is load-bearing here — it certifies the Invariant. TDD throughout (the acids are the spec).

## 11. Out of scope

Studio UI, HTTP/MCP bridge, `autonomy`/`quality`/`acceptance` fields, roles beyond product/task, multiple inheritance rules, foundry migration, generate/compile, npm publish of `charter-runtime`.

## 12. ADR

Opens the charter layer + Charter Node contract + the inheritance model → an **ADR (designer-first)**, drafted alongside this slice (the skeleton proves what the ADR ratifies). Records: contract-on-`metadata` placement, the ADR-176 inclusion-test result (fails → layer), the narrow/restrict/add-only inheritance law, the Kernel-Untouched Invariant.

## 13. Open questions (for the plan)

- Exact reuse shape of the substrate DB harness from a new layer's integration spec (place the real-DB test in `substrate` — confirmed §6 — vs a charter-side harness). Spec picks `substrate`-side; the plan confirms the wiring.
- Event-identity for duplicate-fold dedup (content hash vs explicit id) — the foundry uses a content `dedupKey`; mirror it.

## 14. Next step

On approval → `writing-plans` for Slice 0.
