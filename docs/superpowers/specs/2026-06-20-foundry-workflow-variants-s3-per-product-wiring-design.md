# Design — S3: per-product workflow-instance wiring (T0/T2 variants)

- **Date:** 2026-06-20
- **Scope:** `domains/foundry` (single consumer) — pack-level, ZERO kernel change
- **Status:** SHIPPED 2026-06-21 — S3a foundry#36, S3b #37, S3c #38 (all merged, each verifier-wave + opus-capstone verified); ADR-272 ratified (specs#357), reconciled to the final code. ZERO kernel change end-to-end; OQ-D (build-path advance-vs-spawn) deferred (demonstrator spawn kept).
- **Predecessor:** `2026-06-20-foundry-workflow-t0-t2-variants-design.md` (§5 S3); ADR-269 OQ-C/OQ-D
- **Scope decision (founder, 2026-06-20):** **wiring only** — run the SELECTED variant per product; KEEP the demonstrator `build-path` (spawns a sample). The spawn-vs-advance semantics (OQ-D) is a SEPARATE later slice.

## 1. Goal

Wire the S1/S2 variants into the running machine so that **each product runs the pipeline its `riskTier`
selects, keyed per product**: a T2 product walks the heavy 10-stage/2-gate pipeline, a T0 product the
light 4-stage/1-gate one, many concurrent — the per-product cardinality the founder chose. Today the
conductor + cockpit are hardcoded to the single `FOUNDRY_WORKFLOW` under one `WORKFLOW_PRODUCT_KEY`.

## 2. The instance-key model

A workflow **instance** for product `X` is keyed **`foundry-workflow:<X>`** (the existing
`WORKFLOW_PRODUCT_KEY = 'foundry-workflow'` becomes the *prefix* of an instance-key family). Its stage
work-items are namespaced **`foundry-workflow:<X>/<stageKey>`** so two products' instances never collide
in `s.items`. The variant spec is resolved from `X`'s `riskTier`:
`selectWorkflowVariant(state.products.get(X).riskTier)`.

New helpers in `src/instances/workflow-keys.ts` (the import-free leaf):

```ts
export const WORKFLOW_PRODUCT_KEY = 'foundry-workflow';          // unchanged — the prefix + the legacy default instance
export const workflowInstanceKey = (productKey: string): string => `${WORKFLOW_PRODUCT_KEY}:${productKey}`;
export const isWorkflowKey = (key: string): boolean =>            // recognises the whole family
  key === WORKFLOW_PRODUCT_KEY || key.startsWith(`${WORKFLOW_PRODUCT_KEY}:`);
export const productKeyOf = (instanceKey: string): string | null => // inverse; null for the legacy default
  instanceKey.startsWith(`${WORKFLOW_PRODUCT_KEY}:`) ? instanceKey.slice(WORKFLOW_PRODUCT_KEY.length + 1) : null;
```

**Back-compat:** the legacy single workflow (`WORKFLOW_PRODUCT_KEY`, `FOUNDRY_WORKFLOW`) stays a valid
instance — every generalized function defaults to it, so the shipped ladder acids
(`workflow-advance`, `dashboard-cockpit`) keep passing unchanged.

## 3. The four mechanical generalizations

### 3a — keys + frontier + isolation filters (the foundation)

1. **`isWorkflowStage`** (`state.ts:499`): `i.productKey === WORKFLOW_PRODUCT_KEY` → `isWorkflowKey(i.productKey)`.
2. **The 3 product-facing filter sites** likewise switch `=== WORKFLOW_PRODUCT_KEY` →
   `isWorkflowKey(...)`: `status.ts:13` (`isProductItem`), `render.ts:157` (`allItems`), `render.ts:165`
   (`stale`). (The `claimableItems` scope-scan at `state.ts:511` already calls `isWorkflowStage`, so it
   generalizes for free.)
3. **`workflowTree(spec, instanceKey)` / `workflowFrontier(state, now, spec, instanceKey)` /
   `workflowBootstrapEvents(state, ts, spec, instanceKey)`** (`workflow-frontier.ts`): add an
   `instanceKey` param (default `WORKFLOW_PRODUCT_KEY`, `spec` default `FOUNDRY_WORKFLOW`). The
   projection roots at `instanceKey`, each leaf's `itemId` becomes `<instanceKey>/<stageKey>`, and the
   authored `dependsOn` (which names stage KEYS) is rewritten to the namespaced ids
   `<instanceKey>/<depKey>`. `workflowFrontier` becomes `planFrontier(workflowTree(spec, instanceKey),
   …)`.
4. **`bootstrapWorkflow(deps, productKey)`** (`ops.ts:581`): read `state.products.get(productKey)
   .riskTier` → `selectWorkflowVariant(tier)` → `workflowBootstrapEvents(state, ts, spec,
   workflowInstanceKey(productKey))`. (No-arg call keeps bootstrapping the legacy default instance for
   back-compat.)

### 3b — the conductor (resolve spec per instance)

`conductWorkflowStep(deps, instanceKey = WORKFLOW_PRODUCT_KEY)` and
`authorizeWorkflowStage(deps, instanceKey, stageItemId)` (`workflow-conductor.ts`):
- resolve the spec once per call: `const spec = specForInstance(state, instanceKey)` where
  `specForInstance` = `productKeyOf(instanceKey)` is null ? `FOUNDRY_WORKFLOW` :
  `selectWorkflowVariant(state.products.get(productKeyOf(instanceKey)).riskTier)`.
- `workflowFrontier(state, now, spec, instanceKey)` everywhere (was the no-arg default).
- `stageNode(stageItemId, spec, instanceKey)`: strip the `<instanceKey>/` prefix to get the spec stage
  key, then find it in `buildCascadeTree(spec)` (was hardcoded `FOUNDRY_WORKFLOW`).
- `markStageDone` / `danglingOwnStage` / `recoverDanglingStage`: the conductor's own `conductClaimId`
  already keys on the stage itemId (now namespaced → already per-instance-unique); the
  recovery scan uses `isWorkflowStage` (now the family) — so it must additionally scope to THIS
  instance (compare `it.productKey === instanceKey`) so one instance's conductor never completes
  another's dangling stage.

### 3c — cockpit + MCP + wake (drive a chosen instance)

- **`render.ts`**: `workflowPipeline` becomes per-instance; the renderer lists ALL active workflow
  instances (group `s.items` by `isWorkflowKey` → instance key) and renders ONE `<!-- WF -->` panel per
  instance, each headed by its product key + tier, each with its own resolved spec + frontier. The
  drive buttons carry the instance key.
- **`server.ts`**: `POST /api/authorize-workflow-stage` and `POST /api/conduct-workflow` gain an
  `instance` body field (default the legacy key); the bounded walk calls `conductWorkflowStep(deps,
  instance)`.
- **`mcp/tools.ts`**: `foundry_bootstrap_workflow({ productKey })` and `foundry_conduct_workflow({
  instance?, authorizeStage? })`.
- **`wake`** (`ops.ts:520`): return the **flat union** of every active instance's frontier
  (`⋃ instances workflowFrontier(…, spec_i, instanceKey_i)`). ItemIds are namespaced → the union is
  unambiguous; callers that grouped by instance still can. (A single instance reduces to today's
  behaviour.)

## 4. Genuine design decisions (resolved here)

- **Wake aggregation → flat union of namespaced `ItemState[]`.** Namespacing makes itemIds globally
  unique, so a flat union needs no map wrapper and is the minimal generalization; the cockpit groups by
  instance for display. (Rejected: a `Map<instanceKey, ItemState[]>` return — a bigger surface change to
  every `wake` caller for no behavioural gain at one instance.)
- **Cockpit → one panel per active instance.** The single-panel `workflowPipeline` generalizes to a
  per-instance projection; instances are discovered by grouping `s.items` under `isWorkflowKey`.
- **Conductor crash-recovery → scoped to the instance.** `recoverDanglingStage`/`danglingOwnStage` must
  compare `productKey === instanceKey` (not just `isWorkflowStage`) so concurrent instances' conductors
  never cross-complete. (This is the one subtlety the per-instance generalization introduces; acid-pinned.)
- **`build-path` stays the demonstrator spawn** (founder scope call) — each instance's build-path still
  spawns its tier sample; OQ-D (build the bound product) is its own later slice.

## 5. Governance + ADR-176 (unchanged from S1)

The conductor's founder-gate halt logic is UNTOUCHED (it reads `founderGated` off the resolved spec), so
a T2 instance halts at BOTH its gates and a T0 at its one — the never-auto-pass invariant holds per
instance. ZERO kernel change (pack code; the instance key rides existing `productKey`/`itemId` strings;
no new event type — bootstrap reuses `WorkItemQueued`, done reuses the `claimAcquired`+`claimReleased`
pair). ADR-176 pack-level (both legs fail), the P7 precedent again. Isolation-by-non-registration
generalizes: every instance queues stage work-items, emits NO `ProductRegistered`, so none enters
`planFrontierAll`.

## 6. Sub-slices (one PR each, founder-gated; each independently testable)

- **S3a — foundation:** key helpers + `isWorkflowKey` + the 4 filter sites + the instance-parameterized
  frontier/bootstrap. Acids: two instances (a T0 + a T2) coexist in one log, each advances on its OWN
  `dependsOn` order, neither leaks into `planFrontierAll`/the product-facing views, a real product
  sharing the workflow repo stays claimable.
- **S3b — conductor:** `conductWorkflowStep`/`authorizeWorkflowStage` per instance + spec resolution +
  per-instance crash-recovery. Acids: a T2 instance halts at gate-1 then (after authorize) gate-2; a T0
  instance halts at its one gate; two instances conduct independently; the dangling-recovery never
  cross-completes.
- **S3c — cockpit + MCP + wake:** per-instance panels + instance-scoped routes + the MCP arg changes +
  wake union. Acids: the dashboard renders one panel per instance with the right tier/spec; a route
  drives the named instance only; `wake` returns the union.

## 7. Acid posture (all sub-slices)

Mirror `test/workflow-advance.acid.test.ts` / `test/dashboard-cockpit.acid.test.ts`: TEMP logs only;
each acid carries a RED-turning mutation; the **headline cross-instance acid** = bootstrap a T0 instance
(`prod-a`, riskTier T0) AND a T2 instance (`prod-b`, riskTier T2) into one temp log; assert each
instance's frontier walks ITS OWN variant's stages in order, the two never alias, and the
product-facing views/`planFrontierAll` see neither. The back-compat acid = the legacy no-arg
`bootstrapWorkflow()` / `conductWorkflowStep()` behave exactly as the shipped ladder acids expect.

## 8. Reversibility

Additive + parameter-defaulted: every generalized function keeps its old behaviour at the default
(legacy single instance), so the change is behaviour-preserving for existing callers. ADR (reserve next
free at ratify — ≥270, verify; 268 was raced, 269 merged). No new event type, no new dependency.
