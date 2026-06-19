# Foundry observability dashboard — a "mission-control" overview of the machine

> A self-contained HTML page that answers, in ONE glance: **is the machine healthy?
> what needs me? what's next? — and on which level did we model each product?**
> OVERVIEW-FIRST — it leads with deltas + decisions and collapses inventory (done items)
> into progress bars; it NEVER dumps every product's full plan tree as endless-scroll rows.
> It DOES surface each product's AUTHORED hierarchy compactly (a plan-tree-structure panel:
> Product → Capability → Feature → work-item, with rollup chips + status-colored leaf
> badges), falling back to a one-line summary for products without an authored model
> (labelled `(log-derived — flat until re-cutover)` — the live-flat-vs-authored-model gap
> made visible). A PURE renderer over foundry's OWN derived state (`fold` → `DerivedState`
> + `planFrontierAll`) — the authored models are INJECTED via `opts.models` so the renderer
> stays pure — a thin CLI that writes the file, and a read-only MCP tool. **Zero kernel
> change** — pack-level rendering over a derived view ("store generators, derive graphs"
> upheld; ADR-176 NOT triggered).

- **Date:** 2026-06-19
- **Scope:** `domains/foundry` — a NEW `src/dashboard/` module:
  `src/dashboard/render.ts` (new — the pure renderer
  `renderFoundryDashboard(state, nowMs, opts?): string`), `src/dashboard/cli.ts` (new — the
  thin `dashboard` CLI that folds the live log, builds the authored model via
  `buildCascadeTree(FOUNDRY_PRODUCT)`, and writes the HTML), the `foundry_dashboard`
  read-only MCP tool in `src/mcp/tools.ts` (one additive entry), a `"dashboard"` npm
  script in `package.json`, and `test/dashboard.acid.test.ts` (new — the signal-quality
  acid battery). `layers/specs` (ADR-261, status proposed).
  **No `@de-braighter/substrate-*` change. No `@de-braighter/design-system-*` change.**
- **Predecessors / boundary:**
  [ADR-243](../../../layers/specs/adr/adr-243-scenario-lab-engine-purity.md)
  (the compiler-agnosticism gate the dashboard is INTENTIONALLY OUTSIDE — see §3),
  [ADR-259](../../../layers/specs/adr/adr-259-foundry-browser-runtime-compile-target.md)
  (the P7 browser-runtime crown — the interactive-evolution path for the dashboard, §8),
  [ADR-250](../../../layers/specs/adr/adr-250-foundry-multi-target-product-compiler.md)
  (the CompileTarget registry the dashboard does NOT register into — it is not a compile
  target),
  [ADR-242](../../../layers/specs/adr/adr-242-product-substance-face-derived-projection.md)
  (the derive-don't-store discipline the dashboard mirrors — a pure projection, never
  persisted state),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
  (the inclusion test — §7),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel
  concerns).
- **Provenance.** Designed + iterated with the founder against a working throwaway demo
  (`domains/foundry/.git/sdd/foundry-dashboard-demo.mts`, NOT committed) — the demo rendered
  the live canonical log to a self-contained HTML and was approved after the overview-first
  inversion (below). This spec productionizes the demo into a tested `src/dashboard/` module:
  the renderer becomes a PURE function (no I/O → unit-testable), the live-log read moves to a
  thin CLI, and a read-only MCP tool wraps it. The layout, the data sources, and the
  priority-anomaly logic are carried faithfully from the approved demo.

---

## 1. Problem — the founder cannot see the machine at a glance

Foundry is a multi-product machine: products register, items queue, conductors claim + build
+ merge them, gates await founder decisions, claims go stale. ALL of this is in the canonical
event log and folds to `DerivedState` (`src/state.ts:97`) — but the founder has no
single surface that answers the three operating questions:

1. **Is the machine healthy?** (idle or busy; how much is in flight; anything stale/stuck)
2. **What needs me?** (pending gates; reclaimable stale claims; priority anomalies)
3. **What's next?** (the top of the global frontier the conductor will claim)
4. **On which level did we model each product?** (the founder's direct question — for
   foundry itself: is its work registered against an AUTHORED Product → Capability →
   Feature → work-item hierarchy, or is the log still FLAT? The dashboard answers this
   visually AND surfaces the gap: products whose live log has not been re-cut over to the
   authored model show a `(log-derived — flat until re-cutover)` label — the OWED
   re-cutover made visible.)

`foundry_status` (`src/status.ts:31`) prints a useful text board, but it is a flat dump — it
lists every product and its per-status counts as text. It does not VISUALLY separate "needs a
decision" from "inventory", and it does not surface the derived priority-anomaly advisory the
founder asked for. The founder wants a **mission-control page**: a glanceable, visual overview.

### 1.1 The rejected v0 — the endless-scroll plan-tree dump

The first prototype rendered, for EVERY product, its FULL plan tree — every node, every item,
done or not, as an individual row. The founder **rejected** it: it was endless scroll with no
signal. A 200-item machine where 180 items are done produced a 200-row page; the 20 items that
mattered drowned in the 180 that did not. Listing done work as individual rows is pure noise —
the founder does not act on a done item.

**The plan-tree-STRUCTURE panel (§4 panel 6) is NOT the rejected dump.** It renders the
AUTHORED hierarchy (Product → Capability → Feature → work-item) COMPACTLY — one line per leaf
(a status-colored dot + the title), with capability/feature rollup CHIPS and a structural
caption — to answer "on which level did we model this product", not to enumerate every item as
an actionable row. The done-collapse discipline still bites where it matters: for a product
WITHOUT an authored model the panel does NOT enumerate its (mostly-done) flat log — it collapses
to a one-line summary and lists only the OPEN items. The rejected v0 was a flat per-item DUMP
with no structure and no collapse; the structural panel is a compact authored TREE with a
collapsing flat fallback. The two are different by construction (and acid-locked apart, §6).

### 1.2 The approved design — the overview-first INVERSION

The approved design INVERTS the information hierarchy:

- **Lead with deltas + decisions.** The first thing on the page is the machine-state pill, the
  KPI strip, and the attention row ("needs attention" + "up next"). These are what the founder
  acts on.
- **Collapse inventory into bars.** Done items NEVER render as individual rows. They collapse
  into per-product progress bars + counts (`done/total` + a `%` bar). A product that is 100%
  done is ONE compact green row, not N done-item rows.
- **One drill-down, scoped to open work.** The only place individual items appear is the
  "active work · what's left" panel — and it lists ONLY the NON-done items of products that
  still have open work. A fully-done product contributes nothing there.

The result: a 200-item machine renders a compact page whose row-count is bounded by
`products + open-items + top-5-frontier`, not by total items. The signal-to-noise inverts.

---

## 2. The module — renderer / CLI / MCP

Three thin pieces, separated so the renderer is a PURE, unit-testable function:

### 2.1 The pure renderer — `renderFoundryDashboard(state, nowMs, opts?): string`

```ts
// src/dashboard/render.ts
import type { PlanTree, PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import {
  itemStatus, activeClaim, staleClaims,
  type DerivedState, type ItemState, type ItemStatus,
} from '../state.js';
import { planFrontierAll } from '../plan/plan-frontier-all.js';

/** Injected authored model trees + the footer merge count — both built by the I/O
 *  caller (CLI/MCP) and passed in so the renderer stays PURE. `models[productKey]` is
 *  the AUTHORED Product → Capability → Feature → work-item PlanTree; a product absent
 *  here falls back to the flat log-derived summary (honestly labelled). */
export interface DashboardOpts {
  models?: Record<string, PlanTree>;
  merges?: number;
}

/** PURE: no I/O, no clock read (nowMs is injected), no log access. Returns a
 *  self-contained HTML string (inline CSS, no external resources). Unit-testable. */
export function renderFoundryDashboard(
  state: DerivedState, nowMs: number, opts?: DashboardOpts,
): string { /* … */ }
```

The renderer takes the ALREADY-folded `DerivedState`, an injected `nowMs`, and an optional
`opts` companion — it reads NO files, no environment, no wall clock. This is what makes it
unit-testable: a fixture state + a fixed `nowMs` (+ fixed `opts.models`) produce a deterministic
HTML string the acids assert against (§6). **The `opts` companion carries the two values the
renderer cannot derive from `DerivedState` alone, BOTH injected to keep purity intact:**

- **`opts.models`** — the AUTHORED hierarchy trees (one `PlanTree` per product) the plan-tree-
  structure panel (§4 panel 6) renders. The renderer never builds them; the CLI/MCP build them
  via `buildCascadeTree(FOUNDRY_PRODUCT)` and inject them. A product with no entry falls back to
  the flat log-derived summary.
- **`opts.merges`** — the merge count for the delivery-pulse footer (§4 panel 7). When omitted,
  the renderer derives it from the items' own `merged` field (`items.filter(it => it.merged != null).length`);
  the CLI/MCP MAY pass it explicitly. Either way the renderer never touches the log.

### 2.2 The thin CLI — `src/dashboard/cli.ts` (the `dashboard` npm script)

```ts
// src/dashboard/cli.ts — the ONLY I/O boundary
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_DATA_DIR, DEFAULT_LOG, readEnvelopes } from '../log.js';
import { fold } from '../state.js';
import { buildCascadeTree } from '../plan/cascade.js';
import { FOUNDRY_PRODUCT } from '../instances/foundry-product.js';
import { renderFoundryDashboard } from './render.js';

const outPath = process.argv[2] || join(DEFAULT_DATA_DIR, 'foundry-dashboard.html');
const state = fold(readEnvelopes(DEFAULT_LOG));   // fold the LIVE canonical log
// Build foundry's AUTHORED model here (the I/O boundary) and inject it — the renderer
// stays pure. A 'foundry' / FOUNDRY_PRODUCT reference is fine in src/dashboard/ (§3).
const models = { foundry: buildCascadeTree(FOUNDRY_PRODUCT) };
const html = renderFoundryDashboard(state, Date.now(), { models });
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');             // write the self-contained page
process.stdout.write(outPath + '\n');
```

Registered as `"dashboard": "tsx src/dashboard/cli.ts"` in `package.json` (alongside the
existing `"mcp"` / `"wt-pool"` scripts). The CLI is the piece that reads the log, builds the
authored model (`buildCascadeTree(FOUNDRY_PRODUCT)`), and writes the file; it is deliberately
thin (the renderer carries all the rendering logic + its acid coverage).

### 2.3 The read-only MCP tool — `foundry_dashboard`

One additive entry in `makeTools` (`src/mcp/tools.ts:48`), the same read-only shape as
`foundry_status` (`tools.ts:49`):

```ts
foundry_dashboard: guard((a: { outPath?: string }) => {
  const state = fold(readEnvelopes(deps.logPath));
  // Inject foundry's AUTHORED model → the plan-tree panel renders its 4-level
  // hierarchy overlaid with live status. ('foundry' ref is fine in dashboard/, §3.)
  const models = { foundry: buildCascadeTree(FOUNDRY_PRODUCT) };
  const html = renderFoundryDashboard(state, Date.parse(nowIso()), { models });
  const outPath = a.outPath ?? join(deps.dataDir || DEFAULT_DATA_DIR, 'foundry-dashboard.html');
  return writeAndReturnPath(html, outPath);
}),
```

It is READ-ONLY — it emits NO events (like `foundry_status`, `foundry_next`, `foundry_gate_status`).
It folds the live log, builds + injects foundry's authored model (the same
`buildCascadeTree(FOUNDRY_PRODUCT)` the CLI uses), writes the HTML file, and returns the path. A
coordinator / the founder can invoke it to refresh the dashboard without leaving the MCP surface.

---

## 3. The agnosticism boundary — `src/dashboard/`, NOT `src/compiler/`

**This is the load-bearing architectural constraint, and a future dev WILL trip it if it is
not recorded.**

The dashboard is **FOUNDRY-STATE-SPECIFIC by design.** It reads foundry's own concepts:
`state.products`, the `FOUNDRY_PRODUCT` fixture (built into the injected model via
`buildCascadeTree(FOUNDRY_PRODUCT)`), `planFrontierAll`, foundry gates, foundry coordinators, the
`foundry:MergeRecorded.v1` event type — and the priority-anomaly heuristic keys on the head
product literally being `'foundry'` (the foundry-builds-foundry footgun: only the
self-referential product topping its OWN frontier is the anomaly; a real product legitimately
leading its first-time work is what priority is FOR — §4.1). It is, intentionally, the opposite
of agnostic — it is a view OF the foundry machine, for the foundry operator.

**A `'foundry'` / `FOUNDRY_PRODUCT` literal is FINE in `src/dashboard/`** — it is NOT
agnostic-gated. The product-literal ban applies ONLY to `src/compiler/` (the ADR-243 glob).
`src/dashboard/` is intentionally foundry-specific, so the `'foundry'` literal in the
priority-anomaly heuristic (`render.ts`) and the `FOUNDRY_PRODUCT` import in the CLI/MCP are by
design, not leaks. This is the load-bearing boundary the table below records.

`src/compiler/` is **agnostic-GATED** by [ADR-243](../../../layers/specs/adr/adr-243-scenario-lab-engine-purity.md):
the auto-discovering glob test (`test/compiler.acid.test.ts:338-393`) reads EVERY `.ts` under
`src/compiler/` and FAILS the build if any file imports `instances/` or contains a `productKey`
literal (`'foundry'`, `'whales-and-bubbles'`). The compiler must stay product-agnostic — it
compiles ANY blueprint, never foundry's specifically.

If the dashboard renderer lived under `src/compiler/`, the ADR-243 glob test would turn it RED
on the first `'foundry'` literal or `planFrontierAll` import — and rightly so. So the dashboard
lives under **`src/dashboard/`**, which is NOT in the ADR-243 glob's scope. The boundary is:

| Module | Posture | Gate |
|---|---|---|
| `src/compiler/` | AGNOSTIC — compiles any blueprint, no product literal | ADR-243 glob test (RED on any `instances/` import or productKey literal) |
| `src/dashboard/` | FOUNDRY-STATE-SPECIFIC by design — reads `products` / `FOUNDRY_PRODUCT` / `planFrontierAll` | NOT in the ADR-243 glob scope; exempt by design |

**Record for the future dev:** do NOT move `src/dashboard/` files under `src/compiler/`, and do
NOT extend the ADR-243 glob to cover `src/dashboard/`. The dashboard is intentionally foundry-
specific; that is not a violation, it is the design. ADR-261 D2 codifies this as a decision.

---

## 4. The panels (the approved layout)

Seven panels, top to bottom, deltas-first. (Panels 1–5 + 7 carried faithfully from the approved
demo; panel 6 — the plan-tree-structure panel — was added during implementation to answer the
founder's "on which level did we model foundry" question and surface the live-flat-vs-authored
gap. The demo source remains the byte-level reference for panels 1–5 + 7.)

1. **Compact header + machine-state pill + timestamp.** `FOUNDRY · mission control`, a pill
   that reads `● BUSY · N in flight` when `inFlight.length > 0` else `● IDLE`, and the ISO
   timestamp + envelope count. Machine-busy is derived: `busy = inFlight.length > 0` where
   `inFlight = allItems.filter(it => activeClaim(it, nowMs) != null)`.

2. **KPI strip (6 tiles).** `products` · `items done/total` with a `%` progress bar · `claimable`
   · `in-flight` · `pending gates` · `stale claims`. Accents go warm (amber/red/teal) only when
   the count is non-zero, so a healthy machine is visually calm. `claimable === planFrontierAll`
   (the acid-tested invariant `planFrontierAll ≡ claimableItems`, `plan-frontier-all.ts:7`).

3. **Attention row (two columns).**
   - **LEFT — "needs attention".** Pending gates (one red flag each, awaiting a founder
     decision), stale claims (one amber flag each, reclaimable, with minutes-since-last-beat),
     and the DERIVED **priority-anomaly advisory** (below). When NOTHING is flagged, it renders
     a calm `✓ all clear — machine idle, queue healthy.` — the panel must not cry wolf.
   - **RIGHT — "up next — frontier".** The top-5 of `planFrontierAll` (rank · itemId · title ·
     productKey). Empty frontier → `frontier empty — nothing queued.`

4. **Products · health at a glance.** ONE compact row per product — NOT a tree. Each row:
   `productKey`, the risk-tier badge (`p.riskTier`), the priority (`P{p.priority}`), a slim
   `done/total` progress bar + `%`, and ONLY the non-zero indicators (`N in-flight`, `N queued`).
   A 100%-done product shows a green bar + a `✓`. Products sort by `priority` then `productKey`
   (the `planFrontierAll` comparator order). **Done items contribute to the bar + counts ONLY —
   never an individual row.**

5. **Active work · what's left (the one drill-down).** For each product WITH open work
   (`queued + claimed + built > 0`), a block listing ONLY its non-done, non-retired items
   (itemId · title · a status badge). A product with no open work contributes NOTHING. When NO
   product has open work: `no open work — every queued item is done.`

6. **Plan tree · structure (the modeling-level answer).** For each product, a COMPACT view of
   its AUTHORED hierarchy — directly answering the founder's "on which level did we model this
   product". Two modes, chosen per-product by whether an authored model was injected (`opts.models[productKey]`):
   - **Modeled product → the authored tree.** Renders the injected `PlanTree` as an indented
     Product → Capability → Feature → work-item tree: capability/feature HEADERS each carry a
     rollup CHIP summarizing their descendant work-items (e.g. `8 items · 4✓ 4 queued`), each
     work-item LEAF is ONE compact line (a status-colored dot + the title + a status badge,
     colored by the live `itemStatus` of the matching `itemId`; a leaf with no live item reads a
     neutral `not yet queued`), and a structural CAPTION leads the block:
     `N levels · C capabilities / F features / W work-items · depth D` (e.g. for foundry's
     authored model, the `"4 levels · 5 cap / 8 feat / 17 wi"`-shape line). The renderer NEVER
     dumps per-leaf scope/dependsOn/yields metadata — one compact line per leaf (acid 6c).
   - **Un-modeled product → a one-line flat summary (the gap made visible).** A product WITHOUT
     an injected model falls back to a COMPACT summary, NOT a per-item list: a status mini-bar +
     a count phrase (`N work-items · all done`, or `X done / Y open`), labelled
     `(log-derived — flat until re-cutover)` on the product header. Only the OPEN
     (non-done/non-retired) items are listed as leaf lines — the done ones collapse into the
     count (the done-collapse discipline, now extended to this fallback). This is the
     live-flat-vs-authored-model gap the founder asked to see: a product still reading its flat
     log (the OWED re-cutover) is honestly flagged, not dressed up as a tree.

7. **Delivery-pulse footer.** A light one-line pulse: merge count (from `opts.merges`, else
   derived as `items.filter(it => it.merged != null).length`), `%` of all queued work done, the
   `done/total` item count, and the product count.

### 4.1 The DERIVED priority-anomaly advisory (the founder's signal)

The advisory fires when the #1 frontier item belongs to the **lowest-priority-number** product
(the most-favored) **AND that product is `'foundry'` itself** AND foundry's own frontier items
LEAD the global frontier — meaning foundry (working its own deferred/self items) would **preempt
any newly-queued product work** before the conductor ever reaches it. The `'foundry'` key is the
load-bearing discriminator: only the SELF-REFERENTIAL product (foundry building foundry) topping
its own work is the coordination smell; a REAL product legitimately leading its first-time work
is exactly what priority is FOR, not an anomaly. This is honest signal derived purely from the
data (the shipped `priorityAnomaly(state, frontier)` helper — an exported, separately-unit-tested
pure function):

```ts
export function priorityAnomaly(state: DerivedState, frontier: ItemState[]): Advisory | null {
  const head = frontier[0];
  if (head == null) return null;                              // empty frontier → no anomaly
  const headProduct = state.products.get(head.productKey);
  if (headProduct == null) return null;
  const minPriority = Math.min(...[...state.products.values()].map((p) => p.priority));
  if (headProduct.priority !== minPriority) return null;      // head is NOT the most-favored → no anomaly
  // ONLY the self-referential product (foundry building foundry) is the anomaly — a real
  // product legitimately leading its own work is the intended priority order. A 'foundry'
  // literal is fine in src/dashboard/ (NOT agnostic-gated, unlike src/compiler/ — §3).
  if (head.productKey !== 'foundry') return null;
  const ownFrontier = frontier.filter((i) => i.productKey === head.productKey);
  if (ownFrontier.length === 0) return null;
  const leadsAll = frontier
    .slice(0, ownFrontier.length)
    .every((i) => i.productKey === head.productKey);          // its items LEAD the global frontier
  if (!leadsAll) return null;
  return { product: head.productKey, priority: headProduct.priority,
           items: ownFrontier.map((i) => i.itemId.split('/').pop() ?? i.itemId) };
}
```

**Calm by construction.** It returns `null` (→ all-clear) when: the frontier is empty; the head
item is NOT the lowest-priority-number product; the head product is NOT `'foundry'` (a real
product leading is normal, not an anomaly); or foundry's items do not actually lead. The acid
battery pins both the fire AND the no-false-fire cases (§6 acid c).

---

## 5. Data sources (foundry's own derived state — all exist, file:line)

Every number on the page comes from foundry's existing derived state. Nothing new is computed
that isn't already a foundry primitive:

| Datum | Source (file:line) |
|---|---|
| `DerivedState` (the fold) | `src/state.ts:97` (`fold` at `src/state.ts:153`) |
| per-item status (`queued`/`claimed`/`built`/`done`/`retired`) | `itemStatus(it, nowMs)` — `src/state.ts:397` |
| active claim (→ in-flight, busy) | `activeClaim(it, nowMs)` — `src/state.ts:392` |
| stale claims (reclaimable) | `staleClaims(state, nowMs)` — `src/state.ts:484` |
| item done (→ collapse to bar) | `itemDone(it)` — `src/state.ts:124` |
| the global frontier (→ claimable, up-next, anomaly) | `planFrontierAll(state, nowMs)` — `src/plan/plan-frontier-all.ts:24` |
| products (key, riskTier, priority) | `state.products` — `ProductState` `src/state.ts:19` |
| items (itemId, title, productKey) | `state.items` — `ItemState` `src/state.ts:42` |
| gates (pending = `decision == null`) | `state.gates` — `GateState` `src/state.ts:60` |
| coordinators (presence, optional) | `state.coordinators` — `CoordinatorState` `src/state.ts:83` |
| merge count (pulse footer) | `opts.merges` (injected) ELSE `items.filter(it => it.merged != null).length` (derived in `render.ts`) |
| authored model tree (plan-tree panel) | `opts.models[productKey]` (injected `PlanTree`) — built by the CLI/MCP via `buildCascadeTree(FOUNDRY_PRODUCT)` (`src/plan/cascade.ts` + `src/instances/foundry-product.ts`) |
| per-leaf live status (status overlay) | `itemStatus(state.items.get(authoredItemId), nowMs)` — the authored leaf's `metadata.itemId` looked up against live items in `render.ts` |

The renderer reads `DerivedState` + `nowMs` + the `opts` companion. The merge count and the
authored model trees are the two values the fold does not expose; the CLI/MCP hand them in via
`opts` (the merge count is also derivable from each item's `merged` field, so `opts.merges` is
optional). `claimable === planFrontierAll(state, nowMs)` rests on the acid-tested invariant
`planFrontierAll ≡ claimableItems` (`plan-frontier-all.ts:7`), so the KPI's "claimable" number
is the same set the conductor would actually claim. The plan-tree panel overlays each AUTHORED
leaf with its LIVE status by matching the leaf's `metadata.itemId` against `state.items` — so the
authored structure and the live progress are reconciled at render time, never stored.

---

## 6. Acid battery — must BITE (the signal-quality guards)

Committed + deterministic in `test/dashboard.acid.test.ts`, run unconditionally in `ci:local`.
Each acid asserts a renderer property over a fixture `DerivedState` + a fixed `nowMs`. The
renderer's purity is what makes these deterministic.

**(a) KPI numbers match the fixture.** Build a fixture state with known counts (e.g. 3 products,
12 items: 7 done, 2 claimed/in-flight, 1 built, 2 queued; 1 pending gate; 1 stale claim) and a
fixed `nowMs`. Assert the rendered KPI strip carries EXACTLY those numbers (`products = 3`,
`items done/total = 7/12`, `claimable = |planFrontierAll|`, `in-flight = 2`, `pending gates = 1`,
`stale claims = 1`) and the `%` bar reads `round(7/12*100) = 58%`. **MUTATION → RED:** flip one
fixture item to `done` → `items done/total` flips to `8/12` and the assertion catches it.

**(b) DONE-COLLAPSE — the guard against regressing to endless-scroll.** Build a fixture with
MANY done items (e.g. 20 done across two products + 2 open). Assert the OVERVIEW region — the
HTML BEFORE the plan-tree-structure panel (split on the `<!-- 6. PLAN TREE` marker) — does NOT
emit one detail row per done item: no done title appears in an overview detail row, and the
overview detail-row count (matching `<li>` NOT carrying `class="tleaf"`, i.e. excluding the
structural-panel leaf rows) is bounded by `open-items + top-5-frontier + a few advisory flags`,
not by total items. **The overview-region split is load-bearing:** the structural plan-tree panel
(panel 6) DELIBERATELY surfaces every authored leaf (done included, as compact dots) to show the
hierarchy — that is NOT the rejected dump, so it is excluded from this count by the `.tleaf`
filter; the done-collapse guard applies to the OVERVIEW panels (attention / up-next / active-work)
only. **MUTATION → RED:** a regression that lists done items individually in the overview (the
rejected v0) blows the bounded row-count assertion. This is the acid that keeps the overview-first
inversion from rotting back to the dump.

**(b2) FLAT-FALLBACK done-collapse — the same guard, extended to the plan-tree panel's flat
fallback.** Build a fixture with a product that has NO authored model and MANY done items (e.g. 5
done, no model). Assert the plan-tree panel (the HTML AFTER the `<!-- 6. PLAN TREE` marker)
collapses it to a one-line summary: it contains the honest label `log-derived — flat until
re-cutover` and the all-done phrase (`5 work-items · all done`), emits NO per-done-item leaf row
(no `class="tleaf"`, no done title), and NO capability/feature header (`class="tkind"`). For a
flat product with mixed done+open (e.g. 3 done + 2 open), assert the summary reads `3 done / 2
open`, the 2 OPEN items ARE listed as leaf rows, and EXACTLY the 2 open rows appear (the 3 done
ones collapse into the count). **MUTATION → RED:** enumerating the flat product's done items as
leaf rows blows the exact open-row count and surfaces a done title in the flat block.

**(c) Priority-anomaly fires when it should + does NOT false-fire.**
- **Fires:** a fixture where `foundry` (priority 1, the lowest number) has its OWN queued items
  (`foundry/p5`, `foundry/p6`) leading the global frontier while a real product (`oncology`,
  priority 5) has freshly-queued work → assert `priorityAnomaly()` returns non-null naming
  `foundry`, and the "needs attention" panel contains the `PRIORITY` flag + the word `preempt`.
- **No false-fire (legitimate top):** a fixture where a REAL product (`oncology`, priority 1) tops
  the frontier with its own first-time work (`foundry` is priority 9, lower-favored) → assert
  `priorityAnomaly()` returns `null` (no `PRIORITY` flag). The `head.productKey !== 'foundry'`
  guard is exactly what makes a real product topping legitimate, not an anomaly.
- **No false-fire (all-clear):** all-done / empty-frontier fixture → assert `priorityAnomaly()`
  returns `null`, the panel renders `✓ all clear`, and emits NO `PRIORITY` flag. **MUTATION →
  RED:** dropping the `head.productKey !== 'foundry'` guard makes the anomaly fire on the
  legitimate real-product top → the no-false-fire assertion catches it.

**(d) "what's left" lists ONLY non-done items.** Over a mixed fixture, assert every itemId that
appears in the "active work" panel has `itemStatus !== 'done' && !== 'retired'`, and that at
least one KNOWN-done item's id is ABSENT from that panel. **MUTATION → RED:** dropping the
`itemStatus(it) !== 'done'` filter surfaces a done item → the absence assertion catches it.

**(e) HTML-escaping.** Inject a product/item title containing `<script>` / `&` / `"` / `'` into
the fixture; assert the rendered HTML contains the ESCAPED forms (`&lt;script&gt;`, `&amp;`,
`&quot;`, `&#39;`) and NOT the raw `<script>`. The renderer's `esc()` (carried from the demo,
`demo:31-37`) is the single escape point; every interpolated datum routes through it. **MUTATION
→ RED:** removing an `esc()` call on the title interpolation lets the raw `<script>` through.

**(f) Self-contained — no external resource refs.** Assert the rendered HTML contains NO
`src="http`, NO `href="http`, NO `<link rel="stylesheet"`, and NO `<script src=`; all CSS is
inline in a single `<style>` block and there is no external script. The page must load from a
`file://` URL with no network. **MUTATION → RED:** introducing an external `<link>`/`<script src>`
trips the assertion.

**(g) Determinism + purity.** `renderFoundryDashboard(state, nowMs, opts?)` called twice on the
same `(state, nowMs, opts)` → deep-equal strings; the function reads no files / env / wall clock
(a fixed `nowMs` + fixed `opts.models` are injected). This is what underwrites acids (a)–(f).

**(h) Plan-tree STRUCTURE — the authored hierarchy renders.** With an injected model (a known
4-level fixture: 2 capabilities / 3 features / 5 work-items, depth 3, built via
`buildCascadeTree(MODEL_SPEC)`), assert the panel renders the capability + feature HEADERS
(`Capability A/B`, `Feature A1/A2/B1`), every work-item LEAF as a compact line, a header rollup
CHIP (e.g. `3 items`), and the structural CAPTION counts matching the authored model
(`2 capabilities / 3 features / 5 work-items`, `4 levels`, `depth 3`). **MUTATION → RED:** a
miscount in the caption or a dropped header turns it RED.

**(i) Status OVERLAY per leaf.** Over a fixture where some authored leaves have live items
(`demo/1` done, `demo/2` queued) and one does not (`demo/5` never queued), assert: the done leaf
renders the done color (`#22c55e`) + a `done` badge, the queued leaf renders the queued color
(`#9aa4b2`) + a `queued` badge, and the UNMATCHED leaf renders a neutral `not yet queued` (no
`done` badge). **MUTATION → RED:** mislabeling the unmatched leaf or losing the status-color
lookup trips it.

**(j) Compactness preserved — no verbose metadata dump.** With an authored model whose leaves
carry `itemId` / `scope` / etc., assert the rendered leaf lines do NOT dump `dependsOn`,
`pathPrefix`, or `"yields"` — each leaf is the compact `<li class="tleaf">` shape (dot + title +
status) and nothing more. **MUTATION → RED:** a regression that serializes the leaf metadata
surfaces one of the forbidden tokens. This is the structural-panel analogue of the done-collapse
guard: the panel shows STRUCTURE compactly, it does not become a metadata dump.

---

## 7. ADR-176 inclusion test — NOT triggered

The dashboard is **pack-level rendering over foundry's DERIVED state — zero kernel change, no
new kernel shape.** Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 —
BOTH legs must hold for a thing to be kernel):

- **(a) Is "render a foundry operator dashboard" one of the four kernel concerns?** No. The four
  concerns are recurse the plan, flat the observation, inference, reproducibility
  ([ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) §1). A dashboard is
  PRESENTATION over a derived view — none of the four.
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate/query/version?**
  No. It is a single-consumer (`domains/foundry`) operator surface over foundry-specific state
  (`products`, `FOUNDRY_PRODUCT`, `planFrontierAll`). No second pack needs it, and the kernel
  must not validate/version a presentation surface.

**Both legs FAIL → pack territory.** The renderer is a pure function over `DerivedState` + the
existing `planFrontierAll` — it consumes foundry's own already-folded state and computes nothing
authoritative. **"Store generators, derive graphs" is UPHELD** ([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
§4): the dashboard is a pure VIEW — the KPIs, the bars, the anomaly advisory are all DERIVED at
render time from the log-folded state and NEVER persisted as state (the same derive-don't-store
discipline ADR-242 applies to the substance face and ADR-250 applies to the compile targets).
Charter-checker is the governance gate.

---

## 8. Evolution — explicit follow-ups (NOT v1)

Recorded as deferred so v1 stays the static overview-first page:

- **(i) Unified delivery-analytics.** Fold the SDLC twin's `snapshotToHtml` analytics panels
  (now co-located in `domains/foundry/twin` per
  [ADR-258](../../../layers/specs/adr/adr-258-foundry-absorb-devloop-twin.md)) into the
  dashboard as an additional section — cycle-time, findings, per-producer calibration — so the
  one page carries BOTH the machine-state overview AND the delivery analytics. Demand-driven; v1
  reads only foundry's own derived state.
- **(ii) Live-refresh.** A tiny local poller (a small `setInterval` re-fetch, or an SSE feed off
  the CLI) so the page auto-updates without a manual `dashboard` re-run. v1 is a static snapshot;
  this adds a thin refresh loop without changing the renderer.
- **(iii) INTERACTIVE via the P7 browser-runtime crown
  ([ADR-259](../../../layers/specs/adr/adr-259-foundry-browser-runtime-compile-target.md)).** The
  dashboard's rows become BUTTONS that fire interventions — approve a gate, claim an item,
  trigger the foundry re-cutover — reusing the P7 `materializeHtml` + `window.__fireIntervention`
  actuation wiring. The "needs attention" flag becomes an ACTIONABLE button (e.g. "approve this
  gate"). This is the natural convergence of the dashboard with the browser-runtime crown:
  static observability → live mission control. v1 is static-first; the interactive path is the
  crown follow-up.

---

## 9. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the dashboard
  reads foundry's own `DerivedState`, no new kernel shape (§7).
- **No design-system change.** The renderer emits hand-written inline-CSS HTML; it imports NO
  `@de-braighter/design-system-*` type (it is a standalone operator page, not a board-kit render
  tree). The P7 interactive evolution (§8 iii) MAY later pull in board-kit; v1 does not.
- **Not a compile target.** The dashboard is NOT a `CompileTarget` and does NOT register in
  `src/compiler/registry.ts` (ADR-250/252). It reads `DerivedState`, not a `ProductBlueprint`;
  it lives in `src/dashboard/`, not `src/compiler/` (§3).
- **`foundry_status` unchanged.** The text board stays; the dashboard is an additional visual
  surface, not a replacement. `foundry_dashboard` is one additive MCP entry alongside it.

---

## 10. Slice scope

- **foundry:** add `src/dashboard/render.ts` (the pure renderer, carried from the approved demo —
  the overview panels, the `esc()`, the exported `priorityAnomaly()` — PLUS the added plan-tree-
  structure panel: `renderModelTree` for authored products, `renderFlatFallback` for un-modeled
  ones), `src/dashboard/cli.ts` (the thin live-log → HTML CLI that injects
  `buildCascadeTree(FOUNDRY_PRODUCT)` via `opts.models`), the `"dashboard"` npm script, the
  `foundry_dashboard` read-only MCP tool (one additive entry in `src/mcp/tools.ts`, same model
  injection), and the acid battery `test/dashboard.acid.test.ts` (KPI-match · DONE-COLLAPSE
  overview + flat-fallback · anomaly fire/no-false-fire (`'foundry'`-keyed) · what's-left-non-done
  · HTML-escape · self-contained · determinism · plan-tree structure · status-overlay ·
  compactness). It reuses `buildCascadeTree` / `FOUNDRY_PRODUCT` from the existing
  `src/plan/cascade.ts` + `src/instances/foundry-product.ts` and the `PlanTree` / `PlanNode` types
  from `@de-braighter/substrate-contracts` (read-only — no kernel change). **No `@de-braighter/*`
  change.**
- **specs:** ADR-261 (proposed) — codifies (1) foundry gets a first-class observability surface
  (overview-first, pure renderer over derived state); (2) the agnosticism boundary
  (`src/dashboard/`, exempt from the ADR-243 compiler gate by design); (3) static-first with the
  P7 interactive evolution recorded as a follow-up.

This slice depends on none of P1–P9 — the dashboard is orthogonal to the compiler, the log
extensions, and the self-event-sourcing; it only READS the state those produced.
