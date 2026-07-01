---
artifact_id: foundry-dashboard-interactive-actions-design
artifact_kind: design-note
artifact_level: technical
status: proposed
authority: local-decision
owner_role: technical-architect
---

# Foundry dashboard interactive actions — the founder's click fixes the footgun

> The interactive-cockpit follow-up to the observability dashboard (ADR-261). The static
> mission-control page becomes a SERVED mode: the "needs attention" priority-anomaly advisory
> carries a BUTTON that FIXES the footgun — it re-registers foundry at a low priority so its
> deferred `p5–p8` no longer preempt real product work. The fix is a LIVE-CANONICAL-LOG
> MUTATION (the founder-gated decision deferred throughout the foundry grind), and this resolves
> the gate the RIGHT way: **THE FOUNDER DECIDES BY CLICKING.** The server performs the action
> only on an explicit click (behind a `confirm()`); it never auto-applies. The corrective fix
> rides the EXISTING `ProductRegistered` event through the EXISTING last-write-wins fold
> (`state.ts:172`) and the EXISTING store-locked append pattern (`recordMerge`, `ops.ts:290`),
> bound to `127.0.0.1` (localhost-only is the security boundary). The pure renderer gains an
> `interactive` flag so the button renders ONLY when served — the static file output is byte-
> unchanged. **Zero kernel change** — `ProductRegistered` is an existing pack event, `node:http`
> is pack infra, the op is a pack op over a derived view (ADR-176 NOT triggered).

- **Date:** 2026-06-19
- **Scope:** `domains/foundry` — extends the `src/dashboard/` module (ADR-261):
  `src/dashboard/render.ts` (the pure renderer — `DashboardOpts` gains `interactive?: boolean`;
  when interactive AND a priority anomaly exists, the advisory flag carries a "Fix" button + a
  small inline `<script>`), `src/dashboard/server.ts` (new — a `node:http` server bound to
  `127.0.0.1`: `GET /` serves the dashboard rendered fresh with `interactive: true`,
  `POST /api/reprioritize-product` applies the op), `src/dashboard/cli.ts` (extended — a
  `--serve [port]` mode that starts the server; the write-to-file mode stays the default),
  `src/ops.ts` (the new `reprioritizeProduct(deps, { productKey, priority })` op), the
  `foundry_reprioritize` WRITE MCP tool in `src/mcp/tools.ts` + `src/mcp/server.ts` (one additive
  entry each), and `test/dashboard.acid.test.ts` (new acids — the op, the served endpoint, the
  interactive-flag gate, and the advisory-clears acid). `layers/specs` (ADR-262, status proposed).
  **No `@de-braighter/substrate-*` change. No `@de-braighter/design-system-*` change.**
- **Predecessors / boundary:**
  [ADR-261](../../../layers/specs/adr/adr-261-foundry-observability-dashboard.md) (the dashboard —
  this delivers its recorded interactive follow-up, §8 iii),
  [ADR-259](../../../layers/specs/adr/adr-259-foundry-browser-runtime-compile-target.md) (the P7
  crown — the "button = action / intervention" vision; this realizes it for a real GOVERNANCE
  action),
  [ADR-254](../../../layers/specs/adr/adr-254-foundry-self-event-sourcing.md) (foundry
  self-event-sourcing — the priority footgun originated in the P3 cutover, when foundry's own
  deferred `p5–p8` entered the live log and began topping the global frontier),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (the
  inclusion test — §6),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns).
- **Provenance.** The design is converged + recon-confirmed against the live foundry source: the
  last-write-wins fold (`state.ts:170-180` — the comment at `:170` literally reads
  "Re-registration is last-write-wins by design (config aggregate)"), the store-locked append
  template (`recordMerge`, `ops.ts:290-304`), the `ProductRegistered` payload schema
  (`events.ts:57-61` — `{ productKey, name, repo, riskTier, priority, charterRef?, stage }`), the
  `guard()` / `makeTools(deps)` MCP pattern (`tools.ts:40-52`), and the existing pure-renderer
  import of `renderFoundryDashboard` (`tools.ts:13`). This spec productionizes the interactive
  follow-up ADR-261 §8 (iii) recorded.

---

## 1. The footgun — and why the fix was deferred

The priority footgun is a coordination smell the dashboard already SURFACES (ADR-261 §4.1, the
DERIVED priority-anomaly advisory) but cannot yet FIX. It originated in the **P3 cutover**
([ADR-254](../../../layers/specs/adr/adr-254-foundry-self-event-sourcing.md)): once foundry
registered itself as a product in its OWN canonical log and seeded its deferred work-items
(`foundry/p5`–`foundry/p8`), `treeFromQueue('foundry', state)` began deriving foundry's live tree
and `planFrontierAll` began driving foundry's frontier. Because `FOUNDRY_PRODUCT` was bootstrapped
at a LOW priority NUMBER (the most-favored end), foundry's own self-items now top the GLOBAL
frontier — so a conductor pulling `foundry_next` claims foundry's deferred `p5`–`p8` **before** it
ever reaches a newly-queued REAL product (oncology, whales-and-bubbles, …). The machine prefers
building itself over building the products it exists to build.

The advisory fires exactly on this pattern: the `#1` frontier item belongs to the lowest-priority-
number product **AND that product is `'foundry'` itself** AND foundry's own frontier items LEAD the
global frontier (`priorityAnomaly(state, frontier)`, ADR-261 §4.1). It is honest, derived signal —
calm by construction, no false-fire on a real product legitimately leading its first-time work.

**The FIX is structurally trivial: re-register foundry at a HIGH priority number (e.g. 500) so it
drops below every real product on the frontier.** But it was DEFERRED throughout the foundry grind
for one reason: **it is a LIVE-CANONICAL-LOG MUTATION, and a mutation that changes the machine's
scheduling order is a FOUNDER-GATED decision** — not something an agent, a conductor, or a CI step
should apply autonomously. The advisory could surface the smell; only the founder could authorize
the correction. ADR-261 left v1 static-first precisely to keep this gate intact.

This spec resolves the gate the RIGHT way (§2): the dashboard becomes interactive, and **the
founder authorizes the fix WITH A CLICK.**

---

## 2. The governance model — founder-click-as-authorization (the crux)

This is the conceptual crux of the whole spec; everything mechanical below exists to serve it.

The priority fix is a mutation to the **canonical event log** — the authoritative record the whole
machine folds. Mutating it changes which product the conductor builds next. That is a
**founder-gated decision** by the same governance logic that makes `foundry_gate_decide` a founder
action and not an agent action: it is a steering decision with machine-wide effect.

**The interactive dashboard resolves the gate by making the founder's CLICK the authorization
event.** Concretely:

1. The dashboard SURFACES the advisory (derived, honest, calm-by-construction — unchanged from
   ADR-261). The founder SEES the footgun.
2. The advisory carries a button: **"Fix → re-prioritize foundry to 500"**. The button is an
   AFFORDANCE, not an action — rendering it performs nothing.
3. The founder CLICKS. A `confirm()` dialog states exactly what will happen ("Re-register foundry
   at priority 500? This appends a corrective `ProductRegistered` to the canonical log."). The
   founder confirms.
4. ONLY THEN does the server perform the op — it appends the corrective `ProductRegistered`. **The
   server never auto-applies; it acts only on an explicit, confirmed click.** The click IS the
   founder's authorization.

This is the legitimate path for a founder-gated decision: the machine surfaces the advisory, the
founder authorizes the correction by clicking, the log records the correction. The dashboard does
not seize the decision; it gives the founder a one-click way to EXERCISE it. The advisory is the
"this needs you"; the button is the "and here is how you say yes".

This realizes the **P7-crown "button = action / intervention" vision**
([ADR-259](../../../layers/specs/adr/adr-259-foundry-browser-runtime-compile-target.md)) for a real
governance action. ADR-259 made a button-click FIRE a declared intervention on a compiled product;
this makes a button-click PERFORM a scoped governance correction on the machine itself — the same
"a button is an action" shape, now applied to the operator cockpit rather than a generated product.

---

## 3. The mechanism — five touch-points (file:line)

Five thin, additive touch-points. The op + the event + the fold are EXISTING; the only genuinely
new code is the `node:http` server, the `--serve` CLI mode, the interactive button, and the op
wrapper. Nothing existing changes behaviour when not served.

### 3.1 `ops.reprioritizeProduct(deps, { productKey, priority })` — `src/ops.ts`

The corrective op, generic over ANY product, following the `recordMerge` store-locked template
verbatim (`ops.ts:290-304`):

```ts
// src/ops.ts — alongside recordMerge / gateDecide / retireItem
export function reprioritizeProduct(
  deps: FoundryDeps,
  input: { productKey: string; priority: number },
): { productKey: string; oldPriority: number; newPriority: number } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const p = s.products.get(input.productKey);
    if (!p) throw new Error(`unknown product: ${input.productKey}`);  // validate (acid)
    const oldPriority = p.priority;
    // Corrective re-register: re-use the product's CURRENT fields, change only priority.
    // The fold (state.ts:172) overwrites the product entry last-write-wins → the new
    // priority is the live one; the log retains full history (state.ts:170 comment).
    append(ev.productRegistered({
      productKey: p.productKey,
      name: p.name,
      repo: p.repo,
      riskTier: p.riskTier,
      stage: p.stage,
      ...(p.charterRef != null ? { charterRef: p.charterRef } : {}),
      priority: input.priority,
      ts,
    }), deps.logPath);
    return { productKey: p.productKey, oldPriority, newPriority: input.priority };
  });
}
```

- **`productRegistered` constructor** — `events.ts:192`; payload schema `ProductRegistered`
  (`events.ts:57-61`) carries exactly `{ productKey, name, repo, riskTier, priority, charterRef?,
  stage }`, so re-using the current `{ name, repo, riskTier, stage, charterRef? }` with a new
  `priority` is a complete, valid re-registration.
- **Last-write-wins fold** — `state.ts:172` (`s.products.set(productKey, {…})`), with the
  by-design comment at `state.ts:170`. The corrective append is the LAST `ProductRegistered` for
  `foundry`, so the fold yields the new priority. No new event type; no fold change.
- **Store-locked** — `withStoreLock(deps.dataDir, …)`, the same dataDir-keyed logical-transaction
  lock `recordMerge` / `gateDecide` / `queuePush` use (`ops.ts:294`, `:279`, `:45`). Concurrent-
  safe.
- **Generic** — any product. The footgun fix is exactly `reprioritizeProduct(deps, { productKey:
  'foundry', priority: 500 })`; the op itself carries NO `'foundry'` literal.

### 3.2 `foundry_reprioritize` — the WRITE MCP tool (`src/mcp/tools.ts` + `src/mcp/server.ts`)

A thin wrapper over the op, for scripting (the same `guard()` shape as `foundry_record_merge`,
`tools.ts:40` / `server.ts:117`). Unlike `foundry_dashboard` / `foundry_status` (read-only), this
one WRITES — it appends an event:

```ts
// src/mcp/tools.ts — one additive entry in makeTools(deps)
foundry_reprioritize: guard((a: { productKey: string; priority: number }) =>
  ops.reprioritizeProduct(deps, { productKey: a.productKey, priority: a.priority })),
```

```ts
// src/mcp/server.ts — one additive registerTool (the write-tool shape)
server.registerTool('foundry_reprioritize', {
  description: 'Re-prioritize a registered product by appending a corrective ProductRegistered ' +
    '(last-write-wins). The canonical footgun fix is { productKey: "foundry", priority: 500 } so ' +
    'foundry\'s deferred self-items drop below every real product on the frontier. Returns ' +
    '{ productKey, oldPriority, newPriority }.',
  inputSchema: { productKey: z.string().min(1), priority: z.number().int() },
}, async (a) => tools.foundry_reprioritize(a));
```

### 3.3 `src/dashboard/server.ts` — the `node:http` localhost-only server (new)

No HTTP library exists in the foundry repo, so the server uses the zero-dep `node:http` core
module, bound to `127.0.0.1` (NOT `0.0.0.0`) — **localhost-only is the security boundary** (§5).

```ts
// src/dashboard/server.ts (new)
import { createServer, type Server } from 'node:http';
import { readEnvelopes } from '../log.js';
import { fold } from '../state.js';
import { buildCascadeTree } from '../plan/cascade.js';
import { FOUNDRY_PRODUCT } from '../instances/foundry-product.js';
import { renderFoundryDashboard } from './render.js';
import * as ops from '../ops.js';
import type { FoundryDeps } from '../ops.js';

export function createDashboardServer(deps: FoundryDeps): Server {
  return createServer((req, res) => {
    // GET / → the dashboard, rendered FRESH from the live log, interactive: true
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const state = fold(readEnvelopes(deps.logPath));
      const models = { foundry: buildCascadeTree(FOUNDRY_PRODUCT) };
      const html = renderFoundryDashboard(state, Date.now(), { models, interactive: true });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    // POST /api/reprioritize-product { productKey, priority? } → apply the op
    if (req.method === 'POST' && req.url === '/api/reprioritize-product') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { productKey, priority } = JSON.parse(body || '{}') as
            { productKey?: string; priority?: number };
          if (!productKey) { json(res, 400, { ok: false, error: 'productKey required' }); return; }
          const r = ops.reprioritizeProduct(deps, { productKey, priority: priority ?? 500 });
          json(res, 200, { ok: true, ...r });
        } catch (e) {
          json(res, 400, { ok: false, error: (e as Error).message });  // unknown product → 4xx
        }
      });
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  });
}

function json(res: import('node:http').ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function listenLocal(server: Server, port: number): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {  // 127.0.0.1 — localhost-only bind
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
```

- **`GET /`** renders FRESH from the live log every request (no stale snapshot), with
  `opts.interactive = true` so the button appears (§3.5).
- **`POST /api/reprioritize-product`** with body `{ productKey, priority? }` (priority defaults to
  500) calls `ops.reprioritizeProduct` and returns `{ ok, productKey, oldPriority, newPriority }`.
  Errors → 4xx/5xx JSON (`{ ok: false, error }`): an unknown product throws in the op → 400.
- **`listenLocal`** binds to `127.0.0.1` and resolves the actual port (port `0` → an OS-assigned
  free port, which the acid uses, §7).

### 3.4 `src/dashboard/cli.ts` — the `--serve [port]` mode (extended)

The existing write-to-file mode (ADR-261 §2.2) stays the DEFAULT. A `--serve [port]` flag starts
the server and prints the URL instead of writing a file:

```ts
// src/dashboard/cli.ts — additive --serve branch; the write-to-file path is unchanged + default
import { createDashboardServer, listenLocal } from './server.js';

const args = process.argv.slice(2);
const serveIdx = args.indexOf('--serve');
if (serveIdx !== -1) {
  const port = Number(args[serveIdx + 1]) || 4555;           // default 4555
  const deps = { logPath: DEFAULT_LOG, dataDir: DEFAULT_DATA_DIR };
  const server = createDashboardServer(deps);
  void listenLocal(server, port).then((bound) => {
    process.stdout.write(`foundry dashboard (interactive) → http://127.0.0.1:${bound}/\n`);
  });
} else {
  // … the EXISTING write-to-file path (ADR-261 §2.2), unchanged — the default mode …
}
```

`"dashboard": "tsx src/dashboard/cli.ts"` (ADR-261) is unchanged; `npm run dashboard -- --serve`
starts the cockpit, `npm run dashboard` still writes the static file. Default port `4555`.

### 3.5 `src/dashboard/render.ts` — the `interactive` flag + the button (extended)

`DashboardOpts` gains one optional field; the renderer STAYS PURE (no new I/O, no clock read):

```ts
// src/dashboard/render.ts — DashboardOpts extension (ADR-261 §2.1)
export interface DashboardOpts {
  models?: Record<string, PlanTree>;
  merges?: number;
  /** When true (served mode only), the priority-anomaly advisory carries a "Fix" button + a
   *  small inline <script>. When false/omitted (static file output), NO button is rendered —
   *  a static file cannot act, so the renderer stays a pure projection. */
  interactive?: boolean;
}
```

In the "needs attention" panel, when `opts.interactive === true` AND `priorityAnomaly(state,
frontier) != null`, the advisory flag appends a button + a small inline `<script>`:

```ts
// inside the priority-anomaly advisory branch of render.ts (interactive only)
const button = opts?.interactive
  ? `<button id="fix-priority" class="fix-btn">Fix → re-prioritize foundry to 500</button>
     <script>
       document.getElementById('fix-priority').addEventListener('click', async () => {
         if (!confirm('Re-register foundry at priority 500? This appends a corrective '
           + 'ProductRegistered to the canonical log.')) return;
         const r = await fetch('/api/reprioritize-product', {
           method: 'POST', headers: { 'content-type': 'application/json' },
           body: JSON.stringify({ productKey: 'foundry', priority: 500 }),
         });
         if (r.ok) location.reload();   // advisory clears; foundry drops below every product
         else alert('reprioritize failed: ' + (await r.text()));
       });
     </script>`
  : '';                                  // NOT interactive → NO button (static file can't act)
```

- **Interactive** → the button renders; clicking it `confirm()`s, `fetch`-POSTs
  `/api/reprioritize-product`, and on success `location.reload()`s — the page re-renders fresh
  from the now-corrected log, the advisory has CLEARED (foundry's priority is 500, no longer the
  most-favored, so `priorityAnomaly` returns `null`), and foundry has dropped below every product
  on the frontier.
- **NOT interactive** (the static `--serve`-less file output) → NO button, NO `<script>`. A static
  file written to disk cannot act, so emitting an actuating button there would be a dead affordance
  (or worse, a misleading one). The renderer's static output is BYTE-UNCHANGED from ADR-261. This
  is what keeps the renderer pure: the `interactive` flag gates an additive button string; without
  it, the renderer is exactly the ADR-261 projection.

The `'foundry'` / `priority: 500` literals in the button are FINE in `src/dashboard/` — the module
is foundry-state-specific by design and exempt from the ADR-243 compiler-agnosticism gate
(ADR-261 D2). The button is the footgun-specific affordance; the OP it calls is generic (§3.1).

---

## 4. The serving model — `node:http`, localhost-only

The repo has no HTTP framework (no Express, no Fastify), and pulling one in for a single-route
operator cockpit would be unjustified weight. The server uses the **zero-dependency `node:http`
core module** — `createServer` + two route checks. This keeps the dependency surface unchanged and
the server trivially auditable (one file, two routes).

The server binds to **`127.0.0.1`, never `0.0.0.0`**. This is the load-bearing security property:
the dashboard is reachable ONLY from the local machine. A click can mutate ONLY the LOCAL canonical
log, and ONLY by someone already at the founder's keyboard. There is no network-exposed mutation
surface; no auth layer is needed because the localhost bind IS the access boundary (the same posture
the substrate's opt-in HTTP modules take, ADR-182, scaled down to one local route). The served page
is rendered fresh from the live log every `GET /` (no caching), so a reload after a POST reflects the
corrected state immediately.

---

## 5. Safety analysis

The fix is a live-log mutation, so the safety case must be explicit. Four properties bound it:

| Property | How it is guaranteed |
|---|---|
| **Localhost-only** | The server binds `127.0.0.1` (§3.3 `listenLocal`). Unreachable off the local machine — a click can mutate only the LOCAL log, by someone at the founder's keyboard. No auth needed because the bind is the boundary. |
| **Confirmed before firing** | The button `confirm()`s with the exact consequence text before any POST (§3.5). No accidental click mutates the log; the founder must explicitly affirm. |
| **Scoped action** | The ONLY mutating endpoint is `POST /api/reprioritize-product` → `reprioritizeProduct` (re-register a product at a new priority). There is no arbitrary-mutation surface, no general event-append route, no eval. The cockpit can reprioritize a product; it cannot do anything else. |
| **Store-locked + idempotent-ish** | `reprioritizeProduct` runs under `withStoreLock` (§3.1) — concurrent-safe with every other foundry op. Re-clicking is harmless: a second corrective `ProductRegistered` at 500 is last-write-wins identical to the first (`state.ts:172`), so a double-click re-registers at 500 twice with no net difference. |

The action is also **never auto-applied** (§2): the server performs it strictly on an explicit,
confirmed click. There is no timer, no poller, no agent path that fires it. The corrective append
is auditable like any other event (full history retained, `state.ts:170`).

---

## 6. ADR-176 inclusion test — NOT triggered (pack-level)

Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 —
BOTH legs must hold for a thing to be kernel):

- **(a) Is "serve an interactive operator dashboard + a reprioritize action" one of the four kernel
  concerns?** No. The four concerns are recurse the plan, flat the observation, inference,
  reproducibility ([ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) §1). An HTTP
  server + a button + a corrective re-registration are PRESENTATION + a pack op over a derived view
  — none of the four.
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate/query/version?**
  No. Single consumer (`domains/foundry`), over foundry-specific state. No second pack needs it; the
  kernel must not validate/version an operator cockpit or a pack op.

**Both legs FAIL → pack territory.** Concretely:

- **`ProductRegistered` is an EXISTING pack event** (`events.ts:21`, `:57`) — the corrective fix
  REUSES it; no new event type, no kernel shape. The kernel never inspects the pack payload (it is
  opaque to the kernel per ADR-027/030).
- **`node:http` is pack infra** — a zero-dep core module the pack imports; the kernel neither
  provides nor validates it.
- **The op is a pack op over DERIVED state** — `reprioritizeProduct` reads the folded `DerivedState`
  and appends an existing event under the existing store-lock. "Store generators, derive graphs" is
  upheld: the priority lives in the LOG (the generator), the live priority is DERIVED by the fold,
  and the advisory is a pure VIEW over the frontier — nothing authoritative is stored outside the
  log.

**Zero kernel change.** This is the same pack-level verdict ADR-261 reached for the static
dashboard, extended to the served + actuating mode.

---

## 7. Acid battery — must BITE

Committed + deterministic in `test/dashboard.acid.test.ts` (extending the ADR-261 battery), run
unconditionally in `ci:local`. **Every acid runs against a TEMP log — NEVER the live one.**

**(a) `reprioritizeProduct` over a temp log changes the priority (last-write-wins) + validates.**
Seed a temp log with `productRegistered({ productKey: 'demo', …, priority: 1 })` + a queued item.
Call `reprioritizeProduct(deps, { productKey: 'demo', priority: 500 })`. Re-`fold` the temp log →
`state.products.get('demo').priority === 500` (the corrective append won last-write-wins) and the
result is `{ productKey: 'demo', oldPriority: 1, newPriority: 500 }`. **Validation:**
`reprioritizeProduct(deps, { productKey: 'nope', priority: 9 })` THROWS `unknown product: nope`.
**MUTATION → RED:** dropping the `if (!p) throw` lets the unknown-product call append a garbage
re-registration → the throw assertion fails.

**(b) The served endpoint applies the op — against a TEMP log, NEVER the live one.** Start
`createDashboardServer({ logPath: TEMP, dataDir: TEMP_DIR })` on `127.0.0.1:0` (an OS-assigned free
port via `listenLocal`). `POST /api/reprioritize-product` with body `{ productKey: 'demo', priority:
500 }` → response `200 { ok: true, oldPriority: 1, newPriority: 500 }`, and re-folding the TEMP log
shows `demo` at priority 500. `POST` with `{ productKey: 'nope' }` → `400 { ok: false, error }`. The
test pins `deps.logPath` to the temp file, so the live canonical log is provably untouched (assert
the live log's byte length is unchanged across the test). **MUTATION → RED:** an endpoint that wrote
to `DEFAULT_LOG` instead of `deps.logPath` blows the live-log-untouched assertion.

**(c) The button renders ONLY when interactive.** Over a fixture state with a priority anomaly:
`renderFoundryDashboard(state, nowMs, { models, interactive: true })` CONTAINS
`id="fix-priority"` + the `confirm(` text + the `/api/reprioritize-product` fetch path;
`renderFoundryDashboard(state, nowMs, { models })` (interactive omitted / false) does NOT contain
`id="fix-priority"`, NO `<button class="fix-btn"`, NO `fetch(`. **MUTATION → RED:** rendering the
button unconditionally (ignoring `opts.interactive`) surfaces `id="fix-priority"` in the
non-interactive render → the absence assertion catches it. This is the purity guard: the static file
output stays byte-identical to ADR-261.

**(d) The advisory CLEARS after a reprioritize.** Build a fixture where `foundry` (priority 1) tops
the frontier with its own `p5`/`p6` while a real product has queued work → assert
`priorityAnomaly(state, frontier) != null` AND the interactive render contains the `PRIORITY` flag +
the button (the BEFORE state). Apply `reprioritizeProduct` over the temp log to set `foundry` to 500,
re-`fold`, recompute the frontier → assert `priorityAnomaly(state', frontier') == null` AND the
interactive render contains NO `PRIORITY` flag and NO `id="fix-priority"` button (the AFTER state —
the advisory cleared, foundry dropped below every product). **MUTATION → RED:** an op that appended
the corrective event with the OLD priority (a no-op fix) leaves the anomaly firing → the after-state
`null` assertion fails.

These four extend ADR-261's battery (KPI-match, done-collapse, anomaly fire/no-false-fire,
what's-left, HTML-escape, self-contained, determinism, plan-tree structure/overlay/compactness),
which continue to bite over the static-render path.

---

## 8. Generalization — the first "dashboard action" (the cockpit)

The reprioritize action is the **first** dashboard action, and it establishes the pattern every
future action follows: **a scoped, localhost-only endpoint + a confirm-gated button + a pack op over
the derived state**, authorized by the founder's click. The static observability page
([ADR-261](../../../layers/specs/adr/adr-261-foundry-observability-dashboard.md)) becomes a live
COCKPIT one action at a time.

Recorded follow-ups (NOT this slice), each a sibling of reprioritize under the same pattern:

- **Approve a gate.** The "needs attention" panel already renders pending gates (one red flag each).
  An "Approve" / "Reject" button per gate → `POST /api/gate-decide { gateId, decision }` →
  `ops.gateDecide` (`ops.ts:275`, already store-locked, already a founder decision). The same
  founder-click-as-authorization model, now for the gate decision it was designed for.
- **Claim an item.** An "up next — frontier" row gains a "Claim" button →
  `POST /api/claim { itemId, sessionId }` → the existing claim op. (Less obviously a founder action —
  more an operator one — but the same scoped-endpoint shape.)
- **Re-cutover a product.** The `(log-derived — flat until re-cutover)` label (ADR-261 §4 panel 6)
  gains a "Re-cutover" button that triggers the blueprint extract → generate cycle for that product,
  closing the live-flat-vs-authored gap the dashboard surfaces.

Each is the SAME shape: one more scoped `POST /api/<verb>` route on the localhost server, one more
confirm-gated button gated behind `opts.interactive`, one more pack op over the derived state — never
an arbitrary-mutation surface, never auto-applied, always the founder's click as the authorization.
This is the convergence ADR-261 §8 (iii) and ADR-259 named: static observability → live mission
control, the operator cockpit assembled one founder-authorized action at a time.

---

## 9. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the fix reuses the
  EXISTING `ProductRegistered` pack event; no new kernel shape (§6).
- **No design-system change.** The button is hand-written inline HTML + a small inline `<script>`;
  no `@de-braighter/design-system-*` import.
- **No new dependency.** `node:http` is a Node core module; the foundry `package.json` is unchanged.
- **Static output unchanged.** Without `--serve`, the CLI still writes the byte-identical static file
  (ADR-261); without `interactive`, the renderer emits the byte-identical static HTML (§7 acid c).
- **`foundry_dashboard` (read-only) unchanged.** It still folds the live log and writes the HTML; the
  new `foundry_reprioritize` is a SEPARATE additive WRITE tool (§3.2).

---

## 10. Slice scope

- **foundry:** add `reprioritizeProduct` to `src/ops.ts` (the store-locked corrective op),
  `src/dashboard/server.ts` (the `node:http` localhost-only server — `GET /` + `POST
  /api/reprioritize-product`), the `--serve [port]` branch in `src/dashboard/cli.ts` (default port
  4555; the write-to-file mode stays default), the `interactive?: boolean` field + the confirm-gated
  button in `src/dashboard/render.ts` (button only when interactive), the `foundry_reprioritize`
  WRITE MCP tool (one additive entry each in `src/mcp/tools.ts` + `src/mcp/server.ts`), and the four
  new acids in `test/dashboard.acid.test.ts` (op-changes-priority+validates · served-endpoint-over-
  temp-log · button-only-when-interactive · advisory-clears-after-reprioritize). It reuses the
  EXISTING `productRegistered` constructor (`events.ts:192`), the EXISTING last-write-wins fold
  (`state.ts:172`), the EXISTING `withStoreLock` template (`ops.ts:290`), and the EXISTING pure
  renderer (`render.ts`, ADR-261). **No `@de-braighter/*` change.**
- **specs:** ADR-262 (proposed) — codifies (1) the dashboard becomes interactive (served via
  `node:http`, localhost-only); (2) dashboard ACTIONS mutate the live log via a SCOPED endpoint,
  authorized by the founder's CLICK (the deferred founder-gated decision resolved interactively —
  never auto-applied); (3) the reprioritize-foundry action fixes the footgun via a corrective
  last-write-wins `ProductRegistered`; (4) the renderer stays pure (button only in interactive mode).

This slice depends only on the static dashboard (ADR-261) and the self-event-sourcing cutover
(ADR-254, which created the footgun). It is orthogonal to the compiler and the log extensions — it
SERVES and ACTS ON the state those produced.
