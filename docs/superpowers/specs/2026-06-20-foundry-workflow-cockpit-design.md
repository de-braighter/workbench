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
> THE COCKPIT DRIVES THE WORKFLOW.** The observability dashboard ([ADR-261](../../../layers/specs/adr/adr-261-foundry-observability-dashboard.md)
> /[ADR-262](../../../layers/specs/adr/adr-262-foundry-dashboard-interactive-actions.md)) gains a
> WORKFLOW panel that surfaces the `FOUNDRY_WORKFLOW` pipeline with live status, and renders the
> `awaiting-founder` halt as a founder-clickable **"Authorize & advance"** button — GATED on the halt
> exactly as ADR-262's Fix-button is gated on the priority anomaly. A new `POST /api/authorize-workflow-stage`
> endpoint authorizes the gate then conducts the workflow forward (a bounded walk) until the NEXT halt or
> completion — so the founder's single confirm-gated click greenlights the gate and lets the machine RUN
> to the next decision point (build-path spawns a product along the way). It REUSES ADR-262's security
> posture verbatim (127.0.0.1-only bind, MAX_BODY cap, malformed→400, the action endpoint the only NEW
> mutation route). **Zero kernel change** — the dashboard + endpoint are pack code composing existing
> primitives (`conductWorkflowStep` / `authorizeWorkflowStage` / `workflowFrontier`); both ADR-176 legs
> fail → pack territory.

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
- **Scope (to build in `domains/foundry`, branch off HEAD `7142056` — the slice-4 conductor walk):**
  a small composition over the Slice-4 conductor + the ADR-262 served dashboard:
  - `src/dashboard/render.ts` (extend) — a new WORKFLOW panel renders the `FOUNDRY_WORKFLOW` pipeline
    stages with live status (done / awaiting-founder / ready / pending), and (only when
    `opts.interactive === true` AND a stage is `awaiting-founder`) an "Authorize & advance" button +
    a small inline `<script>` that `confirm()`s, POSTs `/api/authorize-workflow-stage`, and on success
    `location.reload()`s. The renderer stays PURE (the panel + button are opt-gated strings, no I/O) —
    the same `interactive?: boolean` gate ADR-262 D4 established. The panel reads the workflow's live
    status from `workflowFrontier(state, nowMs)` (the READY/awaiting set) + the authored
    `FOUNDRY_WORKFLOW` spec (the stage list + `founderGated`) + the folded `state.items` done-status —
    NOT from the product walks (the stages are filtered out of those by `productKey === WORKFLOW_PRODUCT_KEY`,
    `render.ts:114`/`:122`).
  - `src/dashboard/server.ts` (extend) — a SECOND mutation route `POST /api/authorize-workflow-stage`
    (body `{ stage }`) mirroring the existing `POST /api/reprioritize-product` template verbatim
    (`server.ts:58-96`): the same `readBody` MAX_BODY cap → 413, the same JSON-parse → 400 on malformed,
    the same `typeof !== 'string'` → 400 on a missing/non-string `stage`, the same try/catch → 400 on
    an op throw. It calls `authorizeWorkflowStage(deps, stage)` THEN a BOUNDED `conductWorkflowStep`
    walk (authorize-then-conduct-until-the-next-halt/idle), and returns the advanced state.
  - `src/dashboard/cli.ts` — UNCHANGED in shape; the served mode already passes `interactive: true`
    (`server.ts:53`).
  - `test/dashboard.acid.test.ts` (extend) — the acid battery (a)-(d) below, EVERY acid against a TEMP
    log (`mkdtempSync`/`tmpdir`), `now` pinned via `FoundryDeps.now`.
  - It REUSES `conductWorkflowStep` / `authorizeWorkflowStage` (`src/plan/workflow-conductor.ts`,
    Slice 4), `workflowFrontier` (`src/plan/workflow-frontier.ts`, Slice 3), `FOUNDRY_WORKFLOW` +
    `WORKFLOW_PRODUCT_KEY` (`src/instances/foundry-workflow.ts`), `fold` (`src/state.ts`), `readEnvelopes`
    (`src/log.ts`), and the EXISTING `node:http` server + `readBody` (`src/dashboard/server.ts`). The
    kernel, `@de-braighter/substrate-contracts`, the design-system, `conductWorkflowStep`'s internals,
    `planFrontierAll`, and `claimableItems` are UNTOUCHED.
- **Provenance.** Recon-confirmed against the SHIPPED foundry source (HEAD `7142056`):
  `conductWorkflowStep(deps): ConductResult` (`src/plan/workflow-conductor.ts:162-203` — returns
  `{ status: 'advanced' | 'awaiting-founder' | 'idle', stage?, frontier? }`); `authorizeWorkflowStage(deps, stageItemId)`
  (`workflow-conductor.ts:210-225` — the founder act; throws if the stage is not the ready stage or not
  founder-gated, else `markStageDone(…, 'founder')`); `workflowFrontier(state, nowMs)`
  (`src/plan/workflow-frontier.ts:93-95`); the `FOUNDRY_WORKFLOW` spec with `meta.founderGated: true` on
  `stage-gate-greenlight` (`src/instances/foundry-workflow.ts:79`) + the 5 stages
  intake/gate/build-path/conduct/ship (`:57-126`); `WORKFLOW_PRODUCT_KEY = 'foundry-workflow'`
  (`src/instances/workflow-keys.ts:11`); the PURE renderer `renderFoundryDashboard(state, nowMs, opts?)`
  with `DashboardOpts.interactive?: boolean` (`src/dashboard/render.ts:22-31`, `:100`) and the existing
  Fix-button gate-on-anomaly precedent (`render.ts:152-160` the anomaly flag + `:400-414` the
  `actionScript` rendered ONLY when `opts.interactive && anomaly != null`); the `node:http`
  127.0.0.1-only server with `HOST = '127.0.0.1'` (`src/dashboard/server.ts:15`), `MAX_BODY = 64 * 1024`
  + `readBody` → reject `payload too large` (`:16-34`), the existing `POST /api/reprioritize-product`
  route (`:58-96` — the 413/400/200 template) and the served `GET /` rendering with `interactive: true`
  (`:48-57`); the existing stage-filter-out of the product walks (`render.ts:114` + `:122`,
  `productKey !== WORKFLOW_PRODUCT_KEY`). Implementation lands on a new `domains/foundry` branch.

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
is the SAME pattern aimed at the workflow halt: a WORKFLOW panel that shows the pipeline, a button gated
on the `awaiting-founder` halt, and a scoped endpoint that authorizes-then-conducts. The founder sees the
pipeline, sees where it is halted for a decision, and authorizes-and-advances with one click — from the
cockpit.

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
WORKFLOW panel shows the pipeline (the tree, via `workflowFrontier`), the panel shows WHERE it is halted
(the conductor's `awaiting-founder` status, derived), and the button authorizes-and-advances (the
governance act, `authorizeWorkflowStage` + a bounded conduct walk) — all in the cockpit, on one
confirm-gated click. **The machine runs the automation; the founder makes the governance calls — from the
cockpit.** That sentence is the whole slice.

This is the natural twin of ADR-262: ADR-262 surfaced + fixed the priority FOOTGUN (a self-referential
scheduling smell) with a founder click; Slice 5 surfaces + advances the workflow HALT (the one intended
human checkpoint) with a founder click. Same served mode, same confirm gate, same governance invariant,
same security posture — a different scoped endpoint (`authorize-workflow-stage` not `reprioritize-product`)
and a different gating signal (the `awaiting-founder` halt not the priority anomaly).

---

## 3. The key decisions

### KD-1 — The cockpit closes the loop

The WORKFLOW panel + the authorize endpoint are where the four layers meet. The panel reads the workflow
PIPELINE from `workflowFrontier(state, nowMs)` (the ready/awaiting set, Slice 3) + the authored
`FOUNDRY_WORKFLOW` spec (the stage list, the `founderGated` flag) + the folded `state.items` done-status,
and renders each stage with a live status: `done` (folded done), `awaiting-founder` (the ready stage is
founder-gated → the conductor would halt), `ready` (the ready stage, not gated → the conductor would
advance it), or `pending` (a downstream stage whose `dependsOn` are not yet all done). When a stage is
`awaiting-founder`, the panel renders the "Authorize & advance" button. A click authorizes that gate then
conducts the workflow forward to the NEXT halt or completion. The founder sees the pipeline, sees the
halt, and advances the machine — from the cockpit. This is ADR-266 OQ-1 realized.

### KD-2 — Governance preserved (the SAME founder-click-as-authorization model)

The authorize endpoint mutates the live canonical log ONLY on the founder's confirmed click — NEVER
auto-applied by the agent. This is verbatim ADR-262 D2 + ADR-266 D2: a steering mutation (passing a
founder gate, which greenlights + lets a product spawn) is a FOUNDER-GATED decision; the founder's
`confirm()`ed click is the authorization event; the server acts only on that explicit click. The button is
GATED on a genuine `awaiting-founder` halt — exactly as the Fix-button is gated on the priority anomaly
(`render.ts:400` — `opts?.interactive && anomaly != null`); here the gate is `opts?.interactive` AND a
stage being `awaiting-founder`. Safe BY COMPOSITION: `authorizeWorkflowStage` (Slice 4,
`workflow-conductor.ts:210-225`) ALREADY rejects a stage that is not the ready workflow stage
(`/not ready for authorization/`) and one that is not founder-gated (`/not founder-gated/`), so even a
forged/stale POST cannot authorize an arbitrary or non-gated stage — the op throws and the endpoint
returns 400. The auto-mode classifier enforces the never-auto-apply rule for THIS endpoint exactly as it
does for the Fix-button: an agent never POSTs it; only the founder's keyboard does.

### KD-3 — Reuse ADR-262's security posture VERBATIM

The authorize endpoint adopts every ADR-262 D1/safety property unchanged:

- **127.0.0.1-only bind** — the server already binds `HOST = '127.0.0.1'`, never `0.0.0.0`
  (`server.ts:15`, `:108`). The new route adds no new bind; the localhost boundary IS the access control
  (a click can mutate ONLY the local log, by someone at the founder's keyboard — no auth layer needed).
- **The authorize endpoint is the only NEW mutation route** — `POST /api/authorize-workflow-stage` is
  scoped: it authorizes a named workflow stage + conducts forward, and does nothing else. There is no
  arbitrary-mutation surface, no general event-append route, no eval. (The existing
  `POST /api/reprioritize-product` is the only other mutation route; `GET /` stays read-only.)
- **MAX_BODY cap → 413** — the new route buffers through the EXISTING `readBody` (`server.ts:21-34`,
  `MAX_BODY = 64 * 1024`), so an over-cap body destroys the socket + rejects with 413 BEFORE parsing or
  mutating.
- **Malformed / missing `stage` → 400** — invalid JSON → 400 (`{ ok: false, error: 'invalid JSON body' }`);
  a missing or non-string `stage` → 400 (`{ ok: false, error: 'stage required' }`); an op throw (stage
  not ready / not founder-gated) → 400 (`{ ok: false, error }`). The same 400 ladder as
  `reprioritize-product`.
- **No GET mutation** — `GET /` renders only; authorization is POST-only.
- **The served page's workflow state == a static render of the same state (single source)** — `GET /`
  renders FRESH from the live log every request via the SAME pure `renderFoundryDashboard`
  (`server.ts:52-53`); the WORKFLOW panel is a pure projection of the same folded state, so the served
  page and a static `npm run dashboard` file of the same log show the SAME pipeline (one source of truth,
  no second cached state).

### KD-4 — The dashboard stays pack-foundry-specific OUTSIDE the compiler glob (ADR-261 / ADR-243)

`render.ts` lives in `src/dashboard/`, NOT `src/compiler/`, so it is EXEMPT from the ADR-243
compiler-agnosticism glob gate BY DESIGN (ADR-261 D2). The WORKFLOW panel is intentionally
foundry-specific — it reads `FOUNDRY_WORKFLOW`, `workflowFrontier`, `WORKFLOW_PRODUCT_KEY`, the
`stage-gate-greenlight` literal — and that is CORRECT in `src/dashboard/`, exactly as the existing
panels read `products` / `FOUNDRY_PRODUCT` / `planFrontierAll`. The compiler stays agnostic; the cockpit
is allowed to know it is foundry's cockpit. (Recorded so a future dev does not move the panel under the
gated `src/compiler/` module or extend the agnosticism glob to cover `src/dashboard/`.)

### KD-5 — ADR-176 PACK-LEVEL: pack code composing existing primitives; zero kernel change, no new event type

The dashboard panel + the endpoint are pack code composing existing primitives: `conductWorkflowStep` /
`authorizeWorkflowStage` (Slice 4 pack), `workflowFrontier` (Slice 3 pack), the `node:http` server +
`readBody` (ADR-262 pack infra), `fold` (existing). NO new kernel shape, NO new event type — the
authorization reuses Slice 4's `authorizeWorkflowStage`, which marks the gate done via the EXISTING
`claimAcquired` + `claimReleased(done)` pair. Both ADR-176 inclusion-test legs FAIL (a workflow cockpit +
an authorize-and-conduct endpoint are not one of the four kernel concerns; single consumer
`domains/foundry`) → pack territory. **Store generators, derive graphs** is upheld (ADR-176 §4) — the
workflow state lives in the log; the panel is a derived VIEW re-projected on every render; the conduct
walk's events live in the log (replay folds them, never re-runs the handler — the ADR-263 D3 invariant the
conductor already holds). This is the SAME pack-level verdict ADR-261/262/266 reached, applied once more.

---

## 4. The mechanism — the WORKFLOW panel + `POST /api/authorize-workflow-stage`

### 4.1 The WORKFLOW panel — derived stage status (no second source)

The panel derives each stage's status from three reads of the SAME folded state — never a stored
pipeline-status field:

- the authored `FOUNDRY_WORKFLOW` spec gives the ORDERED stage list + each stage's `founderGated` flag
  (the STRUCTURE-from-spec read, mirroring `stageNode` in the conductor, `workflow-conductor.ts:59-64`);
- `state.items.get(stageKey)` + `itemStatus(...)` gives each stage's folded done-status (the
  STATUS-from-log read — the stages live in `s.items` under `WORKFLOW_PRODUCT_KEY`, Slice 3);
- `workflowFrontier(state, nowMs)` gives the READY stage (the head of the workflow frontier).

The per-stage status label is then a pure function:

| Status | Condition | Source |
|---|---|---|
| `done` | the stage folded done (`itemStatus === 'done'`) | the log |
| `awaiting-founder` | the stage is the frontier HEAD AND `meta.founderGated === true` | frontier + spec |
| `ready` | the stage is the frontier head AND NOT founder-gated | frontier + spec |
| `pending` | not done, not the frontier head (its `dependsOn` are not all done yet) | derived |

This is the SAME `awaiting-founder` / `advanced` distinction the conductor draws
(`workflow-conductor.ts:191-193`) — the panel labels a stage `awaiting-founder` exactly when
`conductWorkflowStep` WOULD halt on it. The panel is a pure projection: no I/O, no clock beyond the
injected `nowMs`, the ADR-261 D1 purity preserved.

### 4.2 The button — gated on the halt, confirm-gated, POSTs the authorize endpoint

When `opts.interactive === true` AND a stage is `awaiting-founder`, the panel renders the
"Authorize & advance" button + a single inline `<script>` (rendered ONCE, only when the button is present,
mirroring the Fix-button's `actionScript` at `render.ts:400-414`):

```js
function __authorizeWorkflowStage(stage) {
  if (!confirm('Authorize "' + stage + '" and advance the workflow? '
    + 'This passes a founder gate (appending to the canonical log) and conducts the pipeline forward '
    + 'to the next halt or completion.')) return;
  fetch('/api/authorize-workflow-stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage: stage }),
  }).then(async function (res) {
    if (res.ok) { location.reload(); }            // re-render from the advanced log
    else { alert('failed: ' + await res.text()); }
  }).catch(function (e) { alert('failed: ' + e); });
}
```

When `interactive` is false/omitted (the static written-to-file path) NO button and NO `<script>` are
emitted — a static file cannot act, so the actuating button there would be a dead affordance; the static
output stays byte-stable (the ADR-262 D4 purity guard, acid (a)). When `interactive` is true but NO stage
is `awaiting-founder` (the pipeline is auto-advancing, idle, or all-done), the button is NOT rendered —
the gate-on-the-halt invariant (acid (a) bite).

### 4.3 The endpoint — authorize, then a BOUNDED conduct walk

`POST /api/authorize-workflow-stage` mirrors the `reprioritize-product` route verbatim
(`server.ts:58-96`) — the same `readBody`/413, JSON-parse/400, `typeof stage !== 'string'`/400, and
op-throw/400 ladder — and on a valid `{ stage }`:

```ts
// authorize the named founder gate, THEN conduct forward until the NEXT halt or completion (bounded).
const authorized = authorizeWorkflowStage(deps, stage);   // Slice 4 — throws if not-ready / not-gated → 400
let steps = 0;
let step = conductWorkflowStep(deps);                      // resume past the now-passed gate
while (step.status === 'advanced' && steps < MAX_CONDUCT_STEPS) {
  step = conductWorkflowStep(deps);                        // run to the next halt / idle
  steps += 1;
}
res.writeHead(200, { 'content-type': 'application/json' });
res.end(JSON.stringify({ ok: true, authorized: authorized.stage, status: step.status, stage: step.stage }));
```

The walk is BOUNDED (`MAX_CONDUCT_STEPS`, e.g. the stage count + a margin) so a misconfigured pipeline
cannot spin the request forever — defense-in-depth, like the MAX_BODY cap. It TERMINATES naturally on the
next `awaiting-founder` (a downstream founder gate, if a variant has one) or `idle` (pipeline exhausted).
Each `conductWorkflowStep` is the Slice-4 walk verbatim — it actuates `build-path` (spawning a product),
marks stages done via the direct done-pair, and is itself crash-recoverable (ADR-266 D6-D8). So the
founder's ONE click greenlights the gate and runs the machine to the next decision point, a product
SPAWNED along the way. The response reflects the advanced state (`status` + the stage acted on); on success
the page reloads and the WORKFLOW panel shows the pipeline moved forward.

### 4.4 Why authorize-THEN-conduct in one endpoint (not authorize-only)

`authorizeWorkflowStage` alone only marks the GATE done; it does not run the following stages. The founder
clicking "Authorize & advance" expects the machine to RUN — the gate was the checkpoint, and past it the
pipeline should auto-walk to the next checkpoint (build-path spawns the product, conduct + ship follow).
So the endpoint composes authorize + the bounded conduct walk — exactly what the `foundry_conduct_workflow`
MCP tool does (`{ authorizeStage }` then `conductWorkflowStep`, `tools.ts:104-110`), but walked to the
next halt rather than a single step, because the cockpit is a one-click surface, not a stepping REPL. The
walk stops at the NEXT founder gate (re-rendering the panel with a new `awaiting-founder` button) so no
downstream gate is ever auto-passed — the governance invariant holds across the whole walk.

---

## 5. Slice 5 — "the founder drives the workflow from the dashboard"

The thinnest falsifiable slice: the WORKFLOW panel shows the pipeline with live status, the
`awaiting-founder` stage carries an "Authorize & advance" button GATED on the halt, and a click
authorizes-then-conducts forward (a product spawned) to the next halt/completion — reusing ADR-262's
security posture verbatim, every test against a TEMP log.

### 5.1 Mechanism + file:line touch-points

| # | Touch-point | What |
|---|---|---|
| 1 | `src/dashboard/render.ts` (extend) | The WORKFLOW panel (the pipeline-with-status, §4.1), the gate-on-halt "Authorize & advance" button + its inline `<script>` (§4.2, mirroring the Fix-button `actionScript` at `:400-414`, gated on `opts.interactive && a stage is awaiting-founder`). The panel reads `workflowFrontier` + `FOUNDRY_WORKFLOW` + `state.items` — NOT the product walks (which filter the stages out, `:114`/`:122`). |
| 2 | `src/dashboard/server.ts` (extend) | `POST /api/authorize-workflow-stage` (§4.3) — the SECOND mutation route, mirroring `reprioritize-product` (`:58-96`) verbatim: `readBody`/413, JSON-parse/400, `stage`-missing/400, op-throw/400; on valid `{ stage }` → `authorizeWorkflowStage` + a BOUNDED `conductWorkflowStep` walk → `200 { ok, authorized, status, stage }`. |
| 3 | `test/dashboard.acid.test.ts` (extend) | The acid battery (a)-(d) below, every acid against a TEMP log; `now` pinned via `FoundryDeps.now`. |
| 4 | `src/dashboard/cli.ts`, `src/plan/workflow-conductor.ts`, `src/plan/workflow-frontier.ts`, the kernel | **UNTOUCHED** — the cockpit COMPOSES them; the conductor's internals + `planFrontierAll` + `claimableItems` are not changed (Slice-3/4 isolation preserved). |

### 5.2 The acids — each must BITE (its mutation-RED bite stated)

Committed + deterministic in `test/dashboard.acid.test.ts` (extending the ADR-261/262 battery), run
unconditionally in `ci:local`. EVERY acid runs against a TEMP log — NEVER the live one.

**(a) The render shows the WORKFLOW panel with stage statuses; the `awaiting-founder` stage carries the
Authorize button.** Bootstrap the workflow into a TEMP log + conduct to the founder gate (so
`workflowFrontier` head is `stage-gate-greenlight`, founder-gated). `render(state, nowMs, { models,
interactive: true })` CONTAINS the WORKFLOW panel with each stage's status (intake `done`, the gate
`awaiting-founder`, build-path/conduct/ship `pending`) AND the "Authorize & advance" button bound to
`stage-gate-greenlight` (the `confirm(` text + the `/api/authorize-workflow-stage` fetch path).
**BITE:** in a state where NO stage is `awaiting-founder` (e.g. before bootstrap, or after the whole
pipeline is walked + done), the interactive render contains the WORKFLOW panel BUT NO "Authorize & advance"
button + NO `/api/authorize-workflow-stage` fetch — asserting the button is GATED on the halt, exactly as
ADR-262's Fix-button is gated on the anomaly. (A mutation rendering the button unconditionally surfaces it
in the no-halt render → the absence assertion catches it.)

**(b) `POST /api/authorize-workflow-stage { stage }` on a TEMP log → authorize + conduct-walk → the gate
passes, the workflow advances through build-path (a product is SPAWNED) to the next halt/completion → the
response reflects the advanced state.** Start the server on `127.0.0.1:0` (an OS-assigned free port) with
`deps.logPath` pinned to a TEMP file, bootstrapped + conducted to the founder gate (the spawned product
does NOT yet exist). `POST /api/authorize-workflow-stage { stage: 'stage-gate-greenlight' }` →
`200 { ok: true, authorized: 'stage-gate-greenlight', status: 'idle' | 'awaiting-founder', stage }`, and
re-folding the TEMP log shows: the gate is DONE, the spawned product is REGISTERED
(`state.products.has(SPAWNED_KEY)` + a `planFrontierAll` item under `SPAWNED_KEY/`), and the workflow
frontier has advanced past build-path. **BITE:** drop the conduct-walk from the endpoint (authorize-only)
→ the gate is marked done but build-path is NEVER conducted → no product is spawned + the frontier sits at
`stage-build-path` (not advanced) → the spawned-product + advanced-frontier assertions fail → RED. A
second variant: drop the `authorize` leg (conduct-only) → `conductWorkflowStep` STILL halts at the gate
(`awaiting-founder`), nothing advances → RED.

**(c) Security (reuse ADR-262), each leg biting.** Against the served TEMP-log server:
(i) **127.0.0.1-only** — the server's URL host is `127.0.0.1`, never `0.0.0.0` (asserted on the resolved
URL, the ADR-262 acid-2 bind check). **BITE:** a `0.0.0.0` bind fails the host assertion.
(ii) **MAX_BODY → 413** — a POST body > `MAX_BODY` → `413` WITHOUT mutating (re-fold shows the gate still
NOT authorized). **BITE:** an unbounded `readBody` buffers + parses the oversized body → no 413 → RED.
(iii) **missing/malformed `stage` → 400** — `POST` with invalid JSON → `400 invalid JSON body`; `POST {}`
(no `stage`) → `400 stage required` — and the gate stays NOT authorized. **BITE:** an endpoint that
authorized on a missing `stage` (coercing `undefined`) would mutate → the not-authorized assertion fails.
(iv) **authorize of a non-`awaiting-founder` stage → REJECTED (not a silent pass)** — `POST { stage:
'stage-intake' }` (a non-gated, already-passed, or not-ready stage) → `400 { ok: false, error }` (the op
throws `/not ready for authorization/` or `/not founder-gated/`), and re-folding shows NOTHING advanced.
**BITE:** an endpoint that marked the named stage done WITHOUT routing through `authorizeWorkflowStage`'s
guards would silently pass a non-gated stage → the rejection assertion fails. (Safe by composition: the
Slice-4 guards already reject these, KD-2.)
(v) **the served workflow state == the static render (single source)** — `GET /` over the TEMP log and a
direct `render(fold(readEnvelopes(tempLog)), nowMs, { models, interactive: true })` produce the SAME
WORKFLOW-panel pipeline (same stage statuses). **BITE:** a server that read a cached/second pipeline state
instead of folding the live log per request diverges → the equality assertion fails.

**(d) The live canonical log is provably untouched by the tests (temp logs only).** Every acid pins
`deps.logPath` to a `mkdtempSync` TEMP file; the test asserts the LIVE canonical log
(`DEFAULT_LOG`)'s byte length is UNCHANGED across the whole suite (the ADR-262 acid-2 live-log-untouched
assertion, extended to the new route). **BITE:** an endpoint that wrote to `DEFAULT_LOG` instead of
`deps.logPath` blows the live-log-untouched assertion → RED.

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

- **(a) Is "a dashboard panel surfacing the workflow halt + an authorize-and-conduct endpoint" one of the
  four kernel concerns?** No. The four concerns are recurse the plan, flat the observation, inference,
  reproducibility (ADR-127 §1). A rendered panel + a localhost POST route that composes
  `authorizeWorkflowStage` + `conductWorkflowStep` are PRESENTATION + a pack endpoint over existing pack
  ops — none of the four. `founderGated` rides the `metadata` JSONB boundary (ADR-176 §3); the
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
| **5 (this) — CLOSES THE LADDER** | THE COCKPIT DRIVES THE WORKFLOW: the dashboard surfaces the pipeline + the `awaiting-founder` halt as a founder-clickable authorize button; one confirm-gated click authorizes the gate + conducts forward (a product spawned) to the next halt/completion. | A WORKFLOW panel deriving stage status from `workflowFrontier` + `FOUNDRY_WORKFLOW`; a gate-on-halt "Authorize & advance" button (reusing ADR-262's served-mode + confirm-gate verbatim); `POST /api/authorize-workflow-stage` → `authorizeWorkflowStage` + a bounded `conductWorkflowStep` walk. The dashboard, the tree, the conductor, and the founder-gated governance model all MEET. COMPOSES Slices 1-4; ZERO kernel change. |

**The workflow-as-first-class ladder (Slices 1-5) is COMPLETE.** The HOW is a first-class plan tree
(Slice 1), spawns products (Slice 2), advances itself (Slice 3), runs under a conductor that halts at the
founder gate (Slice 4), and is now DRIVEN by the founder from the cockpit (Slice 5). The founder reads the
dashboard, sees the pipeline halted for a decision, and authorizes-and-advances with one click — the
machine runs the automation, the founder makes the governance calls, from one surface.

The one named NEXT capability (a separate ladder, not a Slice-5 leg) is **T0/T2 workflow variants** — a
pipeline parameterized by `riskTier` — recorded in §5.3 + as the ADR open question so it is not lost.

---

## 8. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the cockpit composes
  the existing workflow conductor + frontier; `founderGated` rides the EXISTING `metadata` JSONB
  boundary; authorization reuses the EXISTING `claimAcquired` / `claimReleased(done)` events (no new
  event type).
- **No design-system change.** The dashboard is a self-contained HTML render in `src/dashboard/`
  (inline CSS, no external resources); the panel + button are additive strings.
- **No second mutation surface beyond the one scoped route.** `POST /api/authorize-workflow-stage` is the
  only NEW route; `GET /` stays read-only; the existing `POST /api/reprioritize-product` is unchanged.
- **The conductor + the frontier are untouched.** The cockpit COMPOSES `conductWorkflowStep` /
  `authorizeWorkflowStage` / `workflowFrontier`; their internals, `planFrontierAll`, and `claimableItems`
  are not changed — the Slice-3/4 isolation-by-non-registration is preserved (the workflow product is
  never in `s.products`, so the product-facing panels still filter the stages out, `render.ts:114`/`:122`).

---

## 9. Slice scope

- **foundry (to build, branch off HEAD `7142056`):** extend `src/dashboard/render.ts` (the WORKFLOW
  panel deriving stage status from `workflowFrontier` + `FOUNDRY_WORKFLOW` + `state.items`, and the
  gate-on-halt "Authorize & advance" button + its inline `<script>`, both gated on `opts.interactive` AND
  a stage being `awaiting-founder`), extend `src/dashboard/server.ts` (the `POST
  /api/authorize-workflow-stage` route mirroring `reprioritize-product` verbatim → `authorizeWorkflowStage`
  + a bounded `conductWorkflowStep` walk), and add the acids in `test/dashboard.acid.test.ts`
  (workflow-panel-with-statuses-and-gated-button · authorize-endpoint-conducts-to-spawn-over-TEMP-log ·
  security-127.0.0.1/MAX_BODY-413/malformed-400/non-gated-rejected/served==static · live-log-untouched).
  It REUSES `conductWorkflowStep` / `authorizeWorkflowStage` (`src/plan/workflow-conductor.ts`),
  `workflowFrontier` (`src/plan/workflow-frontier.ts`), `FOUNDRY_WORKFLOW` + `WORKFLOW_PRODUCT_KEY`
  (`src/instances/foundry-workflow.ts`), `fold` (`src/state.ts`), `readEnvelopes` (`src/log.ts`), and the
  existing `node:http` server + `readBody` (`src/dashboard/server.ts`). `planFrontierAll`,
  `claimableItems`, the conductor's internals, the kernel, and the design-system are UNTOUCHED. **No
  `@de-braighter/*` change.**
- **specs:** ADR-267 — codifies the key decisions: (KD-1) the cockpit closes the loop (the dashboard +
  the tree + the conductor + the founder-gated governance model all meet); (KD-2) governance preserved —
  the SAME founder-click-as-authorization model, the button gated on a genuine `awaiting-founder` halt,
  safe by composition (Slice 4's `authorizeWorkflowStage` rejects non-gated / not-ready stages); (KD-3)
  reuse ADR-262's security posture VERBATIM (127.0.0.1-only; the authorize endpoint the only NEW mutation
  route; MAX_BODY → 413; malformed/missing stage → 400; no GET mutation; served == static, single
  source); (KD-4) the dashboard stays pack-foundry-specific OUTSIDE the compiler glob (ADR-261/243); (KD-5)
  ADR-176 PACK-LEVEL — pack code composing existing primitives, no new kernel shape, no new event type,
  zero kernel change. Plus the deferred follow-up: T0/T2 workflow variants (parameterize the pipeline by
  risk tier) — OUT of this slice, a separate capability, recorded as an open question.

This slice depends only on the existing workflow conductor (`conductWorkflowStep` / `authorizeWorkflowStage`,
Slice 4), the existing workflow frontier (`workflowFrontier`, Slice 3), the authored `FOUNDRY_WORKFLOW`
spec (Slice 1), the existing served dashboard (`node:http` server + the pure renderer + the
`interactive?: boolean` gate, ADR-261/262), and the existing `fold`. It is the LAST rung — the founder now
drives the machine from the cockpit, and the workflow-as-first-class ladder is complete.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
