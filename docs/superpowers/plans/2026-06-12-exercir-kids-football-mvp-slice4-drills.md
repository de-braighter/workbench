# Exercir kids-football MVP — Slice 4 (drill library + editor + pitch sketcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The coach home: a routed `/drills` library (search + focus-area chips + card grid with live sketch thumbnails) and a sketch-first drill editor (screen 4: sticky header, SVG pitch sketcher, 430px form column with the highlighted **expected-effect** card) on a completed drill vertical — `update`/`delete` on the ONE portable contract suite, `Result<T,E>` use-cases, RBAC'd HTTP endpoints, drill permissions in the manifest, and a starter-library demo seed for the stub clubs — with role-gated shell navigation and role-dependent sign-in landing.

**Architecture:** Everything lands in the four EXISTING projects (`libs/pack-kids-football-contracts`, `libs/pack-kids-football`, `apps/pack-kids-football-api`, `libs/pack-kids-football-ui`) — no new nx project, no new workspace package.json (lockfile risk ≈ 0), **no DB migration** (slice 3 pre-paid the drill table incl. the FOR UPDATE RLS policy and grants — verified in `prisma/migrations/20260612200000_kids_football_onboarding/migration.sql:83-86,98`). The sketcher is a pack-local build that ADAPTS the pack-football board-engine architecture (pure-ops module + snapshot-undo component) without importing it — see D-1. The drill wire shape is unchanged: slice 3's `DrillSchema` + `DrillSketchElementSchema` union IS the editor's data model (no new types).

**Tech Stack:** Angular (standalone + signals + reactive forms) + NestJS + Prisma/Postgres, Nx + vitest, `@de-braighter/substrate-{contracts,runtime}@^2.0.0` as already pinned (auth/tenant/RLS surface only — 2.1.0 is in range but adopt NOTHING new; no kernel/inference).

**Repo:** `domains/exercir`. **Branch:** `feat/kids-football-s4-drills` off `origin/main` (08b8427) in the **fresh worktree `domains/exercir-wt-kf-s4`** (already created; `npm ci` done — `npm ls @de-braighter/substrate-runtime` shows 2.0.0). **Gate:** `npm run ci:local` + `npm run test:db` (proof set unchanged — no migration). **Design sources of truth:** `domains/exercir/docs/design/exercir-mvp-handoff/README.md` screens 3 ("Drill library") + 4 ("Drill editor" incl. the pitch-sketcher interaction spec); prototype references `docs/design/exercir-mvp-handoff/exercir/proto/drills.jsx`, `…/proto/sketcher.jsx`, `…/proto/proto-theme.jsx:149-172` (SketchEls/MiniSketch), `…/theme.jsx:146-206` (PitchSVG/PlayerDot/Cone/Ball/SketchArrow/ZoneRect).

---

## Design decisions (resolved at plan time — pinned)

### D-1. The pitch sketcher: pack-local build adapting the board-engine ARCHITECTURE — no import, no extraction (design question 1)

Design §7 pins "reuse the pack-football board engine — adapt, don't fork". Verified against the repo, the three candidate outcomes resolve as follows:

- **(a) Import as-is — ILLEGAL.** The engine lives in `libs/pack-football-ui/src/lib/board-engine/` (`board-ops.ts` + `BoardEditorStore`), tagged `scope:pack-football`; its geometry types come from `@de-braighter/pack-football-contracts` (same scope). The nx depConstraints (`eslint.config.mjs:88-93`) allow `scope:pack-kids-football` to depend ONLY on `scope:pack-kids-football` + `scope:substrate` — even the *type* import is a boundary violation. Widening the constraint would create exactly the cross-pack coupling the pack architecture forbids (ADR-027 posture: packs compose on the platform, they don't import each other).
- **(b) Extract the domain-free core first — REJECTED for this slice.** The shared home would be the design-system repo (ADR-099's `pack-ui-shared` home is **superseded**; ADR-168 moved shared visuals to design-system bricks) — a cross-repo extract → publish → refactor-pack-football → consume arc. The board-runtime epic explicitly deferred exactly this (Thread A, exercir#214 close-out): the substrate-architect flagged the **edit-half** (heterogeneous undo, per-kind hit-testing) as risky/maybe-per-pack, promote-on-a-different-pack-consumer. A different-pack consumer has now appeared — but the **API fit is poor**: the engine is id-based (`BoardMarker.id`, selection/move/remove by id, minted `d{n}` prefixes) over `BoardGeometry {frame, markers, arrows, zones}`, while the pinned slice-4 wire shape is the **id-less positional** `DrillSketchElement[]` union from slice 3 ("the zod union IS the wire shape — no new types"). Reuse-by-import would need bidirectional id-minting/stripping converters kept stable across undo — more plumbing than the sketcher behavior itself (the validated prototype is ~125 lines).
- **(c) CHOSEN: fork-minimal, adapting the architecture.** A pack-local `sketch/` module: `sketch-ops.ts` (pure functions over `DrillSketchElement[]`, mirroring `board-ops.ts`'s shape — clamp-from-frame, pure-mutation-per-gesture, exhaustively unit-tested) + `KfSketcherComponent` carrying the `BoardEditorStore` lessons (snapshot undo, transient drag preview, tool signal, generous hit areas, min-draw-length 18). **Zero code is copied** (none can be legally imported; the behavioral source is the handoff prototype, not the engine). **Named upgrade seam (doc-comment on `sketch-ops.ts`):** when a third board surface appears or this sketcher grows engine-class needs (redo, multi-select, domain bindings), extract the domain-free board-engine core to design-system per ADR-168 and re-point both packs.

This is a **sanctioned deviation from design §7's letter** (recorded here + in the PR body): we reuse the engine's proven *architecture and interaction lessons*, not its code, because the nx scope boundary makes literal reuse illegal and the wire-shape mismatch makes it a bad fit.

### D-2. Stub-club starter seed: seed STARTER_DRILLS for both stub clubs (design question 2)

Slice 3 seeds drills only via onboarding, so FC Sonnenberg / FC Stadtpark have empty libraries — the coach HOME would demo blank. Decision: **bootstrap-seed** `STARTER_DRILLS` for both stub clubs, mirroring `seedDemoMembers/Teams/Resources` (in-memory mode only, never the DB path — stub clubs are in-memory fixtures). Ids are minted at seed time (`crypto.randomUUID()`); nothing references drill ids externally, so no fixed-UUID parity is needed. The `SHARED_DRILL_STORE_MAP` doc comment (which currently says "NO demo seed") flips with the rationale: slice 4 made the library the coach home; wizard-created clubs already get the 8 via onboarding, stub clubs now match.

### D-3. Sketcher a11y posture: WCAG 2.5.7 SATISFIED via click-click alternatives; keyboard canvas placement is a documented exemption (design question 3)

- **2.5.7 dragging alternatives — satisfied, not exempted.** Every drag function gets a single-pointer non-drag path:
  - **Draw tools (pass/run/zone):** press-and-release without movement (< 6px) sets an **anchor** (announced); the preview then follows the pointer; a second click ≥ 18 units from the anchor commits the arrow/zone; a second click < 18 cancels the anchor. Drag (press-move-release ≥ 18) still works exactly per the prototype. Escape cancels an anchor or an in-flight drag.
  - **Move (select tool):** click an element to select it (announced); click an empty pitch location to move the selection there. Drag-move still works (20px invisible point hit-circles, 16px-wide arrow hit-lines per the handoff).
  - Place (point tools) and erase are already click-based.
- **Keyboard (2.1.1):** the tool rail, undo, and clear are native `<button>`s (focusable, `aria-pressed` on the active tool, ≥ 24×24px targets — 2.5.8). Placed elements are focusable (`tabindex="0"`, per-element `aria-label` e.g. "Player 2 at 430, 310"); **Delete/Backspace removes** the focused/selected element. All mutations announce through a polite live region (placed/drawn/moved/deleted/undone/cleared). This matches the in-repo precedent (`pack-football-ui` `DrillBoardEditorComponent`: focusable elements + Delete/Backspace + live announcements).
- **Documented prototype exemption (pinned):** keyboard-only *placement and movement* on the canvas (e.g. arrow-key nudge of the focused element) is NOT implemented — the same deferral the pack-football editor itself carries ("Keyboard parity (Arrow-key navigation) is deferred", drill-board-editor.component.ts:15). Upgrade seam named in the component doc comment; tracked in the slice-4 follow-ups issue. **The wave prompt tells qa-engineer exactly this decision.**

### D-4. exercir#245 (F1 event-log posture) — extend the doc-comment posture to the new mutations

Drill `update`/`delete` are NEW pack CRUD mutations. Per the same decision row as slices 1–3: **extend #245's documented posture** (doc comments on the repository methods + services: "this mutation carries no F1 event-log write; tracked in exercir#245") rather than wiring F1. The PR body states this explicitly; #245 stays open as the posture tracker.

### D-5. exercir#251 nits — fold ONLY what slice 4 naturally touches

- **GUC-const dedup — FOLDED.** The drill Prisma adapter is being edited anyway; `CURRENT_TENANT_PACK_ID_SQL` (duplicated ×6) moves to a shared `out-adapters/prisma-guc.ts`, consumed by all six adapters (member/team/resource/slot/club/drill) in one mechanical pass (Task 3).
- **Club `@@index` drop — NOT folded.** It needs a migration; slice 4 ships none. Stays open on #251.
- **Wizard extraction — NOT triggered.** Slice 4 does not touch `onboarding-wizard.component.ts` (the wizard's `/admin/slots` landing keeps working unchanged under the route restructure, Task 9).

### D-6. Other pinned deviations and decisions

- **Enabled-submit (house pattern, vs handoff "Save disabled until named"):** Save stays ENABLED; clicking with an empty name renders the inline `role="alert"` error and focuses the name input (drill-arc + slice-3 convention; pinned deviation from the prototype's `disabled={!d.name.trim()}`).
- **Role union grows type-level 'assistant-coach':** `DemoUser['role']` + `KfSessionSchema` gain `'assistant-coach'` so the nav predicate and landing logic type-check honestly against the manifest grants. **No assistant-coach demo fixture is added** (no run-through case needs one; the manifest grant is the server truth — a future fixture lights the nav up without code change). The Task-6 session-schema round-trip spec (`role: 'assistant-coach'` parses) is the **consuming test** for the new union arm — it is schema-exercised this slice, not dead surface; the fixture arrives with whichever slice first demos an assistant coach.
- **Nav gating:** Drills link for `coach | assistant-coach | club-admin`; Club link becomes `club-admin`-only. A team-manager sees NO nav links this slice (their handoff nav — Calendar + Team — arrives slices 6/8) and still lands on `/admin/members` (memberRead allows it).
- **Sign-in landing:** `coach | assistant-coach` → `/drills`; `club-admin` and `team-manager` → `/admin/members` (status quo). The wizard's landing on `/admin/slots` is untouched.
- **Drill→template cascade is slice-5 territory:** `DeleteDrillService` carries the seam doc-comment (the slice-2 convention): deleting a drill will cascade template items + scheduled events in slice 5; today nothing references drills.
- **Focus areas:** new `KF_DRILL_FOCUS_AREAS` const in contracts (the prototype's `P_FOCUS` list) drives the library filter chips + editor chips. `DrillSchema.focus` stays a free `z.string().min(1)` (wire-stable); if an existing drill carries an out-of-catalog focus, the editor renders it as an extra selected chip (degenerate-data tolerance). Note: the catalog's `'Defending'` entry is used by NO starter drill (the fixture covers the other six areas) — the "Defending" filter chip correctly yields zero cards against a seed-only library; the run-through must not read that as a bug.
- **Duration stepper 2–45′** per the handoff; the wire schema stays `min ≥ 1` (UI deliberately narrower).
- **demo_mode anchor:** slice 4 ships **no outbound path** — nothing new fires; the editor adds none. `subjectSensitivity 'developmental-minor'` still does NOT fire (drills are authored coaching content, not inferred player state); it arms at slice 7/8, and when it fires, `PackManifest.subjectSensitivity` must be set so the ADR-187/188/189 gates engage (the #249 charter-checker note).

---

## Pre-flight (read before Task 1)

The implementer of each task must read the slice-1/2/3 reference files for its layer and mirror their structure (adapt names, do NOT copy comments verbatim):

- **Drill vertical as it stands (slice 3, now in-repo):** `libs/pack-kids-football-contracts/src/drills.ts` (DrillSchema + sketch-element union + STARTER_DRILLS) · `libs/pack-kids-football/src/out-ports/drill.repository.ts` + `…/drill.repository.contract.ts` (the seed-only port to extend) · `src/out-adapters/prisma-drill.repository.ts` (TENANT_RUNNER pattern, GUC read-back, JSONB handling) · `out-ports/tenant-runner.port.ts:371-422` (drill row/delegate types to extend) · `out-adapters/testing/stub-delegates.ts` · `prisma/migrations/20260612200000_kids_football_onboarding/migration.sql` (the FOR UPDATE policy + grants ALREADY in place — no migration this slice).
- **Full-CRUD exemplar (slot vertical, slice 2):** `out-ports/slot.repository.ts` + `…/slot.repository.contract.ts` (update/delete port shapes, count-0 semantics) · `in-ports/create-slot.use-case.ts` + `update-slot.use-case.ts` + `delete-slot.use-case.ts` (Result types) · `application/update-slot.service.ts` (load→merge→validate-merged→persist; lost-update race note) · `out-adapters/prisma-slot.repository.ts:119-172` (presence-driven patch data build, updateMany/deleteMany count-0, isValidUuid guard).
- **API composition:** `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (inMemoryRepoProviders, SHARED_DRILL_STORE_MAP, seedDemoTeams as the seed-fn shape) · `…/pack-kids-football-auth.bootstrap.ts` (PACK_KF_CONTROLLERS at :57, `seedDemo*IfInMemory` at :83-86,106-172) · `…/slots.controller.ts` (the RBAC controller exemplar) · `…/slots.e2e.spec.ts` (e2e harness) · `…/onboarding.service.ts` (the seed consumer — its `drillRepo.createMany(STARTER_DRILLS)` call must keep compiling unchanged).
- **UI patterns:** `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (buildHeaders + per-endpoint zod parse — the slice-2 lesson: parse PER-ENDPOINT response shapes) · `lib/data/kf-club-store.ts` (per-collection signals + error signals) · `lib/data/kf-session.service.ts` + `lib/data/demo-fixtures.ts` (role union to extend — NOTE: the comment at `pack-kids-football.module.ts:213` saying "Task 6 retired the old UI demo-fixtures.ts" refers to a PRIOR slice's task numbering; the file exists and this slice extends it) · `lib/routes.ts` + `lib/shell/kf-shell.component.ts` (nav, paramMap fallback chain, signOut absolute arrays) · `lib/auth/sign-in-page.component.ts:314-330` (selectUser landing to make role-dependent) · `lib/admin/slots-page.component.ts` (modal + form patterns) · `lib/a11y/kf-modal-focus.ts` (trapTabKey/focusFirstField/restoreFocus) · `lib/kf-i18n.ts`.
- **Board-engine ARCHITECTURE reference (read-only inspiration — DO NOT import, D-1):** `libs/pack-football-ui/src/lib/board-engine/board-ops.ts` + `board-editor.store.ts`; a11y precedent `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts` (focusable elements, Delete/Backspace, kbd-help, live announcements).
- **Prototype:** `docs/design/exercir-mvp-handoff/exercir/proto/drills.jsx` (library + editor layout) · `…/proto/sketcher.jsx` (interaction source of truth) · `…/proto/proto-theme.jsx:149-172` (SketchEls/MiniSketch scaling) · `…/theme.jsx:146-206` (PitchSVG/PlayerDot/Cone/Ball/SketchArrow/ZoneRect render shapes).

**Battle-tested gotchas to honor (slices 1–3 memory):** browser run-through catches what unit layers can't — initial store loads (`ngOnInit → load`) + per-endpoint response shapes; kill any orphan :3150 PID before serving (`Get-NetTCPConnection -LocalPort 3150`); **NEVER pipe a background `nx serve` through `head -N`** (SIGPIPE kills it after N lines — redirect to a file); extending `TenantScopedClient`/delegate interfaces fans out mechanical edits to every sibling spec literal — budget for it; `toSignal(control.valueChanges)` not `computed()` over `control.value`; absolute `['/t', tenant, …]` routerLink arrays via the paramMap fallback chain (never relative); ONE `ACTIVE_TENANT_FN` provider per module; zod chain order `.max(…).default(…)`; no workspace package.json change expected — if one happens, re-run `npm install` and commit the lockfile in the same commit; in sketcher component specs, stub the svg's `getBoundingClientRect` to `{left: 0, top: 0, width: 860, height: 560}` so client coords ≡ board coords (pointer-event tests stay deterministic); post-findings uses the FULL `de-braighter/exercir#NN` form and the Write tool for JSON (PowerShell BOM breaks it).

## File structure (created/modified in this slice)

| File | Responsibility | Task |
|---|---|---|
| `libs/pack-kids-football-contracts/src/roles.ts` (+ spec) | drillRead/drillWrite permission ids | 1 |
| `libs/pack-kids-football/src/manifest/pack-manifest.ts` + `pack-manifest.spec.ts` | 8→10 permissions, coach/assistantCoach drill grants + rationale | 1 |
| `libs/pack-kids-football-contracts/src/drills.ts` (+ spec) · `src/index.ts` | `CreateDrillInputSchema`, `KF_DRILL_FOCUS_AREAS` | 2 |
| `libs/pack-kids-football/src/out-ports/drill.repository.{ts,contract.ts,spec.ts}` · `out-ports/tenant-runner.port.ts` · `out-adapters/prisma-drill.repository.ts` (+ contract spec) · `out-adapters/prisma-guc.ts` (NEW) + the 5 sibling adapters · `out-adapters/testing/stub-delegates.ts` | findById/update/delete on the one contract suite; GUC-const dedup (#251) | 3 |
| `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-drill.use-case.ts` · `src/application/*-drill.service.ts` (+ `drill-use-cases.spec.ts`) · `src/index.ts` · `apps/…/pack-kids-football.module.ts` | Result<T,E> drill use-cases + DI wiring | 4 |
| `apps/pack-kids-football-api/src/app/drills.controller.ts` · `…/drills.e2e.spec.ts` · `pack-kids-football-auth.bootstrap.ts` · `pack-kids-football.module.ts` (seedDemoDrills) | RBAC endpoints + e2e + stub-club starter seed (D-2) | 5 |
| `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec) · `lib/data/kf-club-store.ts` (+ spec) · `lib/data/demo-fixtures.ts` · `lib/data/kf-session.service.ts` | drill client methods + store collection + 'assistant-coach' role union | 6 |
| `lib/drills/sketch/kf-pitch-bg.component.ts` · `…/kf-sketch-elements.component.ts` · `…/kf-sketch-thumbnail.component.ts` (+ specs) | pure SVG render core shared by thumbnail + sketcher | 7 |
| `lib/drills/sketch/sketch-ops.ts` (+ spec) · `…/kf-sketcher.component.ts` (+ spec) | the pitch sketcher (D-1 architecture, D-3 a11y) | 8 |
| `lib/routes.ts` · `lib/shell/kf-shell.component.ts` (+ specs) · `lib/auth/sign-in-page.component.ts` (+ spec) · `lib/kf-i18n.ts` | shell wrapper route, role-gated nav, role-dependent landing | 9 |
| `lib/drills/kf-phase-tag.component.ts` · `…/kf-intensity-dots.component.ts` · `…/drill-library-page.component.ts` (+ specs) | the coach home: search + chips + card grid + thumbnails | 10 |
| `lib/drills/drill-editor-page.component.ts` (+ spec) · `lib/kf-i18n.ts` | screen-4 editor: form column, expected-effect card, delete-confirm | 11 |
| — | Slice gate, browser run-through, story issue, PR, wave, ritual | 12 |

---

## Task 1: Drill permissions + manifest (8→10)

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/roles.ts` (+ `roles.spec.ts` if it asserts counts), `libs/pack-kids-football/src/manifest/pack-manifest.ts`, `…/pack-manifest.spec.ts`

- [ ] **Step 1: Write the failing specs (same red→green pass as the breaking assertions).** Update `pack-manifest.spec.ts`:
  - rename `'declares all 8 permissions…'` → `'declares all 10 permissions, each prefixed kids-football.'` (the `toEqual(Object.values(KF_PERMISSIONS))` body is already order-driven — it goes red the moment KF_PERMISSIONS grows until the manifest matches);
  - rename `'grants clubAdmin all 8 permissions'` → `…all 10…` (body unchanged — `Object.values`);
  - `'grants coach read-only access…'` becomes `'grants coach reads + drill authoring'`: `toEqual([memberRead, teamRead, resourceRead, slotRead, drillRead, drillWrite])`, keep the four `not.toContain(*Write)` assertions for member/team/resource/slot;
  - same for assistantCoach;
  - ADD: `'grants teamManager and facilities NO drill permissions'` — both roles' arrays `not.toContain(drillRead)` and `not.toContain(drillWrite)`.
- [ ] **Step 2: Run → FAIL** (`npx nx run-many -t test --projects=pack-kids-football-contracts,pack-kids-football`).
- [ ] **Step 3: Implement.** `roles.ts` — append to `KF_PERMISSIONS` (order matters: the manifest spec asserts `Object.values` order):

```ts
  slotRead: 'kids-football.slot.read',
  slotWrite: 'kids-football.slot.write',
  drillRead: 'kids-football.drill.read',
  drillWrite: 'kids-football.drill.write',
```

  Update the `KF_PERMISSIONS` doc comment ("drill read+write added in slice 4; template/event permissions arrive in later slices"). `pack-manifest.ts` — two new permission entries appended (matching Object.values order):

```ts
    { id: P.drillRead, displayName: 'Read the drill library' },
    { id: P.drillWrite, displayName: 'Create and edit drills' },
```

  Role grants — append `P.drillRead, P.drillWrite` to BOTH `coach` and `assistantCoach` arrays, with the pinned rationale comment (the slice-2 slotRead convention):

```ts
      // Drill-grant rationale (slice 4, handoff nav table): coach AND assistant
      // coach both carry the Drills nav and full planning — both author drills,
      // so both get drillRead + drillWrite. teamManager (Calendar read-only +
      // Team) and facilities (resources/slots only) have no Drills nav and get
      // NEITHER drill permission.
```

  clubAdmin inherits both via `Object.values(P)` (no edit). teamManager/facilities unchanged.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drillRead/drillWrite permissions + coach/assistant-coach grants (8→10)`.

## Task 2: Contracts — CreateDrillInputSchema + focus-area catalog

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/drills.ts` (+ `drills.spec.ts`), `src/index.ts`

- [ ] **Step 1: Write the failing specs.** `drills.spec.ts` additions: `CreateDrillInputSchema` parses `STARTER_DRILLS[2]` (Passing Gates — all three sketch element kinds) and REJECTS an object with an `id` key present after `.strict()`? — no: zod `.omit` strips unknown keys by default; assert instead that the parsed output has NO `id` key and that a missing `name` fails; `KF_DRILL_FOCUS_AREAS` equals the 7-entry prototype list in order; every `STARTER_DRILLS[i].focus` is included in `KF_DRILL_FOCUS_AREAS` (catalog covers the fixture).
- [ ] **Step 2: Run → FAIL** (`npx nx test pack-kids-football-contracts`).
- [ ] **Step 3: Implement** in `drills.ts` (below the enum constants):

```ts
/** Focus-area catalog (prototype P_FOCUS) — drives the library filter chips and
 * the editor's focus chips. DrillSchema.focus deliberately stays a free string
 * (wire-stable); the catalog is a UI vocabulary, not a wire constraint. */
export const KF_DRILL_FOCUS_AREAS = [
  'Passing', 'Dribbling', 'Finishing', 'Defending',
  'Ball mastery', 'Game play', 'Recovery',
] as const;

/** Create/replace payload for a drill — the full entity minus the server-minted id. */
export const CreateDrillInputSchema = DrillSchema.omit({ id: true });
```

  Export both from `src/index.ts`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — CreateDrillInputSchema + KF_DRILL_FOCUS_AREAS contracts`.

## Task 3: Drill vertical completion — findById/update/delete on the ONE contract suite (+ #251 GUC dedup)

**Files:**
- Modify: `libs/pack-kids-football/src/out-ports/drill.repository.ts`, `…/drill.repository.contract.ts`, `…/drill.repository.spec.ts`, `out-ports/tenant-runner.port.ts`, `out-adapters/prisma-drill.repository.ts`, `…/prisma-drill.repository.contract.spec.ts`, `out-adapters/testing/stub-delegates.ts`, `src/index.ts`
- Create: `out-adapters/prisma-guc.ts`; Modify (mechanical, dedup): `prisma-member.repository.ts`, `prisma-team.repository.ts`, `prisma-resource.repository.ts`, `prisma-slot.repository.ts`, `prisma-club.repository.ts`

- [ ] **Step 1: Write the failing contract-suite cases** in `drill.repository.contract.ts` (run against BOTH impls, mirroring `slot.repository.contract.ts`): `findById` → null when absent / returns the created drill / cross-tenant id → null; `update(id, patch)` → merged drill returned (patch `{name, intensity}` leaves sketch/equipment untouched), JSONB round-trip on a sketch-replacing patch (`patch.sketch` deep-equals on re-read), absent id → null, cross-tenant id → null (count-0 semantics), empty patch `{}` → existing drill unchanged; `delete(id)` → true + gone from list / absent id → false / cross-tenant id → false (B cannot delete A's drill — A still lists it); mutation isolation (mutating a returned drill does not affect the store).
- [ ] **Step 2: Run → FAIL** (`npx nx test pack-kids-football`).
- [ ] **Step 3: Implement.**

  `drill.repository.ts` — extend the port (update the header comment: "slice 4 completes the vertical"; keep the #245 note on every mutation, D-4):

```ts
export type UpdateDrillPatch = Partial<CreateDrillInput>;

export interface DrillRepository {
  list(): Promise<readonly Drill[]>;
  /** The drill with this id for the active tenant, or null. */
  findById(id: string): Promise<Drill | null>;
  createMany(inputs: readonly CreateDrillInput[]): Promise<readonly Drill[]>;
  /**
   * Partial update. Returns the updated drill, or null when the id does not
   * resolve for the active tenant (absent or RLS-scoped out — count-0 semantics).
   * Array fields (equipment/points/sketch) are replaced wholesale when present.
   * Note: this mutation carries no F1 event-log write; tracked in exercir#245.
   */
  update(id: string, patch: UpdateDrillPatch): Promise<Drill | null>;
  /**
   * Delete. true when a row was removed, false when the id does not resolve
   * for the active tenant. Drill→template cascade is slice-5 territory.
   * Note: this mutation carries no F1 event-log write; tracked in exercir#245.
   */
  delete(id: string): Promise<boolean>;
}
```

  `InMemoryDrillRepository` — `findById` (clone or null), `update` (bucket lookup → `{...existing, ...definedKeysOf(patch)}` — drill has NO nullable scalars, so only forward keys whose value `!== undefined`; structuredClone at both boundaries), `delete` (bucket.delete → boolean).

  `tenant-runner.port.ts` — extend `TenantScopedDrillDelegate` with the slot-delegate shapes (`findUnique({where:{id}})`, `updateMany({where:{id}, data: TenantScopedDrillUpdateData}) → {count}`, `deleteMany({where:{id}}) → {count}`); add `TenantScopedDrillUpdateData` (all drill columns optional, `equipment/points/sketch: unknown`). Extend `testing/stub-delegates.ts` and fix every sibling spec literal the interface growth fans out to (the budgeted gotcha).

  `prisma-guc.ts` (NEW — the #251 dedup):

```ts
/** Reads the tx-local `app.tenant_pack_id` GUC the runner set before `fn` ran.
 * Shared by all kids-football Prisma adapters (exercir#251 dedup). */
export const CURRENT_TENANT_PACK_ID_SQL =
  "SELECT current_setting('app.tenant_pack_id', true) AS tenant_pack_id";
```

  Replace the local const in all six adapters with the import (mechanical; no behavior change — existing suites prove it).

  `prisma-drill.repository.ts` — `findById` (uuid-guard → `findUnique` → map or null), `update` (uuid-guard; presence-driven `data` build forwarding only `!== undefined` keys — JSONB arrays passed directly, never null; empty `data` → return `findById(id)`; `updateMany` → count 0 → null → `findUnique` re-read → map), `delete` (uuid-guard → `deleteMany` → count boolean), mirroring `prisma-slot.repository.ts:119-172`. Extend `prisma-drill.repository.contract.spec.ts`'s fake-delegate harness for the three new delegate methods; the DB-gated block runs the same contract suite live.
- [ ] **Step 4: Run → PASS** (`npx nx run-many -t lint test --projects=pack-kids-football`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drill vertical completion (findById/update/delete, one contract suite, two impls) + GUC-const dedup (#251)`.

## Task 4: Drill use-cases (list/create/update/delete, Result<T,E>) + module wiring

**Files:**
- Create: `libs/pack-kids-football/src/in-ports/list-drills.use-case.ts`, `…/create-drill.use-case.ts`, `…/update-drill.use-case.ts`, `…/delete-drill.use-case.ts`, `src/application/list-drills.service.ts`, `…/create-drill.service.ts`, `…/update-drill.service.ts`, `…/delete-drill.service.ts`, `…/drill-use-cases.spec.ts`
- Modify: `src/index.ts`, `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (providers + exports)

- [ ] **Step 1: Write the failing specs** (`drill-use-cases.spec.ts`, in-memory repo, mirroring `slot-use-cases.spec.ts`): list returns seeded drills; create happy path (validates via `CreateDrillInputSchema`, returns drill with id); create with empty name / intensity 6 / unknown sketch element `t` → `{ok: false, error: {kind: 'invalid-input', detail}}` and repo untouched; update happy (patch name only — sketch preserved); update validates the MERGED candidate (patch `{min: 0}` onto a valid drill → invalid-input); update unknown id → `{kind: 'drill-not-found'}`; delete happy → ok; delete unknown id → `drill-not-found`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In-ports mirror the slot quartet exactly (domain-named methods, Symbol tokens):

```ts
// create-drill.use-case.ts (the other three mirror it)
export type CreateDrillFailure = { kind: 'invalid-input'; detail: string };
export type CreateDrillResult =
  | { ok: true; value: Drill }
  | { ok: false; error: CreateDrillFailure };
export interface CreateDrillUseCase {
  createDrill(input: CreateDrillInput): Promise<CreateDrillResult>;
}
export const CREATE_DRILL_USE_CASE = Symbol('CREATE_DRILL_USE_CASE');
// update: failure kinds 'invalid-input' | 'drill-not-found'; patch type UpdateDrillPatch
// delete: failure kind 'drill-not-found'
// list:   failure type never (mirrors ListSlotsUseCase)
```

  Services: `ListDrillsService` (repo.list → ok). `CreateDrillService` — `CreateDrillInputSchema.safeParse(input)` → first-issue `invalid-input` detail (the slot convention `path: message`); on success `repo.createMany([parsed.data])` → `value: created[0]` (doc-comment: single create rides the existing bulk port — YAGNI on port growth). `UpdateDrillService` — `repo.findById` → `drill-not-found`; merge `{...existingMinusId, ...definedKeys(patch)}`; validate merged via `CreateDrillInputSchema`; `repo.update(id, patch)` → null ⇒ `drill-not-found` (lost-update race, the slot convention); no referential checks (drills have no FKs). `DeleteDrillService` — `repo.delete` → false ⇒ `drill-not-found`; doc-comment the slice-5 cascade seam (D-6) + the #245 posture line (D-4). Export everything from `src/index.ts`; wire the four providers + `useExisting` token bindings and the four token exports in `PackKidsFootballModule` (mirror the slot block).
- [ ] **Step 4: Run → PASS** (`npx nx run-many -t test --projects=pack-kids-football,pack-kids-football-api` — the api project proves the module still composes).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drill use-cases (list/create/update/delete, Result<T,E>) + module wiring`.

## Task 5: Drills HTTP controller + RBAC e2e + stub-club starter seed (D-2)

**Files:**
- Create: `apps/pack-kids-football-api/src/app/drills.controller.ts`, `…/drills.e2e.spec.ts`
- Modify: `…/pack-kids-football-auth.bootstrap.ts` (PACK_KF_CONTROLLERS + `seedDemoDrillsIfInMemory`), `…/pack-kids-football.module.ts` (`seedDemoDrills` + SHARED_DRILL_STORE_MAP comment flip)

- [ ] **Step 1: Write the failing e2e** (`drills.e2e.spec.ts`, in-memory binding, mirror `slots.e2e.spec.ts` harness): as club-A **coach** — `GET /kids-football/drills` → 200 with the 8 seeded starter drills (names match `STARTER_DRILLS`, each parses `DrillSchema`); `POST` a valid new drill → 201, then GET shows 9; `PATCH /:id` name → 200 with merged body; `DELETE /:id` → 204, GET back to 8; as club-A **teamManager** — GET → 403, POST → 403 (no drill permissions, Task 1); as club-B **admin** — GET → 200 with ONLY club B's 8 (cross-club invisibility: A's created drill absent); invalid POST (intensity 6) → 400 `{kind: 'invalid-input'}`; PATCH unknown uuid → 404 `{kind: 'drill-not-found'}`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**

  `drills.controller.ts` — mirror `slots.controller.ts` exactly (header doc incl. failure mapping; exhaustiveness fallbacks):

```ts
@Controller('kids-football/drills')
export class KidsFootballDrillsHttpController {
  // GET    @RequiresPermission(KF_PERMISSIONS.drillRead)   → 200 Drill[]
  // POST   @RequiresPermission(KF_PERMISSIONS.drillWrite)  → 201 Drill | 400
  // PATCH  :id @RequiresPermission(KF_PERMISSIONS.drillWrite) → 200 | 400 | 404
  // DELETE :id @RequiresPermission(KF_PERMISSIONS.drillWrite) → 204 | 404
}
```

  Append to `PACK_KF_CONTROLLERS` (`pack-kids-football-auth.bootstrap.ts:57`).

  `pack-kids-football.module.ts` — `seedDemoDrills(clubATenantPackId, clubBTenantPackId)` mirroring `seedDemoTeams`: for each club, build a bucket from `STARTER_DRILLS.map((d) => ({...structuredClone(d), id: crypto.randomUUID()}))` and set it on `SHARED_DRILL_STORE_MAP`. Flip the store-map doc comment (D-2): *"Demo seed (slice 4): both stub clubs get the 8-drill starter library at bootstrap (in-memory mode only) — the library is the coach home and must demo populated; wizard-created clubs get the same 8 via onboarding."* Bootstrap: add `seedDemoDrillsIfInMemory()` beside the three siblings (:83-86), same in-memory-only guard + tenantPackId resolution.
- [ ] **Step 4: Run → PASS** (`npx nx test pack-kids-football-api`), then `npm run test:db` with Postgres up (regression — the slice-3 club+drill RLS proofs still pass; no migration shipped).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drills RBAC endpoints + e2e + stub-club starter-library seed`.

## Task 6: UI data tier — client methods, store collection, 'assistant-coach' role union

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec), `lib/data/kf-club-store.ts` (+ spec), `lib/data/demo-fixtures.ts`, `lib/data/kf-session.service.ts`

- [ ] **Step 1: Write the failing tests.**
  - Client spec: `listDrills()` GETs `/kids-football/drills` with identity headers, parses `z.array(DrillSchema)`, rejects a malformed entry; `createDrill(payload)` POSTs and parses `DrillSchema` (plain entity — the per-endpoint-shape lesson); `updateDrill(id, patch)` PATCHes; `deleteDrill(id)` DELETEs, resolves void.
  - Store spec: `drills()` empty initially; `loadDrills()` populates from the client and clears `drillsError`; a 403 sets `drillsError` via `mapKfError` and leaves `drills` untouched; `loadDrills` is NOT part of `refresh()` (admin pages don't fetch drills).
  - Session spec: a stored session with `role: 'assistant-coach'` round-trips (schema accepts it).
- [ ] **Step 2: Run → FAIL** (`npx nx test pack-kids-football-ui`).
- [ ] **Step 3: Implement.** Client — four methods mirroring the team quartet (buildHeaders + firstValueFrom + zod parse). Store — `_drills`/`_drillsError` signals + readonly views + `loadDrills()` (mirror `loadTeams`, incl. the concurrent-error-isolation convention); doc-comment why drills stay out of `refresh()`. `demo-fixtures.ts` `DemoUser['role']` union + `kf-session.service.ts` `KfSessionSchema` role enum gain `'assistant-coach'` (D-6 — type-level only, no new fixture; comment points at the manifest grant as server truth).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drill client + store collection + assistant-coach role union`.

## Task 7: Sketch render core — pitch background, element renderer, thumbnail

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/drills/sketch/kf-pitch-bg.component.ts`, `…/kf-sketch-elements.component.ts`, `…/kf-sketch-thumbnail.component.ts`, `…/kf-sketch-thumbnail.component.spec.ts` (one spec file covers the three — they compose)

These are pure, prop-driven, SVG-fragment components (attribute selectors on `<svg:g>`) so the thumbnail AND the Task-8 sketcher share one render path — the prototype's `SketchEls`/`MiniSketch`/`PitchSVG` split (`proto-theme.jsx:149-172`, `theme.jsx:146-206`).

- [ ] **Step 1: Write the failing specs.** Thumbnail host: renders an `<svg viewBox="0 0 860 560">`; with `ariaLabel` set → `role="img"` + the label; with `ariaLabel` null → `aria-hidden="true"` (decorative card usage); pitch background renders the grass rect + 3 stripe bands + boundary + halfway line + center circle (query by data-testid); given `STARTER_DRILLS[2].sketch` (all kinds) it renders: numbered ink player dots (text content `1`/`2`), accent opp dots, orange cone polygons, white ball circles, dashed pass lines + solid run lines (both with arrowhead polygons), dashed zone rect; empty sketch → pitch only.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**

  `kf-pitch-bg.component.ts` — `selector: 'svg:g[libKfPitchBg]'`, no inputs; template (constants `W=860`, `H=560`):

```html
<svg:rect data-testid="kf-pitch-grass" x="0" y="0" [attr.width]="W" [attr.height]="H" rx="12" [attr.fill]="'var(--cg-grass, #4e9c63)'" />
<!-- mowing stripes: sixths 0/2/4 at rgba(255,255,255,0.045) (sketcher.jsx:100) -->
<!-- boundary rect 14-inset, white 0.55 stroke; halfway line; center circle r = H * 0.11 (sketcher.jsx:101-103) -->
```

  `kf-sketch-elements.component.ts` — `selector: 'svg:g[libKfSketchEls]'`, `input.required<readonly DrillSketchElement[]>()` named `els`; an `@for` over elements switching on `el.t`, porting the prototype shapes 1:1 (`theme.jsx:162-202`): player → ink-filled circle r 15, white 0.85 stroke, white bold number text; opp → accent-filled circle, number text; cone → `#FF8A2A` triangle (s 11); ball → white circle r 7 + dark hub; pass/run → line to a 6px-backed-off endpoint + computed arrowhead polygon (the `SketchArrow` math: angle `atan2`, head length 11, ±0.45 rad), pass dashed `7 6`; zone → `rgba(255,255,255,0.10)` fill, white 0.7 dashed `6 6` stroke, rx 6. Colors via `var(--cg-ink, #1c2520)` / `var(--cg-accent, #2f8a4e)`. All shapes `pointer-events: none` is NOT set here (the sketcher needs hits) — the THUMBNAIL svg root sets `pointer-events: none` instead.

  `kf-sketch-thumbnail.component.ts` — `selector: 'lib-kf-sketch-thumbnail'`, inputs `sketch: readonly DrillSketchElement[]`, `ariaLabel: string | null = null`; one `<svg viewBox="0 0 860 560" width="100%">` (scaling is free — same viewBox as the editor, the MiniSketch `k`-trick unneeded because we keep native coordinates and let the viewBox scale), `[attr.role]`/`[attr.aria-label]`/`[attr.aria-hidden]` per the input, composing `<svg:g libKfPitchBg />` + `<svg:g libKfSketchEls [els]="sketch()" />`, border-radius 8.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — shared SVG sketch render core (pitch bg, element renderer, thumbnail)`.

## Task 8: Pitch sketcher — sketch-ops + KfSketcherComponent (D-1, D-3)

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/drills/sketch/sketch-ops.ts`, `…/sketch-ops.spec.ts`, `…/kf-sketcher.component.ts`, `…/kf-sketcher.component.spec.ts`

- [ ] **Step 1: Write the failing ops specs** (`sketch-ops.spec.ts` — pure, exhaustive): `clampPoint` rounds and clamps to `[16, 844] × [16, 544]` (the prototype margin); `placePoint` appends `{t, x, y}` and auto-numbers players/opps independently (`n = count(sameT) + 1`; cones/balls get no `n`); `drawArrow` returns null under length 18, else appends `{t, x1..y2}`; `drawZone` normalizes min-corner + abs size, null under hypot 18; `moveElementAt` moves points AND zones (sets x/y), is a no-op for arrows (`canMoveAt` false — prototype parity: only `el.x != null` moves); `removeElementAt` drops by index; all functions return NEW arrays (input not mutated).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `sketch-ops.ts`** — pure functions over `DrillSketchElement[]`, header doc-comment carrying the D-1 pin:

```ts
/**
 * sketch-ops — pure gesture mutations on the slice-3 `DrillSketchElement[]`
 * wire shape (860×560 coordinate space, handoff data model).
 *
 * ARCHITECTURE (plan D-1): this module ADAPTS the pack-football board-engine
 * shape (board-ops.ts: pure ops + clamp-from-frame + per-gesture functions)
 * without importing it — the engine lives in scope:pack-football (nx-boundary
 * illegal from this pack) and is id-based, while this wire shape is
 * deliberately id-less/positional. UPGRADE SEAM: when a third board surface
 * appears or this sketcher needs engine-class features (redo, multi-select,
 * domain bindings), extract the domain-free board-engine core to
 * design-system (ADR-168) and re-point both packs.
 */
export const SKETCH_W = 860;
export const SKETCH_H = 560;
export const SKETCH_MARGIN = 16;
export const MIN_DRAW_LEN = 18;
export const SKETCH_UNDO_DEPTH = 24;

export type SketchPointTool = 'player' | 'opp' | 'cone' | 'ball';
export type SketchDrawTool = 'pass' | 'run' | 'zone';
export type SketchTool = 'select' | SketchPointTool | SketchDrawTool | 'erase';

export function clampPoint(x: number, y: number): { x: number; y: number } { /* prototype pt() math */ }
export function placePoint(els: readonly DrillSketchElement[], t: SketchPointTool, x: number, y: number): DrillSketchElement[] { /* auto-number player/opp */ }
export function drawArrow(els: readonly DrillSketchElement[], t: 'pass' | 'run', x1: number, y1: number, x2: number, y2: number): DrillSketchElement[] | null { /* null < MIN_DRAW_LEN */ }
export function drawZone(els: readonly DrillSketchElement[], x1: number, y1: number, x2: number, y2: number): DrillSketchElement[] | null { /* normalize; null < MIN_DRAW_LEN */ }
export function canMoveAt(els: readonly DrillSketchElement[], i: number): boolean { /* 'x' in el */ }
export function moveElementAt(els: readonly DrillSketchElement[], i: number, x: number, y: number): DrillSketchElement[] { }
export function removeElementAt(els: readonly DrillSketchElement[], i: number): DrillSketchElement[] { }
```

- [ ] **Step 4: Run ops specs → PASS.**
- [ ] **Step 5: Write the failing component specs** (stub the svg's `getBoundingClientRect` → `{left: 0, top: 0, width: 860, height: 560}` so client coords ≡ board coords). Cases:
  - tool rail: 9 tool buttons (`select/player/opp/cone/ball/pass/run/zone/erase`) + divider + undo + clear, all native buttons ≥ 24px with `aria-pressed` ONLY on the active tool (default tool `player`, prototype parity), labelled via i18n `title` + `aria-label`;
  - click with `player` places a numbered player and emits `sketchChange`; two players → n 1, 2;
  - drag (pointerdown→move→up, dist ≥ 18) with `pass` draws a dashed arrow; dist < 18 and > 6 → discarded;
  - **click-click (D-3):** press-release without movement under `pass` sets an anchor (announced via the live region); second click ≥ 18 away commits the arrow; second click < 18 cancels; Escape cancels the anchor;
  - `select`: pointerdown on an element + drag moves it (one undo step per completed move — history pushed at drag start); **click-select then click-empty-pitch moves it there (D-3)**; arrows are not movable;
  - `erase`: pointerdown on an element removes it; pitch clicks in erase mode do nothing;
  - element focus + **Delete/Backspace removes** the focused element (announced);
  - undo: history capped at `SKETCH_UNDO_DEPTH` (place 26 elements → 24 undos available); undo restores the prior array and emits; clear empties and is undoable;
  - the svg has an `aria-label`, `aria-describedby` pointing at visible keyboard-help text, and a polite live region announces place/draw/move/delete/undo/clear;
  - `sketch` input changes from the host (editor load) reset the working state + history.
- [ ] **Step 6: Run → FAIL.**
- [ ] **Step 7: Implement `kf-sketcher.component.ts`** — standalone, OnPush, signals; `input sketch: readonly DrillSketchElement[]`, `output sketchChange`; internal `els` signal (synced from the input via an effect that also clears history — the engine `begin()` semantic), `tool` signal, `selectedIndex` signal, `anchor` signal (click-click draw state), drag state (draw `{x1,y1,cur}` | move `{i}`), `history: DrillSketchElement[][]` capped at 24 (`pushHist` before each commit; move pushes at drag START — the prototype + BoardEditorStore transient lesson), `commit(next)` = pushHist + set + emit + announce. Pointer handlers per D-3 (pointerdown/move/up/leave on the svg; `pointerdown` handlers + `tabindex="0"` + `(keydown)` on element `<g>` wrappers; generous transparent hit shapes: 20px circles on points/zones, 16px-wide lines on arrows — `sketcher.jsx:107-109`). Renders `<svg viewBox="0 0 860 560">` composing `libKfPitchBg` + per-element `<g>` wrappers each containing `libKfSketchEls [els]="[el]"`; drag/anchor preview renders the in-flight arrow/zone. Cursor per tool (crosshair/grab/not-allowed). Tool rail + undo/clear column on the left (38px buttons, active = ink bg + accent-bright icon; inline SVG glyphs ported from `SK_TOOLS`, `sketcher.jsx:6-16`). Keyboard-help line + legend under the pitch (`sketcher.jsx:116-119`) extended with the click-click hint. i18n keys `kf.sketch.*` (tool names, undo, clear, announcements, kbdHelp, legend).
- [ ] **Step 8: Run → PASS** (`npx nx test pack-kids-football-ui`), then lint.
- [ ] **Step 9: Commit** — `feat(exercir): kids-football S4 — pitch sketcher (pure sketch-ops + 24-step undo + click-click drag alternatives)`.

## Task 9: Routes restructure + role-gated shell nav + role-dependent sign-in landing

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/routes.ts`, `lib/shell/kf-shell.component.ts` (+ spec), `lib/auth/sign-in-page.component.ts` (+ spec), `lib/kf-i18n.ts`

- [ ] **Step 1: Write the failing tests.**
  - Routes: a shell wrapper route (path `''`, `canActivate: [authGuard]`, loads `KfShellComponent`) now carries children `admin` (the existing ClubAdminShell subtree — **URLs unchanged**: `/admin/members` etc. still resolve), `drills` (DrillLibraryPage), `drills/new` (DrillEditorPage), `drills/:id` (DrillEditorPage — `new` declared BEFORE `:id`); `sign-in`/`setup` stay outside; the root `''` full-match redirect to sign-in still wins for the bare URL.
  - **Depth-shift regression (the hoist's real risk — spec it hard):** moving the shell from `path: 'admin'` to `path: ''` changes the route-tree depth, which shifts (a) the shell's `:tenant` paramMap fallback chain (`kf-shell.component.ts:314-317` — the number of `.parent` hops changes) and (b) the resolution base of the shell's current RELATIVE `routerLink="members"` (`kf-shell.component.ts:208` — it would now resolve to `/members`, not `/admin/members`). Spec cases: signOut from the hoisted shell still navigates to the tenant-scoped sign-in (`:tenant` resolves at the new depth); every shell nav link targets an ABSOLUTE `['/t', tenant, …]` array (no relative links survive the hoist); an `/admin/members` deep link still renders the members tab under the moved tree.
  - Shell spec: with a `coach` session — a "Drills" nav link renders (absolute array `['/t', tenant, 'p', 'kids-football', 'drills']`) and NO "Club" link; with `club-admin` — both render; with `team-manager` — neither; with `assistant-coach` — Drills only.
  - Sign-in spec: **add explicit per-role landing-target assertions** (the existing spec only asserts `navigate` was CALLED, never the target array — there is no existing target assertion to preserve): coach → `[..., 'drills']`; club-admin → `[..., 'admin', 'members']`; team-manager → `[..., 'admin', 'members']`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `routes.ts` — restructure per the tree above (lazy `loadComponent` for the two new pages; Task 10/11 create them — create minimal placeholder component files in THIS task so the routes compile: selector + `<p>drills</p>` shells, replaced next tasks). `kf-shell.component.ts` — `link(...segments)` helper building absolute arrays from the paramMap fallback chain (the signOut chain, :314-317); nav block:

```html
<nav class="topnav" [attr.aria-label]="msg.navAria">
  @if (canSeeDrills()) {
    <a class="nav-link" [routerLink]="link('drills')">{{ msg.navDrills }}</a>
  }
  @if (isClubAdmin()) {
    <a class="nav-link" [routerLink]="link('admin', 'members')">{{ msg.navClub }}</a>
  }
</nav>
```

  with `canSeeDrills = computed(() => ['coach', 'assistant-coach', 'club-admin'].includes(session()?.role ?? ''))` and `isClubAdmin = computed(() => session()?.role === 'club-admin')` (D-6 rationale comment: team-manager's Calendar/Team nav arrives slices 6/8). `sign-in-page.component.ts` `selectUser` — target by role: `coach | assistant-coach` → `['/t', tenant, 'p', 'kids-football', 'drills']`, else `[..., 'admin', 'members']`. i18n: `kf.shell.nav.drills: 'Drills'`. Update the shell/admin-shell/auth-guard specs the restructure fans out to (mechanical).
- [ ] **Step 4: Run → PASS** (`npx nx test pack-kids-football-ui`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — shell wrapper route + role-gated nav + role-dependent landing`.

## Task 10: Drill library page (THE coach home)

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/drills/kf-phase-tag.component.ts`, `…/kf-intensity-dots.component.ts`, `lib/drills/drill-library-page.component.ts` (replaces the Task-9 placeholder), `…/drill-library-page.component.spec.ts`
- Modify: `lib/kf-i18n.ts`

- [ ] **Step 1: Write the failing tests.**
  - `KfPhaseTagComponent`: input `phase`; renders the phase name in a pill tinted by the handoff phase color (Warm-up `#E8A93C` / Technical `#4C9BD6` / Game `#5BA864` / Cool-down `#9C8DC9`).
  - `KfIntensityDotsComponent`: input `level (1–5)`; renders 5 skewed squares (`skewX(-12deg)`), first `level` filled accent, rest line-tinted; sr-only text "Intensity {level} of 5"; decorative squares `aria-hidden`.
  - Library page (stub store + client): `ngOnInit` calls `store.loadDrills()` (the initial-load regression guard); header renders title + count line ("{n} drills · shared with your club") + a "+ New drill" button navigating to `drills/new` (absolute array); search input (260px, labelled) filters by name case-insensitively; focus chips ("All" + `KF_DRILL_FOCUS_AREAS`, `aria-pressed`, single-select) filter by `d.focus`; the grid (`repeat(auto-fill, minmax(280px, 1fr))`, gap 14) renders one card button per drill — thumbnail (`lib-kf-sketch-thumbnail` with `ariaLabel` null — the card button carries the name), name 15.5/700, phase tag, meta line "{focus} · {min}′ · {players}", intensity dots; clicking a card navigates to `drills/{id}`; a polite live region announces "{shown} of {total} drills shown" on filter changes (the drill-arc 4.1.3 pattern); zero matches → the dashed empty state ("No drills match — try another search, or create one."); `drillsError` renders the error line.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (standalone + signals + OnPush; `search` signal + `focusFilter` signal; `shown = computed(...)`; `styleUrls: ['../club-grass.css']` on `:host` — NO global skin load, ex#246 canonical-not-loaded; all interactive targets ≥ 24px; card buttons are real `<button>`s with the drill name as accessible text). i18n keys `kf.drills.title`, `kf.drills.count`, `kf.drills.new`, `kf.drills.searchLabel`, `kf.drills.searchPlaceholder`, `kf.drills.filterAria`, `kf.drills.all`, `kf.drills.shown`, `kf.drills.empty`, `kf.drills.intensity`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drill library page (search, focus chips, thumbnail card grid)`.

## Task 11: Drill editor page (screen 4 — sketch-first, expected-effect card)

**Files:**
- Create: `lib/drills/drill-editor-page.component.ts` (replaces the Task-9 placeholder), `…/drill-editor-page.component.spec.ts`
- Modify: `lib/kf-i18n.ts`

- [ ] **Step 1: Write the failing tests** (stub client/store/router; route param `id` vs the `new` URL).
  - **Load:** `/drills/new` → blank model (prototype defaults: focus `Passing`, phase `Technical`, age `U9`, min 12, equipment `['Cones','Balls']`, intensity 3, one empty coaching-point row, empty sketch); `/drills/:id` → loads the drill (via `store.drills()` or `loadDrills()` on deep link) and populates every field incl. the sketch passed to the sketcher; unknown id → error state + back link.
  - **Layout/a11y:** sr-only `h1` (`tabindex="-1"`) receives focus on init (the wizard heading-focus convention); sticky header with "← Drill library" back link, the name as a large display-font inline input (labelled, placeholder "Name this drill…"), Delete (only when editing) / Cancel / Save buttons all ≥ 24px; right column renders focus chips (single-select over `KF_DRILL_FOCUS_AREAS`, out-of-catalog current value rendered as an extra chip — D-6), phase + age selects, duration stepper (−/+ buttons clamping 2–45, value announced), players input, equipment toggle chips (`aria-pressed`), intensity picker (5 buttons 1–5, `aria-pressed`, label text), organisation textarea, coaching points numbered rows (add via "+ Add", remove ✕ ≥ 24px with `aria-label`), and the **expected-effect highlighted card** — `data-testid="kf-effect-card"` with bg `color-mix(in oklab, var(--cg-accent, #2f8a4e) 14%, var(--cg-card, #ffffff))`, `1.5px solid color-mix(in oklab, var(--cg-accent, #2f8a4e) 55%, var(--cg-card, #ffffff))` border, radius 12, uppercase display-font label, borderless textarea with the handoff placeholder ("What should change in the players — ideally measurable…").
  - **Enabled-submit (D-6):** Save stays enabled; clicking with an empty name renders the `role="alert"` inline error and focuses the name input — no API call; with a valid model: NEW → `client.createDrill(payload)` (payload parses `CreateDrillInputSchema`; empty coaching-point rows filtered out) then navigates to `drills`; EDIT → `client.updateDrill(id, payload)` then navigates; `aria-busy` + busy label while pending; API failure → `role="alert"` via `mapKfError`, no navigation.
  - **Sketch:** the sketcher's `sketchChange` updates the model; the saved payload carries the edited sketch.
  - **Delete:** the Delete button opens a confirm modal (focus-trapped via `trapTabKey`/`focusFirstField`, restore via `restoreFocus`, `aria-labelledby`); confirming calls `client.deleteDrill(id)` and navigates to `drills`; cancel restores focus to the Delete button.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (standalone + OnPush; reactive `FormGroup` for name/focus/phase/age/min/players/organisation/effect + signals for `equipment: string[]`, `points: string[]`, `intensity`, `sketch: DrillSketchElement[]`; `toSignal(valueChanges)` for any form-derived signal — never `computed()` over `.value`; left/right flex layout, right column 430px fixed; `styleUrls: ['../club-grass.css']`). i18n keys `kf.editor.*` (back, namePlaceholder, nameError, save, create, cancel, delete, deleteConfirmTitle, deleteConfirmBody, deleteConfirm, deleteCancel, saving, focus, phase, age, duration, players, playersPlaceholder, equipment, intensity, organisation, organisationPlaceholder, points, pointsAdd, pointsRemove, pointPlaceholder, effectLabel, effectPlaceholder, loadError, createFailed).
- [ ] **Step 4: Run → PASS**, then full `npm run ci:local`.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S4 — drill editor (sketch-first layout, expected-effect card, delete-confirm)`.

## Task 12: Slice gate + browser run-through + story issue + PR

- [ ] **Step 1:** `npm run ci:local` green; `npm run test:db` green (regression — proof set unchanged, no migration).
- [ ] **Step 2: Manual browser run-through** (kill any orphan :3150 PID first; API :3150 in-memory mode + host app `pack-football-visual-editor` :4200; NEVER pipe the serve through `head`):
  1. Sign in as **coach Bruno** (`/t/a1b2c3d4-0001-4abc-8001-0000c1ab0001/p/kids-football/sign-in`) → lands on a **POPULATED `/drills`** (8 starter drills, thumbnails rendering real sketches); nav shows Drills, NOT Club. **Screenshot the library grid → `de-braighter/docs/club-grass-drill-library-s4-proof.png`.**
  2. Search "rondo" → 1 card; clear; filter chip "Passing" → Passing Gates + Rondo 4v1; live count announces.
  3. Open "Passing Gates" → editor loads all fields + sketch; **edit the sketch**: place a player (auto-numbered 3), draw a pass (drag), undo (pass gone), redraw via **click-click** (anchor → commit); **screenshot the editor → `de-braighter/docs/club-grass-drill-editor-s4-proof.png`.** Save → back on the library, the thumbnail reflects the edit.
  4. "+ New drill" → blank editor; fill name "Gate Dribble Relay", focus Dribbling, duration 14, an expected effect; sketch 2 players + a zone; Save → card appears (9 drills).
  5. In-editor delete: open the new drill → Delete → confirm modal (focus trapped) → confirm → library back to 8.
  6. **Role regression:** sign out → sign in as **team manager Clara** → NO Drills nav, lands on `/admin/members`; direct-URL `/drills` renders but the list call 403s (error line) — and `POST` is server-blocked (403 proven in e2e); sign in as **admin Anna** → Drills AND Club nav both present.
  7. **Club isolation:** club B admin David → `/drills` shows B's 8 starters only (not A's edits).
  8. **Slice-3 wizard smoke:** "Set up a new club" → minimal wizard run → created club's library shows the 8 starters (onboarding seed path untouched).
- [ ] **Step 3:** Create the story issue on `de-braighter/exercir` (mirror #248's shape: scope bullets + acceptance = this plan's goal, naming D-1/D-2/D-3). Push `feat/kids-football-s4-drills`; open the PR with `Closes #<story>`, `Producer: orchestrator/claude-fable-5 [subagent-driven-development, writing-plans]`, `Effort: deep`, `Effect: cycle-time 0.01±0.01 expert`, `Effect: findings 6±3 expert`, and PR-body notes: *"F1 event-log posture (#245): extended the doc-comment posture to drill update/delete — #245 stays open"* + *"Design §7 deviation (plan D-1): sketcher adapts the board-engine architecture, imports nothing — nx scope boundary + id-less wire shape; upgrade seam = design-system extraction per ADR-168"* + *"#251: GUC-const dedup folded; club @@index drop not folded (no migration); wizard untouched."*
- [ ] **Step 4:** Verifier wave (`local-ci` + `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer`, all `isolation: "worktree"`, prompts forbidding git ops in shared clones, PR head readable in the dedicated worktree). The **qa-engineer prompt names D-3 verbatim** (2.5.7 satisfied via click-click; keyboard canvas placement = documented exemption matching the pack-football precedent, follow-up tracked). The **exercir-charter-checker prompt names**: no new outbound path (demo_mode anchor unaffected), `subjectSensitivity` still not firing (authored coaching content, arms slice 7/8 — then set `PackManifest.subjectSensitivity` per the #249 note), D-2 stub seed is demo fixture data. Fix blockers → `npm run dev -- drain de-braighter/exercir#<pr>` → `post-findings` (FULL `de-braighter/exercir#<pr>` form, severities `blocking|should-fix|nit|note`, lines that exist in the diff) → merge → `backfill` → `reconcile` → `ritual:post-merge`. New non-blocking findings → a fresh follow-ups issue (mirror #251), including the D-3 keyboard-nudge upgrade seam.

---

## Carry-forwards honored (and explicitly NOT in scope)

- **exercir#245 (F1 event-log):** posture extended to drill update/delete via doc comments (D-4); the PR body says so; #245 stays open.
- **exercir#251:** GUC-const dedup folded (Task 3); club `@@index` drop NOT folded (no migration this slice); wizard extraction NOT triggered (wizard untouched).
- **i18n:** en-only `kf-i18n.ts` extension (`kf.drills.*`, `kf.sketch.*`, `kf.editor.*`, `kf.shell.nav.drills`); de/en split stays tracked (ADR-012).
- **Published skin (ex#246):** canonical-not-loaded — all new pages use the pack's `:host` `--cg-*` literal projection (`club-grass.css`); NO global skin load in the shared host; the parity spec guards the palette.
- **demo_mode anchor (charter §2 D7):** slice 4 ships NO outbound path — nothing new fires; the editor adds none.
- **`subjectSensitivity 'developmental-minor'`:** does NOT fire — drills are authored coaching content, not inferred player state. Arms at slice 7/8; when it fires, set `PackManifest.subjectSensitivity` so the ADR-187/188/189 gates engage (#249 charter-checker note).
- **Substrate:** ^2.0.0 as pinned, auth/tenant/RLS surface only; 2.1.0 is in range but NOTHING new is adopted; zero kernel/inference; drill data stays pack tables + JSONB; the expected-effect field stays plain pack data (design §5) — the kernel effect-declaration promotion remains the named, demand-driven seam.
- **Expected-effect subject-sensitivity boundary (pinned, plan-wave clarification):** the `effect` field is **drill-template data only** — the coach's planning intent for the exercise, never a per-player observation. Any future slice that would co-locate a player identifier with effect text in a stored row (e.g. `{drillId, playerId, effectText}` — run-session effect checks are the first candidate, slice 7) makes that row minor-subject-sensitive AT THAT SLICE: set `PackManifest.subjectSensitivity` then, regardless of the nominal slice-7/8 arming point. The slice-5/6/7 plans must declare this boundary explicitly for their charter checks.
- **Drill→template cascade:** slice-5 territory; doc-comment seam on `DeleteDrillService` (D-6).

## Self-review notes (author)

- **Spec coverage:** design §8 slice-4 row (drill CRUD + SVG sketcher reusing the board engine per §7 + expected-effect card) → Tasks 3–5 (CRUD), 7–8 (sketcher, with the §7 reuse question resolved as D-1's sanctioned deviation), 11 (effect card); handoff screen 3 verbatim (header+count+New, 260px search, focus chips, minmax(280px,1fr) grid, thumbnail/name/phase/meta/intensity-dots cards, empty state) → Task 10; screen 4 verbatim (sticky header w/ display-font name input + Delete/Cancel/Save, left sketcher, right 430px column incl. the highlighted effect card) → Task 11; the sketcher interaction spec (tool rail glyphs, click-place, drag-draw min 18, select-drag move w/ 20px/16px hit areas, erase, 24-step undo, clear, cursors) → Task 8 (+ D-3 click-click additions); permissions + nav table → Tasks 1, 9; design question 2 → D-2 + Task 5; design question 3 → D-3 + Task 8 + the Task-12 wave prompt.
- **Placeholder scan:** code blocks are complete where code is the deliverable; layout-heavy Angular templates specify exact tokens/sizes/behaviors + the prototype line references the implementer recreates (the slice-2/3 plan convention for screen recreation against an in-repo visual prototype).
- **Type consistency:** `UpdateDrillPatch`/`findById`/`update`/`delete` defined in Task 3, consumed in Tasks 4–5; `CreateDrillInputSchema`/`KF_DRILL_FOCUS_AREAS` defined in Task 2, consumed in Tasks 4 (service validation), 10 (chips), 11 (payload + chips); `DrillSketchElement` is the slice-3 contracts type everywhere (sketcher input/output, thumbnail input, ops signatures); `seedDemoDrills` defined and called in Task 5; the `'assistant-coach'` union lands in Task 6 BEFORE the Task-9 nav predicate references it; `KfSketcherComponent` (Task 8) is consumed by Task 11; `lib-kf-sketch-thumbnail` (Task 7) by Tasks 10–11.
- **No fat kernel:** zero kernel concepts; drills are pack tables + JSONB; thumbnails/sketches are derived presentation (never persisted beyond the `sketch` JSONB the handoff pins); permissions ride the existing manifest/PolicyEngine surface; the substrate surface is untouched.
