# The cockpit drives the workflow — the founder authorizes from the dashboard (Slice 5, the LAST rung)

> Slice 1 ([ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md))
> promoted the foundry WORKFLOW to a first-class plan tree (`FOUNDRY_WORKFLOW`) + the kind-keyed
> `ACTION_REGISTRY`. Slice 2 ([ADR-264](../../../layers/specs/adr/adr-264-foundry-workflow-build-path-cross-tree.md))
> added the `build-path` action — a workflow stage SPAWNS a product tree across trees. Slice 3
> ([ADR-265](../../../layers/specs/adr/adr-265-foundry-workflow-derived-advancement.md)) made the tree
> ADVANCE itself: `workflowFrontier(state, now)` derives the READY stage by REUSING `planFrontier`,
> isolated from the product conductor by NON-REGISTRATION. Slice 4
> ([ADR-266](../../../layers/specs/adr/adr-266-foundry-workflow-conductor-walk.md)) made the conductor
> WALK it: `conductWorkflowStep(deps)` pulls the ready stage, actuates its action, marks it done, and
> ADVANCES — but HALTS at the FOUNDER-GATED gate (`{ status: 'awaiting-founder', stage }`), passed only
> by an explicit founder act, `authorizeWorkflowStage(deps, stageItemId)`. **Slice 5 closes the ladder:
> THE COCKPIT DRIVES THE FULL WORKFLOW.** The observability dashboard ([ADR-261](../../../layers/specs/adr/adr-261-foundry-observability-dashboard.md)
> /[ADR-262](../../../layers/specs/adr/adr-262-foundry-dashboard-interactive-actions.md)) gains a
> WORKFLOW panel that surfaces the `FOUNDRY_WORKFLOW` pipeline with live status, and renders EXACTLY ONE
> drive affordance on the ready head: a founder-clickable **"Authorize & advance"** button when the head
> is the founder gate (`awaiting-founder`) — GATED on the halt exactly as ADR-262's Fix-button is gated
> on the priority anomaly — OR an **"Advance"** button when the head is a ready NON-gated stage (automation
> pending, e.g. intake, or a 207-stalled head) — OR NEITHER when all stages are done. TWO new routes back
> them: a **TWO-PHASE** `POST /api/authorize-workflow-stage` (phase 1 authorize → 400 on a throw; phase 2
> a bounded conduct-walk that, if it throws AFTER the gate folds done, returns **207** `{ authorized: true,
> conducted: false, status: 'stalled', advancedStages, error }` — partial-success HONESTY, never a
> misleading 400); and a **bare-conduct** `POST /api/conduct-workflow` (no authorize, the same bounded walk)
> that advances NON-gated automation and resumes a 207-stall, but HALTS at a founder gate (it NEVER passes
> a gate — only the authorize route does). So the founder drives the FULL workflow from the cockpit:
> Advance leading automation (intake → gate) → Authorize the gate (+ auto-walk past it, build-path spawns a
> product) → the next gate or completion. It REUSES ADR-262's security posture verbatim (127.0.0.1-only
> bind, MAX_BODY cap, malformed→400, POST-only mutation routes). **Zero kernel change** — the dashboard +
> endpoints are pack code composing existing primitives (`conductWorkflowStep` / `authorizeWorkflowStage` /
> `workflowFrontier`); both ADR-176 legs fail → pack territory.

- **Date:** 2026-06-20
- **Predecessors / boundary:**
  [ADR-266](../../../layers/specs/adr/adr-266-foundry-workflow-conductor-walk.md) (Slice 4 — the
  conductor + `authorizeWorkflowStage` + the founder-gated halt this slice surfaces),
  [ADR-265](../../../layers/specs/adr/adr-265-foundry-workflow-derived-advancement.md) (Slice 3 — the
  `workflowFrontier` the panel reads),
  [ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md) (Slice 1 — the
  `FOUNDRY_WORKFLOW` tree + `actuate`/`actuateNode`),
  [ADR-262](../../../layers/specs/adr/adr-262-foundry-dashboard-interactive-actions.md) (the served-mode
  + confirm-gated button + the founder-click-as-authorization governance model — the cockpit REUSES it
  verbatim),
  [ADR-261](../../../layers/specs/adr/adr-261-foundry-observability-dashboard.md) (the dashboard + the
  `src/dashboard/` agnosticism exemption — `render.ts` is OUTSIDE the ADR-243 compiler-agnosticism glob,
  so its foundry-specific WORKFLOW panel is correct there),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (the
  inclusion test — both legs fail → pack territory),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns).
- **Scope (SHIPPED in `domains/foundry`, branch `feat-workflow-cockpit` HEAD `1473c0d` — slice commit
  `2b2438e` + wave fix `9136242` + opus close-the-loop `1473c0d`):** a small composition over the Slice-4
  conductor + the ADR-262 served dashboard:
  - `src/dashboard/render.ts` (extend) — a new WORKFLOW panel renders the `FOUNDRY_WORKFLOW` pipeline
    stages with live status (done / awaiting-founder / ready / pending), and (only when
    `opts.interactive === true`) EXACTLY ONE drive affordance on the ready head: an "Authorize & advance"
    button (`authbtn`, on an `awaiting-founder` gate) → POST `/api/authorize-workflow-stage`, OR an
    "Advance" button (`advbtn`, on a ready NON-gated head) → POST `/api/conduct-workflow`, OR NEITHER (all
    done). Each is backed by a single inline `<script>` (`authorizeScript`/`advanceScript`) that
    `confirm()`s, POSTs, and on success `location.reload()`s. The whole WORKFLOW section is served-only.
    The renderer stays PURE (the panel + buttons are opt-gated strings, no I/O) — the same
    `interactive?: boolean` gate ADR-262 D4 established. The panel reads the workflow's live status from
    `workflowFrontier(state, nowMs)` (the READY/awaiting set) + the authored `FOUNDRY_WORKFLOW` spec (the
    stage list + `founderGated`) + the folded `state.items` done-status — NOT from the product walks (the
    stages are filtered out of those by `productKey !== WORKFLOW_PRODUCT_KEY`, `render.ts:157`/`:165`).
  - `src/dashboard/server.ts` (extend) — TWO new mutation routes. (1) `POST /api/authorize-workflow-stage`
    (body `{ stage }`) mirroring the existing `POST /api/reprioritize-product` security verbatim
    (`server.ts:61-99`): the same `readBody` MAX_BODY cap → 413, JSON-parse → 400 on malformed,
    missing/non-string/EMPTY `stage` → 400. It is **TWO-PHASE**: phase 1 `authorizeWorkflowStage(deps,
    stage)` (a throw → 400, nothing happened) THEN phase 2 a BOUNDED `conductWorkflowStep` walk; a phase-2
    throw AFTER the gate folds done returns **207** `{ ok: true, authorized: true, conducted: false,
    status: 'stalled', advancedStages, error }` (partial-success honesty). (2) `POST /api/conduct-workflow`
    — a bare conduct (no authorize, no body params) running the SAME bounded walk, security verbatim, that
    HALTS at a founder gate (never passes it).
  - `src/dashboard/cli.ts` — UNCHANGED in shape; the served mode already passes `interactive: true`
    (`server.ts:56`).
  - `test/dashboard-cockpit.acid.test.ts` (new) — the acid battery (a)-(g) below, EVERY acid against a
    TEMP log (`mkdtempSync`/`tmpdir`), `now` pinned via `FoundryDeps.now`.
  - It REUSES `conductWorkflowStep` / `authorizeWorkflowStage` (`src/plan/workflow-conductor.ts`,
    Slice 4), `workflowFrontier` (`src/plan/workflow-frontier.ts`, Slice 3), `FOUNDRY_WORKFLOW` +
    `WORKFLOW_PRODUCT_KEY` (`src/instances/foundry-workflow.ts`), `fold` (`src/state.ts`), `readEnvelopes`
    (`src/log.ts`), and the EXISTING `node:http` server + `readBody` (`src/dashboard/server.ts`). The
    kernel, `@de-braighter/substrate-contracts`, the design-system, `conductWorkflowStep`'s internals,
    `planFrontierAll`, and `claimableItems` are UNTOUCHED.
- **Provenance.** Reconciled to the SHIPPED foundry source (branch `feat-workflow-cockpit`, HEAD
  `1473c0d`): `conductWorkflowStep(deps): ConductResult` (`src/plan/workflow-conductor.ts` — returns
  `{ status: 'advanced' | 'awaiting-founder' | 'idle', stage?, frontier? }`; HALTS at a founder gate
  without marking it done); `authorizeWorkflowStage(deps, stageItemId)` (the founder act; throws if the
  stage is not the ready stage or not founder-gated, else marks the gate done by `'founder'`);
  `workflowFrontier(state, nowMs)` (`src/plan/workflow-frontier.ts`); the `FOUNDRY_WORKFLOW` spec with
  `meta.founderGated: true` on `stage-gate-greenlight` + the 5 stages intake/gate/build-path/conduct/ship;
  `WORKFLOW_PRODUCT_KEY = 'foundry-workflow'` (`src/instances/foundry-workflow.ts`); the PURE renderer
  `renderFoundryDashboard(state, nowMs, opts?)` with `DashboardOpts.interactive?: boolean`
  (`src/dashboard/render.ts:23-32`, `:143`) — the `workflowSection`/`workflowPanel` (served-only,
  `:254-289`), the `halt`/`advanceable` heads (`:172`/`:177`), the `authbtn`/`advbtn` buttons + the
  `authorizeScript`/`advanceScript` (`:535-572`) — and the Fix-button gate-on-anomaly precedent (`:170` the
  anomaly flag + `:512-526` the `actionScript` rendered ONLY when `opts.interactive && anomaly != null`);
  the `node:http` 127.0.0.1-only server with `HOST = '127.0.0.1'` (`src/dashboard/server.ts:18`),
  `MAX_BODY = 64 * 1024` + `readBody` → reject `payload too large` (`:19-37`), the existing
  `POST /api/reprioritize-product` route (`:61-99` — the 413/400/200 template), the new two-phase
  `POST /api/authorize-workflow-stage` (`:100-197`) and bare-conduct `POST /api/conduct-workflow`
  (`:198-254`) routes, and the served `GET /` rendering with `interactive: true` (`:51-60`); the existing
  stage-filter-out of the product walks (`render.ts:157` + `:165`, `productKey !== WORKFLOW_PRODUCT_KEY`).
  The acid battery is in `test/dashboard-cockpit.acid.test.ts`.

---

## 1. Context — slices 1-4 built the workflow + the conductor; now the founder DRIVES it from the cockpit

After Slice 4 the workflow RUNS: `conductWorkflowStep` walks `FOUNDRY_WORKFLOW`, actuates each stage's
action, marks it done, and ADVANCES — `intake → gate(HALT) → [founder authorizes] → build-path(spawn) →
conduct → ship`. The one human checkpoint is the founder-gated `stage-gate-greenlight`: the conductor
HALTS there (`{ status: 'awaiting-founder', stage }`), and the gate is passed ONLY by an explicit founder
act, `authorizeWorkflowStage(deps, 'stage-gate-greenlight')`. ADR-266 OQ-1 named exactly what is missing:
*"When the conductor returns `awaiting-founder`, the dashboard (ADR-261/262) should render the gate as a
founder-clickable AUTHORIZE button, reusing the served-mode + confirm-gated pattern but firing
`authorizeWorkflowStage` instead of `reprioritizeProduct`."* The conductor side is built; the cockpit side
is not. Today the founder authorizes the gate from a terminal (the `foundry_conduct_workflow` MCP tool's
`authorizeStage` arg) — a context-switch away from where the halt is visible.

This slice closes that gap. The dashboard already SURFACES foundry's state (ADR-261) and already MUTATES
the live log on a confirm-gated founder click (ADR-262 — the Fix-button reprioritizes a product). Slice 5
is the SAME pattern aimed at the workflow: a WORKFLOW panel that shows the pipeline, an "Authorize &
advance" button gated on the `awaiting-founder` halt, and an "Advance" button gated on a ready NON-gated
head — backed by two scoped endpoints (authorize-then-conduct, and a bare conduct). The founder drives the
FULL workflow from the cockpit: Advance leading automation (intake → the gate) → Authorize the gate (+
auto-walk) → the next halt or completion. The founder sees the pipeline, sees where it is halted for a
decision, and drives the machine with one click — from the cockpit, never dropping to MCP.

---

## 2. The loop-closing framing — the load-bearing point

**This slice closes the entire ladder: the dashboard, the workflow tree, the conductor, and the
founder-gated governance model all MEET.** That is the load-bearing point, not any one mechanism.

| Layer | Built in | What it is |
|---|---|---|
| The **cockpit** | ADR-261 / ADR-262 | The PURE dashboard renderer + the served `node:http` 127.0.0.1-only mode + the confirm-gated founder-click governance action. |
| The **workflow tree** | ADR-263 / ADR-264 / ADR-265 | `FOUNDRY_WORKFLOW` as a first-class plan tree; `build-path` spawns a product; `workflowFrontier` derives the ready stage. |
| The **conductor** | ADR-266 | `conductWorkflowStep` WALKS the tree — actuates, marks done, advances — and HALTS at the founder gate. |
| The **governance model** | ADR-262 (→ ADR-266) | A live-canonical-log mutation that steers the machine is authorized by the FOUNDER's confirmed click, never auto-applied. |

Before Slice 5 these are four surfaces a founder must stitch together by hand: read the dashboard, notice
the workflow is halted, switch to a terminal, run the MCP tool to authorize. Slice 5 fuses them: the
WORKFLOW panel shows the pipeline (the tree, via `workflowFrontier`), the panel shows WHERE it is halted or
ready (the conductor's `awaiting-founder`/`ready` status, derived), and EXACTLY ONE drive button on the
ready head drives the machine — "Authorize & advance" authorizes a gate (`authorizeWorkflowStage` + a
bounded conduct walk), "Advance" runs leading NON-gated automation up to a gate (a bare conduct that never
passes one). The founder drives the FULL workflow from the cockpit (Advance → gate → Authorize →
completion) — never dropping to MCP. **The machine runs the automation; the founder makes the governance
calls — from the cockpit.** That sentence is the whole slice.

This is the natural twin of ADR-262: ADR-262 surfaced + fixed the priority FOOTGUN (a self-referential
scheduling smell) with a founder click; Slice 5 surfaces + advances the workflow (driving NON-gated
automation, and authorizing the one intended human checkpoint) with founder clicks. Same served mode, same
confirm gate, same governance invariant, same security posture — different scoped endpoints
(`authorize-workflow-stage` / `conduct-workflow` not `reprioritize-product`) and different gating signals
(the head's `awaiting-founder`/`ready` status not the priority anomaly).

---

## 3. The key decisions

### KD-1 — The cockpit closes the loop

The WORKFLOW panel + the two endpoints are where the four layers meet. The panel reads the workflow
PIPELINE from `workflowFrontier(state, nowMs)` (the ready/awaiting set, Slice 3) + the authored
`FOUNDRY_WORKFLOW` spec (the stage list, the `founderGated` flag) + the folded `state.items` done-status,
and renders each stage with a live status: `done` (folded done), `awaiting-founder` (the ready stage is
founder-gated → the conductor would halt), `ready` (the ready stage, not gated → the conductor would
advance it), or `pending` (a downstream stage whose `dependsOn` are not yet all done). It renders EXACTLY
ONE drive button on the ready head: "Authorize & advance" when the head is `awaiting-founder` (a click
authorizes that gate then conducts the workflow forward to the NEXT halt or completion), "Advance" when the
head is a ready NON-gated stage (a click runs a BARE conduct that advances leading automation up to a gate,
and resumes a 207-stall, but never passes a gate), or NEITHER when all stages are done. The founder drives
the FULL workflow — Advance through leading automation to the gate, Authorize the gate, then the machine
runs to the next halt or completion — from the cockpit. This is ADR-266 OQ-1 realized, and the loop closed
end-to-end.

### KD-2 — Governance preserved (the SAME founder-click-as-authorization model)

Both endpoints mutate the live canonical log ONLY on the founder's confirmed click — NEVER auto-applied by
the agent. This is verbatim ADR-262 D2 + ADR-266 D2: a steering mutation (passing a founder gate, which
greenlights + lets a product spawn) is a FOUNDER-GATED decision; the founder's `confirm()`ed click is the
authorization event; the server acts only on that explicit click. The drive button is GATED on the head's
status — exactly as the Fix-button is gated on the priority anomaly (`render.ts:512` —
`opts?.interactive && anomaly != null`); here the affordance is `opts?.interactive` AND the head being
`awaiting-founder` ("Authorize & advance") or a ready NON-gated stage ("Advance"). Safe BY COMPOSITION:
`authorizeWorkflowStage` (Slice 4) ALREADY rejects a stage that is not the ready workflow stage
(`/not ready for authorization/`) and one that is not founder-gated (`/not founder-gated/`), so even a
forged/stale POST cannot authorize an arbitrary or non-gated stage — phase 1 throws and the endpoint
returns 400. **The bare-conduct route NEVER passes a founder gate**: `conductWorkflowStep` HALTS at a
founder-gated stage (returns `awaiting-founder` WITHOUT marking it done), so a bare conduct can only
advance NON-gated automation up to a gate — ONLY the authorize route passes a gate. This is the two-gate
governance invariant the wave pinned (`9136242`): an authorize click's bounded walk stops at the NEXT
founder gate, and a bare conduct halts at the FIRST, so no founder gate is ever auto-passed. The auto-mode
classifier enforces the never-auto-apply rule for these endpoints exactly as it does for the Fix-button: an
agent never POSTs them; only the founder's keyboard does.

### KD-3 — Reuse ADR-262's security posture VERBATIM

Both new endpoints adopt every ADR-262 D1/safety property unchanged:

- **127.0.0.1-only bind** — the server already binds `HOST = '127.0.0.1'`, never `0.0.0.0`
  (`server.ts:18`, `:266`). The new routes add no new bind; the localhost boundary IS the access control
  (a click can mutate ONLY the local log, by someone at the founder's keyboard — no auth layer needed).
- **Two new SCOPED mutation routes** — `POST /api/authorize-workflow-stage` authorizes a named founder gate
  + conducts forward; `POST /api/conduct-workflow` is a bare conduct (no authorize, no body params) that
  advances NON-gated automation up to a gate. Both are scoped to the workflow; nothing else. No
  arbitrary-mutation surface, no general event-append route, no eval. (The existing
  `POST /api/reprioritize-product` is the only other mutation route; `GET /` stays read-only.)
- **MAX_BODY cap → 413** — both routes buffer through the EXISTING `readBody` (`server.ts:19-37`,
  `MAX_BODY = 64 * 1024`), so an over-cap body destroys the socket + rejects with 413 BEFORE parsing or
  mutating. (The bare-conduct route still bounds the body by MAX_BODY then ignores it.)
- **Malformed / missing / empty `stage` → 400** (authorize route) — invalid JSON → 400 (`{ ok: false,
  error: 'invalid JSON body' }`); a missing, non-string, or empty `stage` → 400 (`{ ok: false, error:
  'stage required' }`); a phase-1 op throw (stage not ready / not founder-gated) → 400 (`{ ok: false,
  error }`). The same 400 ladder as `reprioritize-product`.
- **No GET mutation** — `GET /` renders only; both new routes are POST-only (`GET /api/conduct-workflow`
  → 404).
- **The served page's workflow state == a static render of the same state (single source)** — `GET /`
  renders FRESH from the live log every request via the SAME pure `renderFoundryDashboard`
  (`server.ts:55-56`); the WORKFLOW panel is a pure projection of the same folded state, so the served
  page and a static render of the same log show the SAME pipeline (one source of truth, no second cached
  state).

### KD-4 — The dashboard stays pack-foundry-specific OUTSIDE the compiler glob (ADR-261 / ADR-243)

`render.ts` lives in `src/dashboard/`, NOT `src/compiler/`, so it is EXEMPT from the ADR-243
compiler-agnosticism glob gate BY DESIGN (ADR-261 D2). The WORKFLOW panel is intentionally
foundry-specific — it reads `FOUNDRY_WORKFLOW`, `workflowFrontier`, `WORKFLOW_PRODUCT_KEY`, the
`stage-gate-greenlight` literal — and that is CORRECT in `src/dashboard/`, exactly as the existing
panels read `products` / `FOUNDRY_PRODUCT` / `planFrontierAll`. The compiler stays agnostic; the cockpit
is allowed to know it is foundry's cockpit. (Recorded so a future dev does not move the panel under the
gated `src/compiler/` module or extend the agnosticism glob to cover `src/dashboard/`.)

### KD-5 — ADR-176 PACK-LEVEL: pack code composing existing primitives; zero kernel change, no new event type

The dashboard panel + the two endpoints are pack code composing existing primitives: `conductWorkflowStep`
/ `authorizeWorkflowStage` (Slice 4 pack), `workflowFrontier` (Slice 3 pack), the `node:http` server +
`readBody` (ADR-262 pack infra), `fold` (existing). NO new kernel shape, NO new event type — the
authorization reuses Slice 4's `authorizeWorkflowStage`, which marks the gate done via the EXISTING
`claimAcquired` + `claimReleased(done)` pair. Both ADR-176 inclusion-test legs FAIL (a workflow cockpit +
an authorize-and-conduct endpoint + a bare-conduct endpoint are not one of the four kernel concerns; single
consumer `domains/foundry`) → pack territory. **Store generators, derive graphs** is upheld (ADR-176 §4) —
the workflow state lives in the log; the panel is a derived VIEW re-projected on every render; the conduct
walk's events live in the log (replay folds them, never re-runs the handler — the ADR-263 D3 invariant the
conductor already holds). This is the SAME pack-level verdict ADR-261/262/266 reached, applied once more.

---

## 4. The mechanism — the WORKFLOW panel + the two drive routes

### 4.1 The WORKFLOW panel — derived stage status (no second source)

The panel derives each stage's status from three reads of the SAME folded state — never a stored
pipeline-status field:

- the authored `FOUNDRY_WORKFLOW` spec gives the ORDERED stage list + each stage's `founderGated` flag
  (the STRUCTURE-from-spec read);
- `state.items.get(stageKey)` + `itemDone(...)` gives each stage's folded done-status (the
  STATUS-from-log read — the stages live in `s.items` under `WORKFLOW_PRODUCT_KEY`, Slice 3);
- `workflowFrontier(state, nowMs)` gives the READY stage (the head of the workflow frontier).

The per-stage status label is then a pure function (`workflowPipeline`, `render.ts:122-139`); the panel
selects the head's drive affordance from `halt` (the `awaiting-founder` stage, `render.ts:172`) and
`advanceable` (the `ready` non-gated stage, `:177`) — exactly one can be set, or neither:

| Status | Condition | Source | Drive affordance (served) |
|---|---|---|---|
| `done` | the stage folded done (`itemDone(item)`) | the log | none |
| `awaiting-founder` | the stage is the frontier HEAD AND `meta.founderGated === true` | frontier + spec | "Authorize & advance" (`authbtn`) |
| `ready` | the stage is the frontier head AND NOT founder-gated | frontier + spec | "Advance" (`advbtn`) |
| `pending` | not done, not the frontier head (its `dependsOn` are not all done yet) | derived | none |

This is the SAME `awaiting-founder` distinction the conductor draws — the panel labels a stage
`awaiting-founder` exactly when `conductWorkflowStep` WOULD halt on it. The panel is a pure projection: no
I/O, no clock beyond the injected `nowMs`, the ADR-261 D1 purity preserved. The whole WORKFLOW section is
served-only (`opts.interactive`): a static render carries neither the panel nor any button.

### 4.2 The buttons — EXACTLY ONE drive affordance on the head, confirm-gated

When `opts.interactive === true`, the panel renders EXACTLY ONE drive button on the ready head: the
"Authorize & advance" button (`authbtn`) when the head is `awaiting-founder`, the "Advance" button
(`advbtn`) when the head is a ready NON-gated stage, or NEITHER when all stages are done. Each is backed by
a single inline `<script>` (`authorizeScript`/`advanceScript`, rendered ONCE only when its button is
present, mirroring the Fix-button's `actionScript`):

```js
// "Authorize & advance" — on a founder gate. Passes the gate THEN auto-walks forward.
function __authorizeWorkflowStage(stage) {
  if (!confirm('Authorize ' + stage + '? This appends the founder authorization to the canonical '
    + 'log and advances the workflow (spawning the product).')) return;
  fetch('/api/authorize-workflow-stage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: stage }),
  }).then(async function (res) {
    if (res.ok) { location.reload(); }            // re-render from the advanced log
    else { alert('failed: ' + await res.text()); }
  }).catch(function (e) { alert('failed: ' + e); });
}

// "Advance" — on a ready NON-gated head. A BARE conduct: advances automation, never passes a gate.
function __advanceWorkflow() {
  if (!confirm('Advance the workflow? This conducts the pending automation forward '
    + '(it stops at the next founder gate; it cannot pass a gate).')) return;
  fetch('/api/conduct-workflow', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  }).then(async function (res) {
    if (res.ok) { location.reload(); }
    else { alert('failed: ' + await res.text()); }
  }).catch(function (e) { alert('failed: ' + e); });
}
```

When `interactive` is false/omitted (the static written-to-file path) NO panel, NO button, and NO
`<script>` are emitted — a static file cannot act, so an actuating button there would be a dead affordance;
the static output stays byte-stable (the ADR-262 D4 purity guard, acid (a)). When `interactive` is true but
ALL stages are done, NEITHER button is rendered — the gate-on-the-head invariant (acid (a)/(g) bite).

### 4.3 The authorize endpoint — TWO PHASES (partial-success honesty)

`POST /api/authorize-workflow-stage` (`server.ts:100-197`) mirrors the `reprioritize-product` route's
security verbatim (`server.ts:61-99`) — the same `readBody`/413, JSON-parse/400, and missing/non-string/
EMPTY `stage` → `400 stage required` ladder — and on a valid `{ stage }` runs TWO phases, so the response
is HONEST about partial success:

```ts
// PHASE 1 — the founder authorization. A throw here (non-ready / non-founder-gated stage) means
// genuinely NOTHING happened → 400.
try {
  authorizeWorkflowStage(deps, stage);                 // Slice 4 — throws if not-ready / not-gated
} catch (e) {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
  return;
}
// PHASE 2 — the BOUNDED conduct-walk (bound = the workflow's stage count) to the next
// 'awaiting-founder' or terminal 'idle'. A throw here is a PARTIAL SUCCESS: the gate PASSED (phase 1
// folded it done) but the actuation stalled.
let advancedStages = 0;
try {
  const stageCount = FOUNDRY_WORKFLOW.filter((n) => n.kind === 'stage').length;
  let step = conductWorkflowStep(deps);
  if (step.status === 'advanced') advancedStages += 1;
  for (let i = 0; i < stageCount && step.status === 'advanced'; i += 1) {
    step = conductWorkflowStep(deps);
    if (step.status === 'advanced') advancedStages += 1;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, authorized: true, conducted: true, advancedStages,
    status: step.status, stage: step.stage, frontier: (step.frontier ?? []).map((i) => i.itemId) }));
} catch (e) {
  // The gate IS authorized (folded done); the conduct-walk stalled. 207 Multi-Status: partial success,
  // so the founder re-triggers CONDUCT (Advance) — NOT a re-authorize, which would now be rejected.
  const wf = workflowFrontier(fold(readEnvelopes(deps.logPath)), Date.now());
  res.writeHead(207, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, authorized: true, conducted: false, advancedStages,
    error: `actuation stalled: ${(e as Error).message}`, status: 'stalled',
    stage: wf[0]?.itemId, frontier: wf.map((i) => i.itemId) }));
}
```

The two-phase split is the wave should-fix (`9136242`): a single try/catch over BOTH phases would return a
bare 400 even after the gate folded done — a LIE ("nothing happened"), because the gate IS advanced and a
retry authorize would be REJECTED. The split reports HONESTLY: phase 1 throw → 400 (genuinely nothing
happened); phase 2 throw → 207 `{ authorized: true, conducted: false, status: 'stalled', advancedStages }`,
so the founder knows the correct recovery is to re-trigger CONDUCT (the Advance button), not re-authorize.
The walk is BOUNDED (bound = the workflow's stage count) so a misconfigured pipeline cannot spin the
request forever, and it TERMINATES naturally on the next `awaiting-founder` (a downstream founder gate) or
`idle` (pipeline exhausted). `advancedStages` is the honest count of stages the walk DID advance (the
coarse `conducted` boolean alone would hide partial progress).

### 4.4 The bare-conduct route — `POST /api/conduct-workflow` (the close-the-loop affordance)

The cockpit could AUTHORIZE founder gates (+ auto-walk) but had no way to advance NON-gated automation —
after bootstrap the ready head is `stage-intake` (no action, not founder-gated), so the founder could not
get from intake TO the gate (where the Authorize button appears) without dropping to MCP, AND a 207-stall
could not be resumed from the cockpit. The opus close-the-loop commit (`1473c0d`) closes this with a new
bare-conduct route (`server.ts:198-254`): NO authorize, the SAME bounded conduct-walk as the authorize
endpoint's phase 2, security verbatim (127.0.0.1; MAX_BODY → 413; POST-only; no body params). It returns
the same `{ ok, conducted, advancedStages, status, stage, frontier }` shape (200 on a clean halt/idle, 207
on a stall). **GOVERNANCE INVARIANT: this route NEVER passes a founder gate** — `conductWorkflowStep` HALTS
at a founder gate (returns `awaiting-founder` WITHOUT marking it done), so only the authorize route can pass
a gate (the bare conduct's BITE: `POST /api/conduct-workflow` with the gate as the ready head → the gate
stays NOT done, the product is NOT spawned). This drives leading automation (intake → the gate) AND resumes
a 207-stall (the stalled head is a ready non-gated stage → the Advance button → re-trigger conduct), all
from the cockpit.

### 4.5 Why authorize-THEN-conduct in one endpoint (not authorize-only)

`authorizeWorkflowStage` alone only marks the GATE done; it does not run the following stages. The founder
clicking "Authorize & advance" expects the machine to RUN — the gate was the checkpoint, and past it the
pipeline should auto-walk to the next checkpoint (build-path spawns the product, conduct + ship follow).
So the authorize endpoint composes authorize + the bounded conduct walk — exactly what the
`foundry_conduct_workflow` MCP tool does (`{ authorizeStage }` then `conductWorkflowStep`), but walked to
the next halt rather than a single step, because the cockpit is a one-click surface, not a stepping REPL.
The walk stops at the NEXT founder gate (re-rendering the panel with a new `awaiting-founder` button) so no
downstream gate is ever auto-passed — the two-gate governance invariant holds across the whole walk. (The
Advance/bare-conduct route handles the OTHER direction — getting TO the gate, and resuming a stall — without
passing any gate.)

---

## 5. Slice 5 — "the founder drives the FULL workflow from the dashboard"

The thinnest falsifiable slice: the WORKFLOW panel shows the pipeline with live status, the ready head
carries EXACTLY ONE drive button (Authorize on a gate, Advance on a ready non-gated stage, neither when
done), and the founder drives the full workflow — Advance leading automation (intake → gate), Authorize the
gate (+ auto-walk, a product spawned), to completion — reusing ADR-262's security posture verbatim, every
test against a TEMP log.

### 5.1 Mechanism + file:line touch-points

| # | Touch-point | What |
|---|---|---|
| 1 | `src/dashboard/render.ts` (extend) | The WORKFLOW panel (the pipeline-with-status, §4.1), the head's drive button — "Authorize & advance" (`authbtn`) on a gate, "Advance" (`advbtn`) on a ready non-gated head — + the `authorizeScript`/`advanceScript` (§4.2, mirroring the Fix-button `actionScript`; the whole section served-only, gated on `opts.interactive` AND the head's status). The panel reads `workflowFrontier` + `FOUNDRY_WORKFLOW` + `state.items` — NOT the product walks (which filter the stages out, `:157`/`:165`). |
| 2 | `src/dashboard/server.ts` (extend) | TWO new routes. `POST /api/authorize-workflow-stage` (§4.3) — TWO-PHASE: `readBody`/413, JSON-parse/400, `stage`-missing/empty/400; phase 1 `authorizeWorkflowStage` (throw → 400) → phase 2 a BOUNDED `conductWorkflowStep` walk → `200 { ok, authorized: true, conducted: true, advancedStages, status, stage, frontier }`, or `207 { …, conducted: false, status: 'stalled', error }` on a post-gate stall. `POST /api/conduct-workflow` (§4.4) — a BARE conduct (no authorize), same bounded walk, HALTS at a founder gate. |
| 3 | `test/dashboard-cockpit.acid.test.ts` (new) | The acid battery (a)-(g) below, every acid against a TEMP log; `now` pinned via `FoundryDeps.now`. |
| 4 | `src/dashboard/cli.ts`, `src/plan/workflow-conductor.ts`, `src/plan/workflow-frontier.ts`, the kernel | **UNTOUCHED** — the cockpit COMPOSES them; the conductor's internals + `planFrontierAll` + `claimableItems` are not changed (Slice-3/4 isolation preserved). |

### 5.2 The acids — each must BITE (its mutation-RED bite stated)

Committed + deterministic in `test/dashboard-cockpit.acid.test.ts` (extending the ADR-261/262 battery), run
unconditionally in `ci:local`. EVERY acid runs against a TEMP log — NEVER the live one.

**(a) The render shows the WORKFLOW panel with stage statuses; the ready head carries the right drive
button.** Bootstrap the workflow into a TEMP log + conduct to the founder gate (so `workflowFrontier` head
is `stage-gate-greenlight`, founder-gated). `render(state, nowMs, { interactive: true })` CONTAINS the
WORKFLOW panel with each stage's status (intake `done`, the gate `awaiting-founder`, build-path/conduct/ship
`pending`) AND the "Authorize & advance" button bound to `stage-gate-greenlight`
(`__authorizeWorkflowStage('stage-gate-greenlight')` + the `/api/authorize-workflow-stage` fetch path), and
NO Advance button. At a FRESH bootstrap (intake the ready non-gated head) it instead carries the "Advance"
button (`__advanceWorkflow` + `/api/conduct-workflow`) and NO Authorize button. **BITE:** in a state where
ALL stages are done, the interactive render contains the WORKFLOW panel BUT NEITHER button — asserting each
button is GATED on the head's status, exactly as ADR-262's Fix-button is gated on the anomaly. The whole
WORKFLOW section is served-only: a static / non-interactive render carries neither the panel nor any button.

**(b) `POST /api/authorize-workflow-stage { stage }` on a TEMP log → authorize + conduct-walk → the gate
passes, the workflow advances through build-path (a product is SPAWNED) to the next halt/completion → the
response reflects the advanced state.** Start the server on `127.0.0.1:0` (an OS-assigned free port) with
`deps.logPath` pinned to a TEMP file, bootstrapped + conducted to the founder gate (the spawned product
does NOT yet exist). `POST /api/authorize-workflow-stage { stage: 'stage-gate-greenlight' }` →
`200 { ok: true, authorized: true, conducted: true, advancedStages, status: 'idle', stage, frontier }`, and
re-folding the TEMP log shows: the gate is DONE, the spawned product is REGISTERED
(`state.products.has(SPAWNED_KEY)` + a `planFrontierAll` item under `SPAWNED_KEY/`), and the workflow
frontier has advanced past build-path (exhausted to `[]` in one click). **BITE:** drop the conduct-walk from
the endpoint (authorize-only) → the gate is marked done but build-path is NEVER conducted → no product is
spawned + the frontier sits at `stage-build-path` (not advanced) → the spawned-product + advanced-frontier
assertions fail → RED. A second variant: drop the `authorize` leg (conduct-only) → `conductWorkflowStep`
STILL halts at the gate (`awaiting-founder`), nothing advances → RED.

**(c) Security (reuse ADR-262), each leg biting.** Against the served TEMP-log server (both new routes):
(i) **127.0.0.1-only** — the server's URL host is `127.0.0.1`, never `0.0.0.0` (asserted on the resolved
URL, the ADR-262 acid-2 bind check). **BITE:** a `0.0.0.0` bind fails the host assertion.
(ii) **MAX_BODY → 413** — a POST body > `MAX_BODY` → `413` (or `ECONNRESET` on the destroyed socket) WITHOUT
mutating (re-fold shows the gate still NOT authorized / the frontier unmoved). **BITE:** an unbounded
`readBody` buffers + parses the oversized body → no 413 → RED.
(iii) **missing/malformed/empty `stage` → 400** (authorize route) — `POST` with invalid JSON → `400 invalid
JSON body`; `POST {}` (no `stage`) or `POST { stage: '' }` → `400 stage required` — and the gate stays NOT
authorized. **BITE:** an endpoint that authorized on a missing `stage` (coercing `undefined`) would mutate →
the not-authorized assertion fails.
(iv) **authorize of a non-`awaiting-founder` stage → REJECTED (not a silent pass)** — `POST { stage:
'stage-intake' }` (a non-gated stage) → `400 { error: /not founder-gated/ }`; `POST { stage: 'stage-ship' }`
(not-ready) → `400 { error: /not ready for authorization/ }`, and re-folding shows NOTHING advanced.
**BITE:** an endpoint that marked the named stage done WITHOUT routing through `authorizeWorkflowStage`'s
guards would silently pass a non-gated stage → the rejection assertion fails. (Safe by composition: the
Slice-4 guards already reject these, KD-2.)
(v) **No GET mutation** — `GET /api/conduct-workflow` → 404; an unknown route → 404.
(vi) **the served workflow panel == the static render (single source)** — `GET /` over the TEMP log and a
direct `render(fold(readEnvelopes(tempLog)), nowMs, { interactive: true })` produce the SAME WORKFLOW-panel
pipeline (the `<!-- WF -->…<!-- /WF -->` section, same stage statuses + the same halt). **BITE:** a server
that read a cached/second pipeline state instead of folding the live log per request diverges → the
equality assertion fails.

**(d) The live canonical log is provably untouched by the tests (temp logs only).** Every acid pins
`deps.logPath` to a `mkdtempSync` TEMP file; the test asserts the LIVE canonical log (`DEFAULT_LOG`) is
byte-identical (existence + size) across a successful authorize. **BITE:** an endpoint that wrote to
`DEFAULT_LOG` instead of `deps.logPath` blows the live-log-untouched assertion → RED.

**(e) Partial-success honesty — a post-gate stall returns 207, NOT a misleading 400.** Seed a DIVERGENT
`sample-path` product so build-path re-actuation throws `does not exactly replay`. `POST
/api/authorize-workflow-stage { stage: 'stage-gate-greenlight' }` → `207 { ok: true, authorized: true,
conducted: false, status: 'stalled', advancedStages, error: /actuation stalled/ }`; the gate IS folded done
(phase 1 ran), and a RETRY authorize → `400 /not ready for authorization/` (so conduct, not re-authorize, is
the recovery). **BITE:** collapse the endpoint back to a single try/catch over both phases → it returns a
bare 400 while the gate is already done (the lie this fix removes) → the 207/authorized assertions go RED.

**(f) The two-gate governance invariant — one click cannot auto-pass a SECOND founder gate.** With a
fixture marking `stage-build-path` ALSO founder-gated, `POST /api/authorize-workflow-stage { stage:
'stage-gate-greenlight' }` → `200 { status: 'awaiting-founder', stage: 'stage-build-path' }`: gate 1 done,
the walk HALTED at gate 2, gate 2 NOT done. **BITE:** remove the conductor's founder-gate halt → the walk
runs through gate 2 to `idle` → the `awaiting-founder` assertion goes RED.

**(g) The Advance / bare-conduct route + the FULL drive-from-start loop.** `POST /api/conduct-workflow` at
fresh bootstrap → `200 { ok: true, conducted: true, advancedStages: 1, status: 'awaiting-founder', stage:
'stage-gate-greenlight', frontier: ['stage-gate-greenlight'] }` — intake advanced, then HALTED at the gate
(NOT done). The headline end-to-end: bootstrap → render (Advance only) → POST conduct (intake → gate) →
render (Authorize only) → POST authorize (gate + build-path SPAWNS a product → idle) → render (neither).
**GOVERNANCE BITE:** `POST /api/conduct-workflow` when the ready head IS the founder gate → `200 { status:
'awaiting-founder', advancedStages: 0 }`, the gate NOT done, the product NOT spawned — a bare conduct can
NEVER pass a founder gate. **RESUME:** after a 207-stall the head is a ready non-gated stage → the Advance
button is present → `POST /api/conduct-workflow` re-triggers conduct (still 207 on the persisting
divergence, correctly reported) — the founder resumes a stall from the cockpit, no MCP.

These extend ADR-261's battery (KPI-match, done-collapse, anomaly fire/no-false-fire, what's-left,
HTML-escape, self-contained, determinism, plan-tree structure) + ADR-262's (op-changes-priority,
served-endpoint-over-TEMP-log, button-only-when-interactive, advisory-clears), which continue to bite over
the static + reprioritize paths.

### 5.3 What Slice 5 deliberately does NOT do (the deferred follow-up)

- **T0/T2 workflow variants — OUT of this slice (a SEPARATE "parameterize the pipeline" capability).**
  A lighter T0 pipeline (fewer stages / no gate) and a heavier T2 pipeline (extra review/clinical gates)
  per `riskTier` is a real next capability — ADR-263 OQ-3 / ADR-265 OQ-3 / ADR-266 OQ-2 all name it. It
  is a sibling `FOUNDRY_WORKFLOW` keyed under its own `WORKFLOW_PRODUCT_KEY` that `conductWorkflowStep`
  walks the SAME way, with the panel + endpoint selecting the variant off `riskTier` or an explicit
  selector. **It is explicitly NOT part of Slice 5** — this slice surfaces + drives the SINGLE
  `FOUNDRY_WORKFLOW`. Recorded here so the variant work is not lost: it lands as its own slice ("the
  pipeline is parameterized by risk tier"), with its own ADR, after the single-pipeline cockpit ships.
- It does NOT add a new event type — authorization reuses Slice 4's `authorizeWorkflowStage` (the existing
  `claimAcquired` + `claimReleased(done)` pair).
- It does NOT change the conductor, `workflowFrontier`, `planFrontierAll`, or `claimableItems` — the
  cockpit COMPOSES them (the Slice-3/4 isolation-by-non-registration is preserved).
- It does NOT add a live-refresh poller (the ADR-262 deferred follow-up) — the click `location.reload()`s,
  same as the Fix-button.

---

## 6. ADR-176 inclusion test — NOT triggered (pack-level)

Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 — BOTH
legs must hold for a thing to be kernel):

- **(a) Is "a dashboard panel surfacing the workflow halt + an authorize-and-conduct endpoint + a
  bare-conduct endpoint" one of the four kernel concerns?** No. The four concerns are recurse the plan, flat
  the observation, inference, reproducibility (ADR-127 §1). A rendered panel + localhost POST routes that
  compose `authorizeWorkflowStage` + `conductWorkflowStep` are PRESENTATION + pack endpoints over existing
  pack ops — none of the four. `founderGated` rides the `metadata` JSONB boundary (ADR-176 §3); the
  authorization reuses the existing `claimAcquired`/`claimReleased(done)` pair (no new event type).
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate / query / version?**
  No. Single consumer (`domains/foundry`), over foundry's own pipeline + cockpit. No second pack needs the
  foundry workflow cockpit; the kernel must not validate/version it.

**Both legs FAIL → pack territory.** **"Store generators, derive graphs" is UPHELD** (ADR-176 §4): the
workflow state + the conduct-walk's events live in the log (the generators); the panel is a derived VIEW
re-projected on every render; the walk is reconstructable from the log (replay folds the events, never
re-runs the handler). **Zero kernel change; zero design-system change.**

**External positioning — N/A.** Internal-only. An internal operator cockpit over the foundry machine,
built not marketed (the north-star Option A framing).

---

## 7. The ladder — Slice 5 closes it

| Slice | What | Mechanism |
|---|---|---|
| **1 (shipped)** | A workflow intervention actuates a real action. | `FOUNDRY_WORKFLOW` tree + `actuate`/`actuateNode` + the `ACTION_REGISTRY`. |
| **2 (shipped)** | A workflow intervention SPAWNS a product tree across trees. | `build-path` handler reusing the ADR-249 generate path; cross-link a DERIVED `PlanNodeId` reference. |
| **3 (shipped)** | The workflow tree ADVANCES itself by derivation. | Stages gain `dependsOn`; `workflowFrontier = planFrontier(workflowTree(), …)` (ONE encoding); advancing is re-derivation poked by scheduled-wake. Isolated by NON-REGISTRATION. |
| **4 (shipped)** | The conductor WALKS the workflow tree; the workflow RUNS, halts at founder gates, crash-recoverable. | `conductWorkflowStep` pulls `workflowFrontier`, `actuateNode`s the ready stage, marks done via a direct done-pair, HALTS at founder-gated stages; `authorizeWorkflowStage` is the founder act. |
| **5 (this) — CLOSES THE LADDER** | THE COCKPIT DRIVES THE FULL WORKFLOW: the dashboard surfaces the pipeline + EXACTLY ONE drive button on the ready head (Authorize on a gate, Advance on a ready non-gated stage, neither when done); the founder Advances leading automation (intake → gate) then Authorizes the gate (+ auto-walk, a product spawned) to completion. | A WORKFLOW panel deriving stage status from `workflowFrontier` + `FOUNDRY_WORKFLOW`; the `authbtn`/`advbtn` head buttons (reusing ADR-262's served-mode + confirm-gate verbatim); a TWO-PHASE `POST /api/authorize-workflow-stage` (207 on a post-gate stall) → `authorizeWorkflowStage` + a bounded `conductWorkflowStep` walk; a bare-conduct `POST /api/conduct-workflow` (never passes a gate). The dashboard, the tree, the conductor, and the founder-gated governance model all MEET. COMPOSES Slices 1-4; ZERO kernel change. |

**The workflow-as-first-class ladder (Slices 1-5) is COMPLETE.** The HOW is a first-class plan tree
(Slice 1), spawns products (Slice 2), advances itself (Slice 3), runs under a conductor that halts at the
founder gate (Slice 4), and is now DRIVEN end-to-end by the founder from the cockpit (Slice 5). The founder
reads the dashboard, Advances leading automation to the gate, Authorizes the gate, and the machine runs to
completion — a product spawned along the way — all from one surface: the machine runs the automation, the
founder makes the governance calls. (opus proved the loop end-to-end: dashboard → Advance → Authorize →
build-path spawns a product → the dashboard reflects the advanced state.)

The one named NEXT capability (a separate ladder, not a Slice-5 leg) is **T0/T2 workflow variants** — a
pipeline parameterized by `riskTier` — recorded in §5.3 + as the ADR open question so it is not lost.

---

## 8. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the cockpit composes
  the existing workflow conductor + frontier; `founderGated` rides the EXISTING `metadata` JSONB
  boundary; authorization reuses the EXISTING `claimAcquired` / `claimReleased(done)` events (no new
  event type).
- **No design-system change.** The dashboard is a self-contained HTML render in `src/dashboard/`
  (inline CSS, no external resources); the panel + buttons are additive strings.
- **No mutation surface beyond the two scoped routes.** `POST /api/authorize-workflow-stage` (two-phase)
  and `POST /api/conduct-workflow` (bare conduct) are the only NEW routes; `GET /` stays read-only; the
  existing `POST /api/reprioritize-product` is unchanged.
- **The conductor + the frontier are untouched.** The cockpit COMPOSES `conductWorkflowStep` /
  `authorizeWorkflowStage` / `workflowFrontier`; their internals, `planFrontierAll`, and `claimableItems`
  are not changed — the Slice-3/4 isolation-by-non-registration is preserved (the workflow product is
  never in `s.products`, so the product-facing panels still filter the stages out, `render.ts:157`/`:165`).

---

## 9. Slice scope

- **foundry (SHIPPED, branch `feat-workflow-cockpit` HEAD `1473c0d`):** extended `src/dashboard/render.ts`
  (the WORKFLOW panel deriving stage status from `workflowFrontier` + `FOUNDRY_WORKFLOW` + `state.items`,
  and EXACTLY ONE head drive button — the "Authorize & advance" `authbtn` on a gate, the "Advance" `advbtn`
  on a ready non-gated head — + the `authorizeScript`/`advanceScript`, all served-only and gated on
  `opts.interactive` AND the head's status), extended `src/dashboard/server.ts` (the TWO-PHASE `POST
  /api/authorize-workflow-stage` route mirroring `reprioritize-product`'s security verbatim →
  `authorizeWorkflowStage` + a bounded `conductWorkflowStep` walk, 207 on a post-gate stall; and the
  bare-conduct `POST /api/conduct-workflow` route that never passes a gate), and added the acids in
  `test/dashboard-cockpit.acid.test.ts` (workflow-panel-with-statuses-and-gated-buttons ·
  authorize-endpoint-conducts-to-spawn-over-TEMP-log ·
  security-127.0.0.1/MAX_BODY-413/malformed-400/non-gated-rejected/no-GET-mutation/served==static ·
  live-log-untouched · 207-partial-success-honesty · two-gate-governance · Advance/bare-conduct +
  drive-from-start). It REUSES `conductWorkflowStep` / `authorizeWorkflowStage`
  (`src/plan/workflow-conductor.ts`), `workflowFrontier` (`src/plan/workflow-frontier.ts`),
  `FOUNDRY_WORKFLOW` + `WORKFLOW_PRODUCT_KEY` (`src/instances/foundry-workflow.ts`), `fold` (`src/state.ts`),
  `readEnvelopes` (`src/log.ts`), and the existing `node:http` server + `readBody`
  (`src/dashboard/server.ts`). `planFrontierAll`, `claimableItems`, the conductor's internals, the kernel,
  and the design-system are UNTOUCHED. **No `@de-braighter/*` change.**
- **specs:** ADR-267 (ratified) — codifies the key decisions: (KD-1) the cockpit closes the loop end-to-end
  (the dashboard + the tree + the conductor + the founder-gated governance model all meet; the founder
  drives the FULL workflow); (KD-2) governance preserved — the SAME founder-click-as-authorization model,
  the head's drive button gated on its status, safe by composition (Slice 4's `authorizeWorkflowStage`
  rejects non-gated / not-ready stages), and the bare-conduct route NEVER passes a founder gate; (KD-3)
  reuse ADR-262's security posture VERBATIM (127.0.0.1-only; two new scoped POST routes; MAX_BODY → 413;
  malformed/missing/empty stage → 400; no GET mutation; served == static, single source); (KD-4) the
  dashboard stays pack-foundry-specific OUTSIDE the compiler glob (ADR-261/243); (KD-5) ADR-176 PACK-LEVEL
  — pack code composing existing primitives, no new kernel shape, no new event type, zero kernel change.
  The two-phase authorize route reports partial success HONESTLY (207). Plus the deferred follow-up: T0/T2
  workflow variants (parameterize the pipeline by risk tier) — OUT of this slice, a separate capability,
  recorded as an open question.

This slice depends only on the existing workflow conductor (`conductWorkflowStep` / `authorizeWorkflowStage`,
Slice 4), the existing workflow frontier (`workflowFrontier`, Slice 3), the authored `FOUNDRY_WORKFLOW`
spec (Slice 1), the existing served dashboard (`node:http` server + the pure renderer + the
`interactive?: boolean` gate, ADR-261/262), and the existing `fold`. It is the LAST rung — the founder now
drives the FULL machine from the cockpit (Advance → Authorize → completion), and the workflow-as-first-class
ladder is complete.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
