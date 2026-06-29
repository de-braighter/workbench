# Foundry Live Status Join — Design

- **Date:** 2026-06-29
- **Status:** Draft for founder review
- **Scope:** `domains/foundry` only (the studio is untouched)
- **Builds on:** the node-detail inspector (foundry#78 `SystemNode.meta` + studio#131 Details section). That feature surfaced each node's *stored seed* `status`; this replaces it with the *live* event-log-derived status.
- **Constraints:** ZERO kernel change · ZERO studio change · read-only · ADR-176-aligned (pure derivation on read; nothing persisted)

## 1. Purpose

The node-detail Details panel shows a work-item's `status`, but that value is the **bootstrap seed** baked into `FOUNDRY_PRODUCT` (per its header comment, the live status is derived from the canonical event log via `fold()`, not the plan node). This joins the live status: when `/api/catalog` is served, each node whose `metadata.itemId` matches a live item in the fold has its `status` replaced with the **live** `itemStatus` (`done|retired|claimed|built|queued`). The studio Details "Status" field then shows event-log truth automatically.

Verified feasible: the cascade nodes' `itemId`s (e.g. `foundry/slice3-1`) exist as live items in the canonical log, so `itemStatus(state.items.get(itemId), now)` resolves.

## 2. Decisions

- **D1 — Replace, don't dual-display.** The live status overwrites the seed `status` on the node's metadata before mapping; a node with no matching live item keeps its seed value. No separate "live" field, no studio renderer change. (The `FOUNDRY_PRODUCT` seed statuses are mostly historical `done`, so a seed-vs-live comparison is rarely interesting.)
- **D2 — Foundry-side, server-only.** The join lives in the `/api/catalog` handler, which already has both the cascade tree (`models.foundry`) and the fold (as `/api/snapshot` demonstrates). The studio renders the (now-live) `meta.status` unchanged — ZERO studio change. Single repo, single PR.
- **D3 — Static-at-load, not polled.** The status reflects the event log at fetch time (the studio fetches `/api/catalog` once at app-init; a reload refreshes). Real-time polling (studio re-fetch + re-render) is deferred — YAGNI for a glance panel.
- **D4 — `/api/catalog` only.** `/api/plan-tree` (the flat panel) renders no status, so the merge has no visible effect there; left unchanged. Trivially extendable later.
- **D5 — Fail-soft.** If folding the log throws (unreadable/missing), skip the merge — nodes keep their seed status; never crash the endpoint.

## 3. Architecture & data flow

```
/api/catalog handler                                  (studio unchanged)
────────────────────                                  ─────────────────
fold(readEnvelopes(deps.logPath))   ── try/catch ──   SubstrateCatalogPersistence.load()
  → buildStatusByItemId(state, Date.now())              → Details "Status" shows the live
      = Map<itemId, ItemStatus>                            value (cleanMeta keeps `status`,
  → mergeLiveStatus(models.foundry.nodes, map)             so it flows to SystemNode.meta)
      (replace metadata.status where itemId matches)
  → mapNodesToCatalog(mergedNodes)
```

The merge runs on `PlanNode[]` BEFORE `mapNodesToCatalog`/`cleanMeta`, so the live `status` is what gets cleaned-and-attached to `SystemNode.meta`.

## 4. Functions (`src/dashboard/live-status.ts`, NEW)

```ts
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { itemStatus, type DerivedState, type ItemStatus } from '../state.js';

/** Build an itemId → live ItemStatus map from the folded canonical log. */
export function buildStatusByItemId(state: DerivedState, nowMs: number): Map<string, ItemStatus> {
  const out = new Map<string, ItemStatus>();
  for (const [itemId, item] of state.items) {
    out.set(itemId, itemStatus(item, nowMs));
  }
  return out;
}

/** Return nodes with metadata.status replaced by the live status where the node's
 *  metadata.itemId matches the map. Pure — never mutates the input nodes. Nodes
 *  with no itemId, or an itemId absent from the map, are returned unchanged. */
export function mergeLiveStatus(
  nodes: readonly PlanNode[],
  statusByItemId: ReadonlyMap<string, ItemStatus>,
): PlanNode[] {
  return nodes.map((node) => {
    const itemId = node.metadata['itemId'];
    if (typeof itemId !== 'string') return node;
    const live = statusByItemId.get(itemId);
    if (live === undefined) return node;
    return { ...node, metadata: { ...node.metadata, status: live } };
  });
}
```

> Confirm the exact export names/shapes of `DerivedState`, `ItemStatus`, and `state.items` (a `Map<string, ItemState>`) in `src/state.ts` during implementation; `itemStatus(item, nowMs)` is the existing accessor.

## 5. Handler wiring (`src/dashboard/server.ts`, `/api/catalog`)

The handler currently does `const nodes = models.foundry.nodes; const catalog = mapNodesToCatalog(nodes);`. Change to:

```ts
const treeRootId = models.foundry.treeRootId;
let nodes = models.foundry.nodes;
try {
  const state = fold(readEnvelopes(deps.logPath));
  nodes = mergeLiveStatus(nodes, buildStatusByItemId(state, Date.now()));
} catch {
  // log unreadable → fall back to seed statuses; never crash the endpoint
}
const catalog = mapNodesToCatalog(nodes);
```

`fold` + `readEnvelopes` are already imported in `server.ts` (used by `/api/snapshot`). Folding per request matches the existing `/api/snapshot` pattern.

## 6. Testing

- **`buildStatusByItemId`** — a `DerivedState` with two items (one merged → `done`, one only-queued → `queued`) yields a map `{ id1: 'done', id2: 'queued' }`. (Construct the state via the existing `fold` over a small synthetic envelope list, or a minimal `DerivedState` fixture — match whatever `state.ts` tests already do.)
- **`mergeLiveStatus`** — (a) node with `metadata.itemId` present in the map → `metadata.status` becomes the live value; (b) node with an itemId absent from the map → unchanged (seed kept); (c) node with no `itemId` → unchanged; (d) input nodes are not mutated (the returned node is a different object; the source `metadata.status` is untouched).
- **Integration** (`test/dashboard-catalog-endpoints.acid.test.ts`, mirror its boot harness) — boot `startDashboardServer` on port 0 with a temp log (`mkdtempSync`) containing an `itemQueued` for `foundry/slice3-1` (the `story-pool-auto` node, whose seed status is `done`). Fetch `/api/catalog`; in the response `catalog.systems[0].root` (the nested `SystemNode` tree — this is where status lives, since the flat `InterventionItem` carries no status), walk to the node whose `meta.itemId === 'foundry/slice3-1'` and assert `meta.status === 'queued'` — proving the live value **overrode** the seed `done`. (Use the existing event constructors from `src/events`/`src/log` the other acid tests use to append the `itemQueued` envelope.)

## 7. Out of scope (YAGNI)

- Real-time polling / push — static-at-load only.
- Live status in `/api/plan-tree` (the flat panel shows no status).
- A separate seed-vs-live display in the studio.
- Surfacing claim holder / PR ref / timestamps — only the single `ItemStatus` enum is joined.

## 8. Process

Single foundry PR via subagent-driven-development: implement (pure `live-status.ts` + handler wiring + tests) → review → wave (charter + local-ci) → merge → ritual → browser re-verify (restart `:4555` with merged code, reload studio, select a work-item, confirm the Details "Status" reflects the live fold value rather than the seed).
