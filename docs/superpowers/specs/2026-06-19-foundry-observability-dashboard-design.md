# Foundry observability dashboard — a "mission-control" overview of the machine

> A self-contained HTML page that answers, in ONE glance: **is the machine healthy?
> what needs me? what's next?** OVERVIEW-FIRST — it leads with deltas + decisions and
> collapses inventory (done items) into progress bars; it NEVER dumps every product's
> full plan tree. A PURE renderer over foundry's OWN derived state (`fold` → `DerivedState`
> + `planFrontierAll`), a thin CLI that writes the file, and a read-only MCP tool.
> **Zero kernel change** — pack-level rendering over a derived view ("store generators,
> derive graphs" upheld; ADR-176 NOT triggered).

- **Date:** 2026-06-19
- **Scope:** `domains/foundry` — a NEW `src/dashboard/` module:
  `src/dashboard/render-foundry-dashboard.ts` (new — the pure renderer
  `renderFoundryDashboard(state, nowMs): string`), `src/dashboard/cli.ts` (new — the thin
  `dashboard` CLI that folds the live log + writes the HTML), the `foundry_dashboard`
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

### 2.1 The pure renderer — `renderFoundryDashboard(state, nowMs): string`

```ts
// src/dashboard/render-foundry-dashboard.ts
import {
  itemStatus, activeClaim, staleClaims,
  type DerivedState, type ItemState, type ItemStatus,
} from '../state.js';
import { planFrontierAll } from '../plan/plan-frontier-all.js';

/** PURE: no I/O, no clock read (nowMs is injected), no log access. Returns a
 *  self-contained HTML string (inline CSS, no external resources). Unit-testable. */
export function renderFoundryDashboard(state: DerivedState, nowMs: number): string { /* … */ }
```

The renderer takes the ALREADY-folded `DerivedState` plus an injected `nowMs` — it reads NO
files, no environment, no wall clock. This is what makes it unit-testable: a fixture state +
a fixed `nowMs` produce a deterministic HTML string the acids assert against (§6). The merge
count for the delivery-pulse footer (§4 panel 6) is the one log-derived number the renderer
needs; the CLI passes it in alongside the state (a small `{ merges: number }` companion, or
the renderer accepts the raw envelope count — see §5). The renderer itself never touches the
log.

### 2.2 The thin CLI — `src/dashboard/cli.ts` (the `dashboard` npm script)

```ts
// src/dashboard/cli.ts — the ONLY I/O boundary
import { writeFileSync } from 'node:fs';
import { readEnvelopes, DEFAULT_LOG } from '../log.js';
import { fold } from '../state.js';
import { renderFoundryDashboard } from './render-foundry-dashboard.js';

const events = readEnvelopes(DEFAULT_LOG);     // fold the LIVE canonical log
const state = fold(events);
const html = renderFoundryDashboard(state, Date.now());
writeFileSync(OUT_HTML, html, 'utf8');         // write the self-contained page
```

Registered as `"dashboard": "tsx src/dashboard/cli.ts"` in `package.json` (alongside the
existing `"mcp"` / `"wt-pool"` scripts). The CLI is the ONLY piece that reads the log + writes
a file; it is deliberately too thin to need its own unit test (the renderer carries the logic).

### 2.3 The read-only MCP tool — `foundry_dashboard`

One additive entry in `makeTools` (`src/mcp/tools.ts:48`), the same read-only shape as
`foundry_status` (`tools.ts:49`):

```ts
foundry_dashboard: guard((a: { write?: boolean; outPath?: string }) => {
  const state = fold(readEnvelopes(deps.logPath));
  const html = renderFoundryDashboard(state, Date.parse(nowIso()));
  // write the HTML + return the path (default), or return the HTML directly.
  return a.write === false ? html : writeAndReturnPath(html, a.outPath);
}),
```

It is READ-ONLY — it emits NO events (like `foundry_status`, `foundry_next`, `foundry_gate_status`).
It either writes the HTML file and returns the path, or returns the HTML string directly. A
coordinator / the founder can invoke it to refresh the dashboard without leaving the MCP surface.

---

## 3. The agnosticism boundary — `src/dashboard/`, NOT `src/compiler/`

**This is the load-bearing architectural constraint, and a future dev WILL trip it if it is
not recorded.**

The dashboard is **FOUNDRY-STATE-SPECIFIC by design.** It reads foundry's own concepts:
`state.products`, the `FOUNDRY_PRODUCT` fixture, `planFrontierAll`, foundry gates, foundry
coordinators, the `foundry:MergeRecorded.v1` event type. It is, intentionally, the opposite of
agnostic — it is a view OF the foundry machine, for the foundry operator.

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

Six panels, top to bottom, deltas-first. (All carried faithfully from the approved demo; the
demo source is the byte-level reference for the HTML/CSS.)

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

6. **Delivery-pulse footer.** A light one-line pulse from the foundry log alone: merge count
   (`events.filter(e => e.eventType === 'foundry:MergeRecorded.v1').length`), `%` of all queued
   work done, the `done/total` item count, and the product count.

### 4.1 The DERIVED priority-anomaly advisory (the founder's signal)

The advisory fires when the #1 frontier item belongs to the **lowest-priority-number** product
(the most-favored), AND that product's own frontier items LEAD the global frontier — meaning
that product (working its own deferred/self items) would **preempt any newly-queued product
work** before the conductor ever reaches it. This is honest signal derived purely from the data
(carried verbatim from the approved demo, `priorityAnomaly()`):

```ts
function priorityAnomaly(): { product: string; priority: number; items: string[] } | null {
  const head = frontier[0];
  if (head == null) return null;                              // empty frontier → no anomaly
  const headProduct = state.products.get(head.productKey);
  if (headProduct == null) return null;
  const minPriority = Math.min(...products.map((p) => p.priority));
  if (headProduct.priority !== minPriority) return null;      // head is NOT the most-favored → no anomaly
  const ownFrontier = frontier.filter((i) => i.productKey === head.productKey);
  const leadsAll = frontier
    .slice(0, ownFrontier.length)
    .every((i) => i.productKey === head.productKey);          // its items LEAD the global frontier
  if (!leadsAll || ownFrontier.length === 0) return null;
  return { product: head.productKey, priority: headProduct.priority,
           items: ownFrontier.map((i) => i.itemId.split('/').pop() ?? i.itemId) };
}
```

**Calm by construction.** It returns `null` (→ all-clear) when: the frontier is empty; the head
item is NOT the lowest-priority-number product (a legitimately-top product is normal, not an
anomaly); or the favored product's items do not actually lead. The acid battery pins both the
fire AND the no-false-fire cases (§6 acid c).

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
| merge count (pulse footer) | `events.filter(e => e.eventType === 'foundry:MergeRecorded.v1')` — `MERGE_RECORDED` `src/events.ts:30` |

The renderer reads `DerivedState` + `nowMs`; the CLI/MCP additionally hand it the envelope
list (or just the merge count) for the pulse footer — the single number the fold does not
already expose. `claimable === planFrontierAll(state, nowMs)` rests on the acid-tested invariant
`planFrontierAll ≡ claimableItems` (`plan-frontier-all.ts:7`), so the KPI's "claimable" number
is the same set the conductor would actually claim.

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
MANY done items (e.g. 50 items, 48 done across several products). Assert the renderer does NOT
emit one detail row per done item — concretely: count the "active work · what's left" item rows
(e.g. `<li>` under `ul.awlist`) and assert it equals the number of NON-done, non-retired items
(here 2), NOT the total (50). Equivalently, assert the rendered HTML length / row-count is
bounded by `open-items + top-5-frontier + products`, not by total items, and that a done item's
`itemId` does NOT appear as an `awlist` detail row. **MUTATION → RED:** a regression that lists
done items individually (the rejected v0) blows the row-count assertion past the open-item count.
This is the acid that keeps the overview-first inversion from rotting back to the dump.

**(c) Priority-anomaly fires when it should + does NOT false-fire.**
- **Fires:** a fixture where product `A` (priority 1, the lowest number) has its own deferred
  items leading the global frontier while product `B` (priority 5) has freshly-queued work →
  assert the "needs attention" panel contains the `PRIORITY` flag naming `A` and its leading
  items.
- **No false-fire (legitimate top):** a fixture where the favored product's top item is normal
  forward work (it does not lead the whole frontier, or a higher-priority product's item heads
  it) → assert NO `PRIORITY` flag.
- **No false-fire (all-clear):** all-done fixture AND empty-frontier fixture → assert the panel
  renders `✓ all clear` and emits NO `PRIORITY` flag. **MUTATION → RED:** inverting the
  `headProduct.priority !== minPriority` guard makes the anomaly fire on a legitimate top product
  → the no-false-fire assertion catches it.

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

**(g) Determinism + purity.** `renderFoundryDashboard(state, nowMs)` called twice on the same
`(state, nowMs)` → deep-equal strings; the function reads no files / env / wall clock (a fixed
`nowMs` is injected). This is what underwrites acids (a)–(f).

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

- **foundry:** add `src/dashboard/render-foundry-dashboard.ts` (the pure renderer, carried from
  the approved demo — the panels, the `esc()`, the `priorityAnomaly()`), `src/dashboard/cli.ts`
  (the thin live-log → HTML CLI), the `"dashboard"` npm script, the `foundry_dashboard`
  read-only MCP tool (one additive entry in `src/mcp/tools.ts`), and the acid battery
  `test/dashboard.acid.test.ts` (KPI-match + DONE-COLLAPSE + anomaly fire/no-false-fire +
  what's-left-non-done + HTML-escape + self-contained + determinism). **No `@de-braighter/*`
  change.**
- **specs:** ADR-261 (proposed) — codifies (1) foundry gets a first-class observability surface
  (overview-first, pure renderer over derived state); (2) the agnosticism boundary
  (`src/dashboard/`, exempt from the ADR-243 compiler gate by design); (3) static-first with the
  P7 interactive evolution recorded as a follow-up.

This slice depends on none of P1–P9 — the dashboard is orthogonal to the compiler, the log
extensions, and the self-event-sourcing; it only READS the state those produced.
