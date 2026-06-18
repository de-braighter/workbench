# Foundry v1 P3 — Self-Event-Sourcing (Bootstrap)

> Closes the foundry-builds-foundry loop by registering foundry as a first-class product
> in its own canonical log. One bootstrap function + one WRITE MCP tool; zero new event
> types; zero kernel change. Once landed, planFrontierAll surfaces P5-P8 as the live
> foundry frontier and a /foundry-conduct conductor can claim them off the log exactly
> as it claims oncology or whales items.
> **Pack-level only; charter COHERENT throughout.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/instances/foundry-product.ts`,
  new `src/instances/foundry-bootstrap.ts`, `src/mcp/server.ts`, `src/mcp/tools.ts`,
  new `src/instances/foundry-bootstrap.spec.ts`).
  `layers/specs` (ADR-254, status proposed).
- **Predecessors:** ADR-241 (foundry as sanctioned meta-product), ADR-244 (conductor drives
  plan-tree frontier), ADR-245 (canonical log), ADR-246/247 (queue→plan unified,
  planFrontierAll sole driver), ADR-176 (kernel minimality inclusion test).
- **Fuller-vision gap:** P3 in `.git/sdd/progress.md` (completeness-critic list after
  the autonomous ladder completed 2026-06-18).

---

## 1. Problem — foundry is a sanctioned meta-product with zero log presence

**Recon (verified against source):**

- `FOUNDRY_PRODUCT` (`src/instances/foundry-product.ts:6`) is a `CascadeNodeSpec[]` fixture
  with 4-level depth (product/capability/feature/work-item), 10 work-items carrying `status`
  and `yields` annotations.
- It is imported ONLY by `dist/instances/foundry-product.d.ts` (the dist declaration); no
  production path imports it. It is never passed to `blueprintToEvents`, `queuePush`, or any
  write op. Its `status` field is annotated by hand but **never read by any op at runtime**.
- The fixture is STALE: `story-v1-phaseB-log-collapse` (itemId `foundry/v1-phaseB-log-collapse`)
  carries `status: 'queued'` but its corresponding work (ADR-245/246/247) merged long ago.
  P5-P8 (the fuller-vision frontier from `.git/sdd/progress.md`) are absent entirely.
- `planFrontierAll` (`src/plan/plan-frontier-all.ts:24`) iterates `s.products.keys()` and
  calls `planFrontier(treeFromQueue(productKey, s), s, nowMs)` per product. It has **zero
  special-casing of 'foundry'**; `queuePush` has no guard against `productKey='foundry'`.
- `DerivedState.products` is a `Map<string, ProductState>` (`src/state.ts:88`) populated
  only by `ProductRegistered` events in the fold (`src/state.ts:155-167`).
- **Consequence:** `'foundry'` is not in `s.products` (no `ProductRegistered` event has ever
  been appended for it), so `planFrontierAll` never yields foundry items. The self-application
  loop is one `ProductRegistered` event — and a matching set of `WorkItemQueued` events —
  away from being real.

---

## 2. Decision — a bootstrap function seeds the log; the frontier derives from it

### What changes (thinnest falsifiable extension)

**R1 — Accurate bootstrap fixture:** Update `FOUNDRY_PRODUCT` to reflect current reality.
Rename the stale Phase-B work-item's `status` to `'done'` (it merged as ADR-245/246/247).
Add P5-P8 as new `work-item` nodes under a `feat-fuller-vision` feature (new) with
`status: 'queued'`:

```
foundry/p5  — Yields-in-log carry (P1 landed): status 'done'
foundry/p6  — (already the P2 MCP surface item if present; else add)
foundry/p7  — Live browser-runtime (may trip ADR-176)
foundry/p8  — (reserve; extend per real fuller-vision list)
```

Actual itemIds, titles, scopes, dependsOn, and yields for P5-P8 are specified in the
Slice scope section below. Add a top-of-file comment: `// BOOTSTRAP FIXTURE — status is
the one-time seed snapshot fed to foundryBootstrapEvents(); NEVER read at runtime.
itemStatus derives all truth from the log via fold().`

**R2 — Bootstrap function:** Add `src/instances/foundry-bootstrap.ts` exporting:

```ts
/**
 * Compute the set of events needed to register foundry as a product in its own log,
 * seeding all FOUNDRY_PRODUCT work-items. IDEMPOTENT: re-running against a state that
 * already has these events emits [].
 *
 * For work-items whose FOUNDRY_PRODUCT meta.status === 'done', emits a synthetic
 * claimAcquired + claimReleased(outcome:'done', sessionId:'foundry-bootstrap') pair so
 * that itemDone() returns true from the log alone — no MergeRecorded required (done
 * via claim-release path, which itemDone() already recognises per state.ts:112-113).
 *
 * @param state  - current DerivedState (from fold(readEnvelopes(logPath)))
 * @param ts     - ISO timestamp to stamp all emitted events
 * @returns      - ordered DomainEventEnvelope[] to append; [] if nothing new to emit
 */
export function foundryBootstrapEvents(
  state: DerivedState,
  ts: string,
): DomainEventEnvelope[] { ... }
```

Emission order:
1. `ProductRegistered('foundry', ...)` — if `!state.products.has('foundry')`.
2. For each work-item in `FOUNDRY_PRODUCT` (leaf nodes only, depth-order):
   - `WorkItemQueued(itemId, title, scope, dependsOn, yields, productKey:'foundry')` —
     if `!state.items.has(itemId)`.
   - If `meta.status === 'done'` AND item not yet done: additionally emit
     `ClaimAcquired(claimId: \`bootstrap-${itemId}\`, sessionId:'foundry-bootstrap', ...)` +
     `ClaimReleased(outcome:'done', sessionId:'foundry-bootstrap', ...)`.
3. Items already in `state.items` are skipped entirely (idempotent).

The function is pure (no I/O); it takes `state` + `ts` and returns events. It does NOT
call `append` directly.

**R3 — foundry_bootstrap MCP tool (WRITE):** Register in `src/mcp/server.ts` and implement
in `src/mcp/tools.ts`:

```ts
server.registerTool('foundry_bootstrap', {
  description: 'Register foundry as a product in its own canonical log and seed all ' +
    'FOUNDRY_PRODUCT work-items. IDEMPOTENT — re-running emits nothing when already done. ' +
    'Run once on the live log after landing P3. Returns { productRegistered, queued, markedDone }.',
  inputSchema: {},
}, async () => tools.foundry_bootstrap({}));
```

Implementation runs under `withStoreLock` (same lock as all other write ops, plus the P4
log-level lock when P4 is live). It reads current state via `fold(readEnvelopes(logPath))`,
calls `foundryBootstrapEvents(state, now())`, appends each event via `append(...)`, and
returns `{ productRegistered: boolean, queued: string[], markedDone: string[] }`.

### What does NOT change

- `planFrontierAll` — zero change; it already iterates `s.products.keys()` generically.
- `fold` — zero change; `ProductRegistered` and `WorkItemQueued` fold cases already handle
  `productKey='foundry'` without any guard.
- `treeFromQueue` — zero change; it accepts any `productKey`.
- `queuePush` — zero change; no guard against `productKey='foundry'` exists, and none is
  added (bootstrap uses the same event constructors, not `queuePush` itself, to avoid the
  duplicate-itemId guard firing on a partial state during bootstrap).
- No new event types; no new kernel contracts; no new `DerivedState` fields.

---

## 3. Architecture

```
FOUNDRY_PRODUCT fixture (bootstrap seed snapshot)
  status:'done' → claimAcquired + claimReleased(done) emitted
  status:'queued' → WorkItemQueued only

foundryBootstrapEvents(state, ts)
  pure fn — reads state, emits events
  idempotent: skips product/items already in state

foundry_bootstrap MCP tool (WRITE, under storeLock)
  calls foundryBootstrapEvents → appends → returns summary

fold(log) → DerivedState
  state.products now includes 'foundry'
  state.items now includes all FOUNDRY_PRODUCT work-items
  itemDone(item) === true for done items (claim-release path)

planFrontierAll(state, nowMs)
  iterates state.products.keys() → includes 'foundry'
  treeFromQueue('foundry', state) → plan tree
  planFrontier(tree, state, nowMs) → P5/P6 (queued, deps satisfied) visible
  P7/P8 hidden behind P5/P6 dependency edges as appropriate

conductor (/foundry-conduct)
  reads planFrontierAll → sees foundry items
  foundry_claim('foundry/p5-tree-reconciliation', ...) → SUCCEEDS (queued, dep p1 done)
  foundry_claim('foundry/p4-concurrent-writer', ...) → REJECTED (already done via claim-release)
```

---

## 4. FOUNDRY_PRODUCT P5-P8 work-items (bootstrap seed)

| itemId | title | scope.pathPrefix | dependsOn | yields | status |
|---|---|---|---|---|---|
| `foundry/p1-yields-in-log` | Yields-in-log (P1) | `src/metamodel/` | [] | `[{kind:'pack',id:'yields-in-log'}]` | `done` |
| `foundry/p2-mcp-surface` | MCP extract/compile tools (P2) | `src/mcp/` | [] | `[{kind:'pack',id:'mcp-extract-compile'}]` | `done` |
| `foundry/p3-self-event-sourcing` | Self-event-sourcing bootstrap (P3) | `src/instances/` | [`foundry/p4-concurrent-writer`] | `[{kind:'pack',id:'foundry-self-bootstrap'}]` | `done` |
| `foundry/p4-concurrent-writer` | Concurrent-writer safety (P4) | `src/store-lock.ts` | [] | `[{kind:'policy',id:'log-lock-v1'}]` | `done` |
| `foundry/p5-tree-reconciliation` | Hierarchical↔flat tree reconciliation (P5) | `src/plan/` | [`foundry/p1-yields-in-log`] | `[{kind:'policy',id:'tree-reconciliation'}]` | `queued` |
| `foundry/p6-scheduled-wake` | Scheduled-wake actuation (P6) | `src/wt-pool.ts` | [] | `[{kind:'policy',id:'scheduled-wake-v1'}]` | `queued` |
| `foundry/p7-live-browser-runtime` | Live browser-runtime target (P7) | `src/compiler/` | [] | `[{kind:'pack',id:'browser-runtime-v1'}]` | `queued` |
| `foundry/p8-devloop-retirement` | Devloop repo retirement (P8) | `src/log.ts` | [`foundry/p4-concurrent-writer`] | `[{kind:'policy',id:'devloop-retirement-v1'}]` | `queued` |

Note: P1/P2/P3/P4 are `status:'done'` in the shipped fixture (all merged before bootstrap
ran). P5-P8 are `status:'queued'` — the live frontier the conductor picks up post-bootstrap.
All scopes carry `repo:'de-braighter/foundry'`.

---

## 5. Acid test — must BITE

Test lives in `src/instances/foundry-bootstrap.spec.ts`. All fixtures authored inline; no
production log read. Vitest.

### T1 — Round-trip: bootstrap → fold → treeFromQueue reconstructs the item set

```
freshState = fold([])
events = foundryBootstrapEvents(freshState, TS)
stateAfter = fold(events)
tree = treeFromQueue('foundry', stateAfter)
leafItemIds = tree.filter(n => n.kind === 'work-item').map(n => n.meta.itemId)
```

Assert `leafItemIds` contains exactly the itemIds declared in `FOUNDRY_PRODUCT` work-item
leaves (verified count). Assert scope, dependsOn, yields on each node match the fixture.
This is the round-trip: fixture → events → fold → tree equals fixture.

### T2 — Log-derived frontier: queued items appear; done items do not

```
stateAfter = fold(foundryBootstrapEvents(freshState, TS))
frontier = planFrontierAll(stateAfter, Date.now())
frontierIds = frontier.map(i => i.itemId)
```

Assert `frontierIds` includes `foundry/p5-tree-reconciliation` (queued, dep p1 is done →
unblocked) and `foundry/p6-scheduled-wake` (queued, no deps).
Assert `frontierIds` does NOT include `foundry/p1-yields-in-log` (done),
`foundry/p2-mcp-surface` (done), `foundry/p3-self-event-sourcing` (done), or
`foundry/p4-concurrent-writer` (done).
Assert `frontierIds` does NOT include `foundry/p8-devloop-retirement` (queued but depends
on p4; p4 is done so p8 IS actually unblocked — assert it IS in the frontier). This is the
dependency-gate bite: a done dep unblocks its dependents.

### T3 — The BITE: stale annotation has no effect on frontier

```
// Mutate FOUNDRY_PRODUCT in-memory: flip p4's status to 'done' on the fixture copy.
// Bootstrap from an UNCHANGED log (freshState).
// Derive frontier from the resulting log.
```

Step 1 — prove translation is real:
- Bootstrap `freshState` using original fixture (p4 = queued) → fold → frontier includes
  `foundry/p4-concurrent-writer`.
- Bootstrap `freshState` using fixture with p4 forced to `done` → fold → frontier excludes
  `foundry/p4-concurrent-writer` (because done items are excluded via `itemDone()`).
  Assert these two results differ on `foundry/p4-concurrent-writer`. Proves
  `status:'done'` in the fixture DOES translate into log events that change the frontier.

Step 2 — prove runtime immunity:
- Take the log from the original bootstrap (p4 queued, in the log). Mutate the in-memory
  fixture to mark p4 `done`. Call `planFrontierAll` on `fold(originalLog)` — do NOT
  re-bootstrap. Assert frontier STILL includes `foundry/p4-concurrent-writer` (because
  planFrontierAll reads only the folded state, not the fixture). Proves `planFrontierAll`
  is immune to fixture mutations after bootstrap.

### T4 — Conductor claim

```
stateAfter = fold(foundryBootstrapEvents(freshState, TS))
```

Assert `ops.claim({ itemId: 'foundry/p5-tree-reconciliation', ... })` SUCCEEDS (queued,
deps satisfied — `foundry/p1-yields-in-log` is done in the bootstrapped state).
Assert `ops.claim({ itemId: 'foundry/p4-concurrent-writer', ... })` is REJECTED with an error
matching `already done` or `itemDone` (the claim path must reject done items; verified
against `state.ts:195-196` defense-in-depth). Note: p3 is also done post-bootstrap and
would likewise be rejected — p4 is used here because it has no dependsOn (simpler fixture).

### T5 — Idempotency

```
events1 = foundryBootstrapEvents(freshState, TS)
stateAfter1 = fold(events1)
events2 = foundryBootstrapEvents(stateAfter1, TS)
```

Assert `events2.length === 0`. Apply bootstrap twice:
- `stateAfter2 = fold([...events1, ...events2])` — state identical to `stateAfter1`.
- `planFrontierAll(stateAfter2)` deep-equals `planFrontierAll(stateAfter1)`.

### T6 — Negative control: another product's frontier unchanged

Register a second product `'other'` with one queued item `other/item-1` (no deps) in
`freshState` before bootstrapping. After `foundryBootstrapEvents`, assert
`planFrontierAll` still yields `other/item-1` in the frontier and its `itemState` is
byte-identical to what it was before bootstrap.

---

## 6. ADR-176 analysis — NOT triggered

P3 reuses EXISTING pack event types: `ProductRegistered`, `WorkItemQueued`, `ClaimAcquired`,
`ClaimReleased` — all defined in `src/events.ts` (pack-local Zod schemas, opaque to the
kernel). The bootstrap function is a pack-local pure function over pack-local state.
The `foundry_bootstrap` MCP tool is a pack-local write op under the existing `withStoreLock`.

Inclusion test (ADR-176): (a) none of the four kernel concerns (recurse-the-plan /
flat-the-observation / inference / reproducibility) is involved; (b) no shared infra
needed by ≥2 packs is introduced. Both gates fail → stays in pack territory.

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
ADR-254 (proposed) records the bootstrap decision; charter-checker must return COHERENT.

---

## 7. Design risks

**Risk 1 — seeding done items via claimReleased(done) vs MergeRecorded.**
`itemDone()` (`state.ts:112-113`) is defined as `it.merged != null || it.claims.some(c => c.released?.outcome === 'done')`. The claim-release path is already the canonical done-path for items that never produced a PR (e.g. internal milestones). Using it for bootstrap-done items is semantically consistent — it is the intended alternate completion path, not a workaround. The only difference from a real merge is the absence of a `prRef`; `ClaimReleased` has `prRef?` (optional), so it is structurally legal. The bootstrap sets `sessionId:'foundry-bootstrap'` to make origin auditable. This is the correct call.

**Risk 2 — registering P5-P8 as queued is the right call.**
The fuller-vision grind items have not been built; they are genuinely queued work. Registering them now means the conductor can pick them up via `foundry_claim` immediately after P3 lands. The alternative (defer registration until a human runs `foundry_queue_push` manually) adds ceremony with no benefit. Registering them here is the self-application payoff.

**Risk 3 — SETTLED: P3 marks itself done in the fixture; this does NOT violate log-as-authority.**
`foundry/p3-self-event-sourcing` carries `status:'done'` in the shipped fixture because the
bootstrap function is designed to run POST-MERGE (after the P3 PR lands). At the moment the
bootstrap executes, P3 is genuinely done. The fixture is a one-time accurate SEED — a snapshot
of reality at bootstrap time — not a runtime read. After seeding, the LOG is the sole runtime
authority: `itemStatus` is derived exclusively from `fold(log)`, and `planFrontierAll` reads
only `DerivedState` (folded from the log), never the fixture. The `FOUNDRY_PRODUCT` array
carries a top-of-file comment making this explicit. Conclusion: `status:'done'` for P3/P4 in
the fixture is correct and coherent; no log-as-authority violation; risk is resolved.

---

## 8. Reversibility

The bootstrap only appends events. Rolling back P3 means:
- Retire the `foundry` product's events from the live log (same retirement path as P1's
  log-retirement note — archive the foundry-product events from the canonical log).
- The `foundry_bootstrap` tool is removed; `foundryBootstrapEvents` is deleted.
- `FOUNDRY_PRODUCT` reverts to its prior stale snapshot.

No schema migration; no kernel change to reverse. The fold is forward-only — removing
events from the tail of the log restores prior state.

---

## 9. Operational cutover

After the P3 PR merges and `foundry_record_merge('foundry/p3-self-event-sourcing', prRef)`
is called:
1. Run `foundry_bootstrap` once on the live canonical log (idempotent; safe to re-run).
2. Run `foundry_status` — foundry should appear in the products list with P5/P6/P8 in
   the frontier (P3/P4 are done; P7 queued with no blocking deps also appears).
3. The conductor (`/foundry-conduct`) can now claim foundry items via `planFrontierAll`
   without any code change.

---

## 10. Deferred

- **Actually building P5-P8** — this slice registers them as the queued frontier; execution
  is separate arcs.
- **MergeRecorded as the done-signal for historical bootstrap items** — using
  `ClaimReleased(outcome:'done')` is correct and sufficient. Retrofitting a `MergeRecorded`
  for each historical shipped item is out of scope; it adds a `prRef` annotation but changes
  no frontier logic.
- **Hierarchical capability/feature nodes in the log** — `FOUNDRY_PRODUCT` is a 4-level
  tree; `WorkItemQueued` carries only leaf work-items. Capability/feature nodes are
  structure-only (no ops reference them). Encoding them in the log is deferred (separate
  concern; would require new event types and does not affect the frontier).
