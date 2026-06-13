# Exercir kids-football MVP — Slice 5 (templates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reusable **session templates** — a routed `/templates` list (cards with a phase-colored budget bar + first-3-drills summary) and a `/templates/new|:id` sequence builder (sticky header, 400px searchable drill library with mini sketches + "+", reorderable sequence rows with per-item minute steppers, footer phase-colored time-budget card that warns-but-allows over-budget) on a complete template vertical — `create`/`update`/`delete`/`removeDrillReferences` on the ONE portable contract suite, `Result<T,E>` use-cases, RBAC'd HTTP endpoints, template permissions in the manifest, a new `kids_football.template` table with RLS, and the **drill→template cascade** the slice-4 seam pinned — with role-gated shell navigation.

**Architecture:** Everything lands in the four EXISTING projects (`libs/pack-kids-football-contracts`, `libs/pack-kids-football`, `apps/pack-kids-football-api`, `libs/pack-kids-football-ui`) — no new nx project, no new workspace `package.json` (lockfile risk ≈ 0). **One DB migration** creates `kids_football.template` (items as JSONB) and folds exercir#251's redundant `club @@index` drop. The template vertical mirrors the slice-4 **drill** vertical exactly (port + two impls on one contract suite, Result use-cases, drills-style RBAC controller, store-backed UI load — **no `GET :id` endpoint**), plus one new primitive: `removeDrillReferences` (the cascade). Budget totals are DERIVED on read (ADR-176) — never persisted.

**Tech Stack:** Angular (standalone + signals + reactive forms) + NestJS + Prisma/Postgres, Nx + vitest, `@de-braighter/substrate-{contracts,runtime}@^2.0.0` as already pinned (auth/tenant/RLS surface only — no kernel/inference).

**Repo:** `domains/exercir`. **Branch:** `feat/kids-football-s5-templates` off `origin/main` in a **fresh worktree `domains/exercir-wt-kf-s5`**. Create it manually (a parent `isolation:worktree` worktrees the WORKBENCH, not exercir):

```bash
cd domains/exercir
git fetch origin && git worktree add ../exercir-wt-kf-s5 -b feat/kids-football-s5-templates origin/main
cd ../exercir-wt-kf-s5
GITHUB_TOKEN=ghp_… npm ci          # @de-braighter/* come from GitHub Packages (read:packages)
npm ls @de-braighter/substrate-runtime   # expect 2.0.0
```

Work entirely in `../exercir-wt-kf-s5` so the running `:4200`/`:3150` dev servers on the main clone stay untouched. **Gate:** `npm run ci:local` + `npm run test:db`.

**Design sources of truth:** `docs/superpowers/specs/2026-06-13-exercir-kids-football-s5-templates-design.md` (this slice's design + the resolved forks) · `docs/design/exercir-mvp-handoff/README.md` screen 5 ("Templates list + builder") + the data model + "Deletions cascade" · prototype `docs/design/exercir-mvp-handoff/exercir/proto/templates.jsx` (list + builder layout, `phaseBar`, budget card).

---

## Design decisions (resolved at plan time — pinned)

### D-1. Permissions = mirror drills; nav = coach + assistantCoach only (founder decision, design §2.1–2.2)

`templateRead` + `templateWrite`. `coach` and `assistantCoach` both get **both** (mirrors the slice-4 drill grants); `clubAdmin` inherits both via `Object.values(P)`; `teamManager`/`facilities` get **neither**. The **nav** link shows for `coach` + `assistantCoach` ONLY — NOT `clubAdmin` (who holds the permission but lives on the Club tabs). This is a deliberate asymmetry vs `canSeeDrills()` (which includes `club-admin`); a doc comment on `canSeeTemplates()` pins it so it is not "fixed". Resolves the handoff-vs-kickoff contradiction (handoff: "assistant coach = coach minus Templates"; kickoff + founder: mirror drills) in favour of mirror-drills.

### D-2. Cascade = remove the item; emptied templates persist; NO event arm; NO stub-club template seed (design §2.3)

- Deleting a drill removes its `{drillId, min}` items from every template in the active tenant (handoff "drill → removed from templates"). If a template ends up with **0 items it persists** — passive reconciliation is not a user-save, so the `items.length ≥ 1` invariant (enforced only at the create/update use-cases) does NOT apply; the coach sees "0 drills" and re-adds. We do **not** auto-delete templates and do **not** tombstone. The builder renders "Missing drill" defensively for any transient gap.
- The cascade's **event arm stays deferred to slice 6** (no event table yet). The `DeleteDrillService` seam comment is updated to say "template-items cascaded (slice 5); scheduled-event cascade arrives slice 6 with the event table".
- **No stub-club template seed** (unlike slice-4 drills, which needed a populated library to demo the coach home). An empty template list is the honest first-run state and has a designed empty-state card; the browser run-through builds one. This decouples template seeding from the minted drill ids — avoiding a fragile seed-ordering dependency.

### D-3. Budget is derived-on-read; the schema allows empty `items`; the ≥1 invariant lives in the use-cases (design §2.4, §4.1)

- `total = Σ items.min`, `over = total > targetMin`, `overBy`/`spare` — all derived by the pure `summarizeTemplateBudget(items, targetMin)` in contracts (ADR-176; never persisted). The helper is **color-free** — the UI maps phase→color.
- `TemplateSchema.items` is `z.array(TemplateItemSchema)` (allows `[]`) so a cascade-emptied template still **parses on read**. The "needs ≥1 drill" rule is enforced at the `CreateTemplate`/`UpdateTemplate` use-cases, NOT the schema.
- `items` is left **unbounded** (no `.max()`), matching the drill vertical's unbounded `equipment`/`points`/`sketch` arrays — the array-upper-bound rule (slice 3) applies to `@Public` endpoints only; template endpoints are auth'd.

### D-4. No `GET :id` endpoint / `GetTemplate` use-case — the builder loads via the store (mirrors the drill editor, design §4.3–4.4)

The drill editor loads a single drill via `store.drills().find(id)` → `loadDrills()` fallback → re-find, and `drills.controller.ts` has no `GET :id`. The template builder mirrors this exactly: `store.templates().find(id)` → `loadTemplates()` fallback → re-find, with load-error vs not-found distinguished via `templatesError`. `TemplateRepository.findById` exists only as the internal primitive `Update`/`Delete` services use.

### D-5. exercir#251 nit — fold ONLY the `club @@index` drop (this slice ships a migration)

The redundant `@@index([tenantPackId])` on the `Club` model produces `club_tenant_pack_id_idx`, which the `@@unique([tenantPackId])` index (`club_tenant_pack_id_key`) already covers for lookups. This slice ships a migration anyway, so the drop is folded: `DROP INDEX IF EXISTS "kids_football"."club_tenant_pack_id_idx";` + remove the `@@index([tenantPackId])` line from the `Club` model. The other #251/#255 nits are NOT folded (out of this slice's natural touch).

### D-6. exercir#245 (F1 event-log posture) — extend the doc-comment posture to the new mutations

Template `create`/`update`/`delete`/`removeDrillReferences` are NEW pack mutations. Per slices 1–4: **extend #245's documented posture** (doc comments: "this mutation carries no F1 event-log write; tracked in exercir#245") rather than wiring F1. The PR body states this; #245 stays open.

### D-7. subjectSensitivity stays unset (charter, design §2.5)

Templates carry drill-template effect data only (`targetMin` + ordered `{drillId, min}`) — no per-player inferred state. `PackManifest.subjectSensitivity` stays unset. Re-stated trigger for slices 6/7: the moment a slice surfaces *inferred player state*, set `subjectSensitivity: 'developmental-minor'` in that same red→green pass.

### D-8. Other pinned deviations

- **Enabled-submit (house pattern, vs handoff "save needs name + ≥1 drill disabled"):** Save stays ENABLED; clicking with no name or 0 items renders the inline `role="alert"` and focuses the first problem (drill-editor + wizard convention).
- **Budget bar denominator = `max(targetMin, total)`** for BOTH the list card bar and the builder budget card (non-overflowing). Minor deviation from the prototype's list bar (`min / max(target, 1)`, which clips on overflow) — the non-overflowing form is more correct and the two surfaces stay consistent.
- **Phase colors extracted to a shared `KF_PHASE_COLORS`** (`drills/kf-phase-colors.ts`) — the private `PHASE_COLORS` const in `kf-phase-tag.component.ts` is promoted to an exported map so the budget bar and the phase tag share one source (DRY).
- **`▲▼` reorder buttons only** (no drag-and-drop) — prototype parity + keyboard-accessible by construction.
- **Single `create` port method** (not `createMany`) — templates have no bulk-insert need (no starter-template seed, D-2).

---

## Pre-flight (read before Task 1)

The implementer of each task must read the slice-4 **drill** reference files for its layer and mirror their structure (adapt names; do NOT copy comments verbatim):

- **Drill vertical (the exact template mirror):** `libs/pack-kids-football-contracts/src/drills.ts` (DrillSchema + `CreateDrillInputSchema` + barrel) · `libs/pack-kids-football/src/out-ports/drill.repository.ts` (port + in-memory impl, no-nullable-scalar update) · `…/drill.repository.contract.ts` (the portable suite shape) · `…/drill.repository.spec.ts` (in-memory harness) · `src/out-adapters/prisma-drill.repository.ts` (TENANT_RUNNER, GUC read-back via `prisma-guc.ts`'s `CURRENT_TENANT_PACK_ID_SQL`, `isValidUuid`, presence-driven update `data`, `updateMany`/`deleteMany` count-0, `rowTo…` mapper) · `…/prisma-drill.repository.contract.spec.ts` (fake-delegate harness + DB-gated block) · `out-ports/tenant-runner.port.ts:368-487` (drill row/create/update/delegate types + `TenantScopedClient.drill` — mirror for `template`) · `out-adapters/testing/stub-delegates.ts`.
- **Use-cases + controller:** `in-ports/{list,create,update,delete}-drill.use-case.ts` (Result types + Symbol tokens) · `application/{list,create,update,delete}-drill.service.ts` (CreateDrillInputSchema parse → first-issue invalid-input; update: findById→merge→validate-merged→repo.update→null⇒not-found) · `application/delete-drill.service.ts` (the cascade seam — Task 6 edits this) · `apps/pack-kids-football-api/src/app/drills.controller.ts` (the RBAC controller to copy) · `…/drills.e2e.spec.ts` (e2e harness) · `…/pack-kids-football.module.ts` (provider + token-export block, `inMemoryRepoProviders`, `SHARED_DRILL_STORE_MAP`) · `…/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS` list).
- **UI:** `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (drill methods — buildHeaders + per-endpoint zod parse) · `lib/data/kf-club-store.ts` (`loadDrills` + per-collection error signal + sign-out clear effect) · `lib/routes.ts` (drills routes; `new` before `:id`) · `lib/shell/kf-shell.component.ts:296-302` (`canSeeDrills`/`isClubAdmin` nav predicates + `link(...)` builder) · `lib/drills/drill-library-page.component.ts` (search + chips + grid + `lib-kf-sketch-thumbnail` decorative usage + `ngOnInit` load) · `lib/drills/drill-editor-page.component.ts` (sticky header, enabled-submit `save()`, store-backed `loadDrill` with loadFailed/notFound precedence, focus-trapped delete modal via `kf-modal-focus`) · `lib/drills/kf-phase-tag.component.ts` (`PHASE_COLORS` to extract) · `lib/drills/kf-intensity-dots.component.ts` (`[level]` input) · `lib/drills/sketch/kf-sketch-thumbnail.component.ts` (`[sketch]`/`[ariaLabel]`) · `lib/kf-i18n.ts` (`kfMsg`/`kfMsgN`/`kfMsgSubst`).

**Battle-tested gotchas to honor (slices 1–4 memory):**
- **Test executor:** `@nx/angular:unit-test` (UI lib `test` target) REJECTS `--include`/`--run`/positional spec filters — run the full project suite: `NX_DAEMON=false npx nx test <project>`. `NX_DAEMON=false` avoids daemon-lock with the main clone's running servers.
- Browser run-through catches what unit layers can't — **always `loadX()` on `ngOnInit`** (component specs stub a pre-populated store, hiding the gap); parse **PER-ENDPOINT** response shapes (list vs single).
- Kill any orphan `:3150` PID before serving (`Get-NetTCPConnection -LocalPort 3150`). NEVER pipe a background `nx serve` through `head -N` (SIGPIPE kills it — redirect to a file).
- Extending `TenantScopedClient`/delegate interfaces fans out mechanical edits to every sibling spec literal + `stub-delegates.ts` — budget for it.
- `toSignal(control.valueChanges)` not `computed()` over `control.value`. Absolute `['/t', tenant, …]` routerLink arrays via `resolveTenantFromRoute` (never relative). ONE `ACTIVE_TENANT_FN`/`inMemoryRepoProviders` token per module. zod chain order `.max(…).default(…)`.
- `$queryRawUnsafe` surfaces UNIQUE violations as P2010 / SQLSTATE 23505 (not P2002) — not relevant here (no template uniques) but keep in mind for the cascade write-back.
- No workspace `package.json` change expected — if one happens, re-run `npm install` and commit the lockfile in the same commit.
- devloop ritual later: `post-findings` uses the FULL `de-braighter/exercir#NN` form + the Write tool for JSON (PowerShell BOM breaks its parse); severity enum is `blocking|should-fix|nit|note` (no `info`); `backfill` takes `de-braighter/exercir` (OWNER/REPO, NO `#PR`); `drain`/`reconcile`/`post-findings` take `exercir#NN`. Run devloop via `npx tsx src/cli.ts …` (npm→bash relay dies on this box).

## File structure (created/modified in this slice)

| File | Responsibility | Task |
|---|---|---|
| `libs/pack-kids-football-contracts/src/roles.ts` (+ spec) · `libs/pack-kids-football/src/manifest/pack-manifest.ts` (+ spec) | templateRead/templateWrite (10→12) + coach/assistantCoach grants | 1 |
| `libs/pack-kids-football-contracts/src/templates.ts` (+ spec) · `src/index.ts` | TemplateSchema, TemplateItemSchema, CreateTemplateInputSchema, `summarizeTemplateBudget` | 2 |
| `prisma/packs/kids-football.prisma` · `prisma/migrations/20260613120000_kids_football_template/migration.sql` | `Template` model + table/RLS; folded `club @@index` drop (#251) | 3 |
| `libs/pack-kids-football/src/out-ports/template.repository.{ts,contract.ts,spec.ts}` · `out-ports/tenant-runner.port.ts` · `out-adapters/prisma-template.repository.ts` (+ contract spec) · `out-adapters/testing/stub-delegates.ts` · `src/index.ts` | port + in-memory + Prisma on ONE contract suite (incl. `removeDrillReferences`) + template delegate | 4 |
| `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-template.use-case.ts` · `src/application/*-template.service.ts` (+ `template-use-cases.spec.ts`) · `src/index.ts` · `apps/…/pack-kids-football.module.ts` | Result<T,E> use-cases + DI wiring | 5 |
| `libs/pack-kids-football/src/application/delete-drill.service.ts` (+ its spec) | drill→template cascade wiring (D-2) | 6 |
| `apps/pack-kids-football-api/src/app/templates.controller.ts` · `…/templates.e2e.spec.ts` · `pack-kids-football-auth.bootstrap.ts` | RBAC endpoints + e2e (403 matrix + cascade) | 7 |
| `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec) · `lib/data/kf-club-store.ts` (+ spec) | template client methods + store collection | 8 |
| `lib/routes.ts` · `lib/shell/kf-shell.component.ts` (+ spec) · `lib/kf-i18n.ts` | templates routes + `canSeeTemplates()` nav | 9 |
| `lib/drills/kf-phase-colors.ts` (NEW) · `lib/drills/kf-phase-tag.component.ts` · `lib/templates/template-list-page.component.ts` (+ spec) | shared phase-color map + list page | 10 |
| `lib/templates/template-builder-page.component.ts` (+ spec) · `lib/kf-i18n.ts` | sequence builder + budget card | 11 |
| — | Slice gate, browser run-through, story issue, PR, wave, ritual | 12 |

---

## Task 1: Template permissions + manifest (10→12)

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/roles.ts` (+ `roles.spec.ts` if it asserts counts), `libs/pack-kids-football/src/manifest/pack-manifest.ts`, `…/pack-manifest.spec.ts`

- [ ] **Step 1: Write the failing specs.** In `pack-manifest.spec.ts` (mirror the slice-4 edits):
  - rename `'declares all 10 permissions…'` → `'declares all 12 permissions, each prefixed kids-football.'` (body is `toEqual(Object.values(KF_PERMISSIONS))` — order-driven, goes red until the manifest matches);
  - rename `'grants clubAdmin all 10 permissions'` → `…all 12…` (body unchanged — `Object.values`);
  - `'grants coach reads + drill authoring'` → extend the expected array to `[memberRead, teamRead, resourceRead, slotRead, drillRead, drillWrite, templateRead, templateWrite]`; same for assistantCoach;
  - ADD `'grants teamManager and facilities NO template permissions'` — both roles `not.toContain(templateRead)` and `not.toContain(templateWrite)`.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx run-many -t test --projects=pack-kids-football-contracts,pack-kids-football`.
- [ ] **Step 3: Implement.** `roles.ts` — append to `KF_PERMISSIONS` (order matters — the manifest spec asserts `Object.values` order):

```ts
  drillRead: 'kids-football.drill.read',
  drillWrite: 'kids-football.drill.write',
  templateRead: 'kids-football.template.read',
  templateWrite: 'kids-football.template.write',
```

  Update the `KF_PERMISSIONS` doc comment ("template read+write added in slice 5; event permissions arrive in slice 6"). `pack-manifest.ts` — two new permission entries appended (matching `Object.values` order):

```ts
    { id: P.templateRead, displayName: 'Read training templates' },
    { id: P.templateWrite, displayName: 'Create and edit training templates' },
```

  Append `P.templateRead, P.templateWrite` to BOTH `coach` and `assistantCoach` permission arrays, with the pinned rationale:

```ts
      // Template-grant rationale (slice 5, founder decision — design §2.1):
      // templates MIRROR drills — coach AND assistant coach both author
      // templates, so both get templateRead + templateWrite. teamManager /
      // facilities get NEITHER. (The Templates *nav* shows for coach +
      // assistant coach only — NOT clubAdmin, who holds the permission via
      // Object.values but lives on the Club tabs; see canSeeTemplates().)
```

  clubAdmin inherits both via `Object.values(P)` (no edit). teamManager/facilities unchanged. Update the manifest header doc ("Slice 5 scope additions: template read+write").
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-contracts/src/roles.ts libs/pack-kids-football/src/manifest/pack-manifest.ts libs/pack-kids-football/src/manifest/pack-manifest.spec.ts` then `git commit -m "feat(exercir): kids-football S5 — templateRead/templateWrite permissions + coach/assistant-coach grants (10→12)"`.

## Task 2: Contracts — Template schemas + budget helper

**Files:**
- Create: `libs/pack-kids-football-contracts/src/templates.ts`, `…/templates.spec.ts`
- Modify: `libs/pack-kids-football-contracts/src/index.ts`

- [ ] **Step 1: Write the failing specs** (`templates.spec.ts`):
  - `TemplateSchema` parses a valid template (`{id, name, age:'U9', targetMin:90, items:[{drillId, min:15}]}`); REJECTS `targetMin: 20` (below 30), `targetMin: 130` (above 120), item `min: 1` (below 2), item `min: 60` (above 45), missing `name`; ACCEPTS `items: []` (empty allowed — cascade-emptied templates must parse).
  - `CreateTemplateInputSchema` parsed output has NO `id` key; rejects missing `name`.
  - `summarizeTemplateBudget`: `([], 90)` → `{total:0, targetMin:90, over:false, overBy:0, spare:90}`; `([{drillId:'a',min:90}], 90)` → `{total:90, over:false, overBy:0, spare:0}` (exactly-at-target is NOT over); `([{drillId:'a',min:50},{drillId:'b',min:50}], 90)` → `{total:100, over:true, overBy:10, spare:0}`.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-contracts`.
- [ ] **Step 3: Implement `templates.ts`:**

```ts
/**
 * Kids Football template contracts — TemplateSchema, TemplateItemSchema,
 * CreateTemplateInputSchema, and the pure summarizeTemplateBudget helper.
 *
 * Platform-agnostic (zod-only, no NestJS). A template is an ordered sequence of
 * drill references with per-item minutes, planned against a slot length
 * (targetMin). items[] is the pack-representation/JSONB boundary (design §4,
 * ADR-176). items is intentionally unbounded (auth'd endpoint) and ALLOWS an
 * empty array so a cascade-emptied template still parses on read (the
 * "needs >=1 drill" rule lives in the Create/Update use-cases, not the schema).
 */
import { z } from 'zod';

import { KF_TEAM_AGE_BANDS } from './entities.js';

/** One drill reference in a template sequence. `min` = planned minutes for this
 *  drill in this template (defaults to the drill's own min when added; the
 *  per-item stepper is 2..45, mirroring the drill duration stepper). */
export const TemplateItemSchema = z.object({
  drillId: z.string(),
  min: z.number().int().min(2).max(45),
});

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  age: z.enum(KF_TEAM_AGE_BANDS),
  /** The slot length this template is planned against (minutes). */
  targetMin: z.number().int().min(30).max(120),
  /** Ordered drill sequence. Empty is allowed (cascade-emptied templates). */
  items: z.array(TemplateItemSchema),
});
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateItem = z.infer<typeof TemplateItemSchema>;

/** Create/replace payload — the full entity minus the server-minted id. */
export const CreateTemplateInputSchema = TemplateSchema.omit({ id: true });

/** Derived budget summary (ADR-176 derive-on-read — NEVER persisted). Color-free:
 *  phase->color is a UI concern (the builder looks up each item's drill phase). */
export interface TemplateBudget {
  /** Sum of item minutes. */
  total: number;
  /** Echoed target for convenience. */
  targetMin: number;
  /** total > targetMin. */
  over: boolean;
  /** Minutes over the slot (0 when not over). */
  overBy: number;
  /** Minutes spare under the slot (0 when over). */
  spare: number;
}

export function summarizeTemplateBudget(
  items: readonly TemplateItem[],
  targetMin: number,
): TemplateBudget {
  const total = items.reduce((sum, it) => sum + it.min, 0);
  const over = total > targetMin;
  return {
    total,
    targetMin,
    over,
    overBy: over ? total - targetMin : 0,
    spare: over ? 0 : targetMin - total,
  };
}
```

  Export all four (`TemplateSchema`, `TemplateItemSchema`, `CreateTemplateInputSchema`, `summarizeTemplateBudget`) + the types (`Template`, `TemplateItem`, `TemplateBudget`) from `src/index.ts`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-contracts/src/templates.ts libs/pack-kids-football-contracts/src/templates.spec.ts libs/pack-kids-football-contracts/src/index.ts` then `git commit -m "feat(exercir): kids-football S5 — Template contracts + summarizeTemplateBudget helper"`.

## Task 3: Migration — kids_football.template table + RLS + folded club @@index drop

**Files:**
- Modify: `prisma/packs/kids-football.prisma`
- Create: `prisma/migrations/20260613120000_kids_football_template/migration.sql`

- [ ] **Step 1: Add the `Template` model** to `prisma/packs/kids-football.prisma` (after `Drill`), mirroring the Drill model's column conventions:

```prisma
/// A reusable training template — an ordered sequence of drill references with
/// per-item minutes, planned against a slot length (targetMin). Slice 5.
/// `items` is JSONB ({drillId, min}[]) per the pack-representation boundary
/// (design §4, ADR-176); budget totals are DERIVED on read, never stored.
/// `tenantPackId` RLS-scopes the row (kids_football.template_tenant_pack_isolation).
model Template {
  id           String   @id @default(uuid()) @db.Uuid
  tenantPackId String   @map("tenant_pack_id") @db.Uuid
  name         String
  age          String
  targetMin    Int      @map("target_min")
  items        Json     @default("[]")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([tenantPackId])
  @@map("template")
  @@schema("kids_football")
}
```

  In the same edit, **remove** the redundant `@@index([tenantPackId])` line from the `Club` model (D-5 — `@@unique([tenantPackId])` already backs tenant lookups). Update the `Club` doc-comment to note the unique index is the sole tenant index.
- [ ] **Step 2: Write the migration SQL** `prisma/migrations/20260613120000_kids_football_template/migration.sql`, mirroring `20260612200000_kids_football_onboarding/migration.sql:30-101`:

```sql
-- kids-football S5 templates — two changes:
--   1. CREATE template table for reusable session plans (items JSONB).
--   2. DROP the redundant club tenant_pack_id index (exercir#251 nit) — the
--      unique index club_tenant_pack_id_key already backs tenant lookups.
--
-- Convention mirrors 20260612200000_kids_football_onboarding (drill): UUID PK,
-- snake_case columns, ENABLE + FORCE RLS, USING + WITH CHECK (INSERT) + an
-- explicit FOR UPDATE policy (the builder save is an in-place UPDATE), grants
-- to the non-superuser `app` role via a guarded DO block. Forward-only (§20 P5).

-- ─── template table ──────────────────────────────────────────────────────────
CREATE TABLE "kids_football"."template" (
    "id"             UUID         NOT NULL,
    "tenant_pack_id" UUID         NOT NULL,
    "name"           TEXT         NOT NULL,
    "age"            TEXT         NOT NULL,
    "target_min"     INTEGER      NOT NULL,
    "items"          JSONB        NOT NULL DEFAULT '[]',
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "template_tenant_pack_id_idx" ON "kids_football"."template"("tenant_pack_id");

-- ─── row level security ──────────────────────────────────────────────────────
ALTER TABLE "kids_football"."template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kids_football"."template" FORCE ROW LEVEL SECURITY;

CREATE POLICY template_tenant_pack_isolation ON "kids_football"."template"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

CREATE POLICY template_tenant_pack_isolation_write ON "kids_football"."template"
  FOR INSERT
  WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

-- Template has a real in-place UPDATE path (the builder save + the cascade
-- write-back). The FOR ALL isolation USING already doubles as the UPDATE WITH
-- CHECK default, so this does not close a hole — it DECLARES the tenant-rewrite
-- guard explicitly (slot/drill precedent). P OR P = P — never widened.
CREATE POLICY template_tenant_pack_isolation_update ON "kids_football"."template"
  FOR UPDATE
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true))
  WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

-- ─── grant the app role CRUD on template ─────────────────────────────────────
DO $grant_block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA kids_football TO app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "kids_football"."template" TO app';
  END IF;
END
$grant_block$;

-- ─── exercir#251 nit: drop the redundant club tenant index ───────────────────
-- club_tenant_pack_id_key (UNIQUE, from @@unique) already backs tenant lookups.
DROP INDEX IF EXISTS "kids_football"."club_tenant_pack_id_idx";
```

- [ ] **Step 3: Regenerate the client + verify the migration applies.** With Postgres up: `npm run db:generate`; then apply via the project's migrate path (do NOT hand-edit `migration_lock`); confirm `npx prisma migrate status` shows the new migration. (If the env has no DB, the SQL is reviewed by the wave + proven live in Task 7's `test:db`.)
- [ ] **Step 4: Build the schema-consuming projects** — `NX_DAEMON=false npx nx run-many -t build --projects=pack-kids-football,pack-kids-football-api` (the generated client must compile against the new model).
- [ ] **Step 5: Commit** — `git add prisma/packs/kids-football.prisma prisma/migrations/20260613120000_kids_football_template` then `git commit -m "feat(exercir): kids-football S5 — template table + RLS migration; drop redundant club index (#251)"`.

## Task 4: Template repository — port + in-memory + Prisma on ONE contract suite (+ removeDrillReferences)

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/template.repository.ts`, `…/template.repository.contract.ts`, `…/template.repository.spec.ts`, `out-adapters/prisma-template.repository.ts`, `out-adapters/prisma-template.repository.contract.spec.ts`
- Modify: `out-ports/tenant-runner.port.ts`, `out-adapters/testing/stub-delegates.ts`, `src/index.ts`

- [ ] **Step 1: Write the failing contract suite** `template.repository.contract.ts` (run against BOTH impls; mirror `drill.repository.contract.ts`). `TemplateRepositoryHarness = { repo; setTenant(id); tenants:{a,b} }`. A `makeTemplate(overrides?)` helper builds a valid `CreateTemplateInput` (`{name:'Tue Technical', age:'U9', targetMin:90, items:[{drillId: DRILL_A, min:15}]}`). Cases:
  - `list` empty for a fresh tenant.
  - `create` returns the template with a truthy id; `list` then returns it; JSONB `items` round-trips deep-equal.
  - `findById` → null for absent UUID / malformed id; returns the created template; null cross-tenant.
  - `update` merges (patch `{name}` leaves `items` untouched); `items` patch replaces wholesale (re-read deep-equals); empty patch `{}` → existing unchanged; absent id → null; cross-tenant id → null (count-0).
  - `delete` → true + gone; absent id → false; cross-tenant id → false (B cannot delete A; A still lists it).
  - `removeDrillReferences(DRILL_A)`: a template with items `[{A,15},{B,10}]` → items become `[{B,10}]`, returns count `1`; a template referencing A twice strips both; a template not referencing A is untouched; returns `0` when no template references the drill; **a template whose only item was A becomes `items: []` and still lists** (emptied-persists, D-2); cross-tenant — B's `removeDrillReferences(A)` does not touch A's templates.
  - Mutation isolation (mutating a returned template / its items array does not corrupt the store).
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football`.
- [ ] **Step 3: Implement.**

  `template.repository.ts` — port + in-memory (mirror `drill.repository.ts`; Template has NO nullable scalars; `items` replaces wholesale when present):

```ts
import type { Template } from '@de-braighter/pack-kids-football-contracts';

export type CreateTemplateInput = Omit<Template, 'id'>;
export type UpdateTemplatePatch = Partial<CreateTemplateInput>;

export interface TemplateRepository {
  list(): Promise<readonly Template[]>;
  /** The template with this id for the active tenant, or null. */
  findById(id: string): Promise<Template | null>;
  /** Create one template. Returns the created template.
   *  Note: this mutation carries no F1 event-log write; tracked in exercir#245. */
  create(input: CreateTemplateInput): Promise<Template>;
  /** Partial update. Returns the updated template, or null when the id does not
   *  resolve for the active tenant (count-0). `items` replaces wholesale when present.
   *  Note: no F1 event-log write; tracked in exercir#245. */
  update(id: string, patch: UpdateTemplatePatch): Promise<Template | null>;
  /** Delete. true when removed, false when the id does not resolve.
   *  Note: no F1 event-log write; tracked in exercir#245. */
  delete(id: string): Promise<boolean>;
  /** Cascade primitive (drill -> template, design §2.3): remove every item whose
   *  drillId === drillId from all templates in the active tenant. Returns the
   *  number of templates modified. A template emptied of items PERSISTS (it is
   *  not deleted). Note: no F1 event-log write; tracked in exercir#245. */
  removeDrillReferences(drillId: string): Promise<number>;
}

export const TEMPLATE_REPOSITORY = Symbol('TEMPLATE_REPOSITORY');
```

  `InMemoryTemplateRepository` — `Map<tenantId, Map<templateId, Template>>`, `structuredClone` at both boundaries, `crypto.randomUUID()` id mint. `update` forwards only `!== undefined` keys (`name`/`age`/`targetMin` scalars; `items` replaces via `structuredClone` when present). `removeDrillReferences`: iterate the bucket; for each template, `const next = items.filter(it => it.drillId !== drillId)`; if `next.length !== items.length`, write back the clone with `next` and increment count; return count.

  `tenant-runner.port.ts` — add the **Template delegate types** (mirror the Drill block at `:368-463`), using **single `create`** (not createMany):

```ts
export interface TenantScopedTemplateRow {
  readonly id: string; readonly tenantPackId: string;
  readonly name: string; readonly age: string;
  readonly targetMin: number; readonly items: unknown;
  readonly createdAt: Date; readonly updatedAt: Date;
}
export interface TenantScopedTemplateCreateInput {
  id: string; tenantPackId: string; name: string; age: string; targetMin: number; items: unknown;
}
export interface TenantScopedTemplateUpdateData {
  name?: string; age?: string; targetMin?: number; items?: unknown;
}
export interface TenantScopedTemplateDelegate {
  findMany(args: { orderBy?: { createdAt: 'asc' | 'desc' } }): Promise<readonly TenantScopedTemplateRow[]>;
  findUnique(args: { where: { id: string } }): Promise<TenantScopedTemplateRow | null>;
  create(args: { data: TenantScopedTemplateCreateInput }): Promise<TenantScopedTemplateRow>;
  updateMany(args: { where: { id: string }; data: TenantScopedTemplateUpdateData }): Promise<{ count: number }>;
  deleteMany(args: { where: { id: string } }): Promise<{ count: number }>;
}
```

  Add `readonly template: TenantScopedTemplateDelegate;` to `TenantScopedClient`. Extend `out-adapters/testing/stub-delegates.ts` with a `template` stub delegate (mirror the `drill` stub) and fix any sibling spec literal that the `TenantScopedClient` growth fans out to (the budgeted gotcha).

  `prisma-template.repository.ts` (mirror `prisma-drill.repository.ts`): `list` (findMany orderBy createdAt asc → `rowToTemplate`), `findById` (uuid-guard → findUnique), `create` (runner.run → read `activeTenantPackId(tx)` via `CURRENT_TENANT_PACK_ID_SQL` → `tx.template.create({data:{id: randomUUID(), tenantPackId, name, age, targetMin, items: input.items}})`), `update` (uuid-guard; presence-driven `data` build forwarding `name`/`age`/`targetMin` !== undefined, `items` passed directly when present; empty `data` → `findById`; `updateMany` count-0 → null → findUnique re-read → map), `delete` (uuid-guard → deleteMany count boolean), `removeDrillReferences` (one `runner.run`: `findMany` all templates → for each, filter items whose `drillId === drillId` → if changed, `updateMany({where:{id}, data:{items: next}})` and count++ → return count). `rowToTemplate` casts `row.items as Template['items']`. Carry the #245 doc-comment on every mutation.

  `prisma-template.repository.contract.spec.ts` — fake-delegate harness (in-memory-backed `template` delegate proving the row shape) running the same suite + the DB-gated block (real PG when `DATABASE_URL`/test:db).
  Export `TemplateRepository`, `TEMPLATE_REPOSITORY`, `InMemoryTemplateRepository`, `CreateTemplateInput`, `UpdateTemplatePatch`, `PrismaTemplateRepository` from `src/index.ts`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx run-many -t lint test --projects=pack-kids-football`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football/src/out-ports/template.repository.ts libs/pack-kids-football/src/out-ports/template.repository.contract.ts libs/pack-kids-football/src/out-ports/template.repository.spec.ts libs/pack-kids-football/src/out-ports/tenant-runner.port.ts libs/pack-kids-football/src/out-adapters/prisma-template.repository.ts libs/pack-kids-football/src/out-adapters/prisma-template.repository.contract.spec.ts libs/pack-kids-football/src/out-adapters/testing/stub-delegates.ts libs/pack-kids-football/src/index.ts` then `git commit -m "feat(exercir): kids-football S5 — template repository (port + in-memory + Prisma, one contract suite) + removeDrillReferences cascade primitive"`.

## Task 5: Template use-cases (list/create/update/delete, Result<T,E>) + module wiring

**Files:**
- Create: `libs/pack-kids-football/src/in-ports/list-templates.use-case.ts`, `…/create-template.use-case.ts`, `…/update-template.use-case.ts`, `…/delete-template.use-case.ts`, `src/application/list-templates.service.ts`, `…/create-template.service.ts`, `…/update-template.service.ts`, `…/delete-template.service.ts`, `…/template-use-cases.spec.ts`
- Modify: `src/index.ts`, `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts`

- [ ] **Step 1: Write the failing specs** (`template-use-cases.spec.ts`, in-memory repo; mirror `drill-use-cases.spec.ts`): list returns created templates; create happy (validates via `CreateTemplateInputSchema`, returns template with id); create empty name / `targetMin:20` → `invalid-input` and repo untouched; **create with `items:[]` → `invalid-input` ("a template needs at least one drill")**; update happy (patch `name` only — items preserved); update validates the MERGED candidate (patch `targetMin:20` → invalid-input); **update to `items:[]` → invalid-input**; update unknown id → `template-not-found`; delete happy → ok; delete unknown id → `template-not-found`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In-ports mirror the drill quartet (domain-named methods, Symbol tokens; `CreateTemplateInput`/`UpdateTemplatePatch` re-exported from the port):

```ts
// create-template.use-case.ts
export type { CreateTemplateInput } from '../out-ports/template.repository.js';
export type CreateTemplateFailure = { kind: 'invalid-input'; detail: string };
export type CreateTemplateResult =
  | { ok: true; value: Template }
  | { ok: false; error: CreateTemplateFailure };
export interface CreateTemplateUseCase { createTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult>; }
export const CREATE_TEMPLATE_USE_CASE = Symbol('CREATE_TEMPLATE_USE_CASE');
// update: failure 'invalid-input' | 'template-not-found' (carries id); patch UpdateTemplatePatch
// delete: failure 'template-not-found' (carries id)
// list:   failure never (mirrors ListDrillsUseCase)
```

  Services:
  - `ListTemplatesService` — `repo.list()` → ok.
  - `CreateTemplateService` — `CreateTemplateInputSchema.safeParse(input)` → first-issue `invalid-input` (`path: message`); then **`if (parsed.data.items.length === 0) return invalid-input 'items: a template needs at least one drill'`**; `repo.create(parsed.data)` → `value`.
  - `UpdateTemplateService` — `repo.findById(id)` → `template-not-found`; merge `{...existingMinusId, ...definedKeys(patch)}` (scalars forward when `!== undefined`; `items` replaces when present); validate merged via `CreateTemplateInputSchema` → invalid-input; **`if (merged.items.length === 0) invalid-input`**; `repo.update(id, patch)` → null ⇒ `template-not-found` (lost-update race). No referential checks on `drillId`s (kept simple — a stale drillId renders "Missing drill"; the cascade is the cleanup path, design §8).
  - `DeleteTemplateService` — `repo.delete(id)` → false ⇒ `template-not-found`. Carry the #245 doc-comment.

  Export all from `src/index.ts`. In `PackKidsFootballModule` wire the `TEMPLATE_REPOSITORY` provider (add `Template` to the `inMemoryRepoProviders` set + the Prisma binding, mirroring how `DRILL_REPOSITORY` is bound — note there is NO shared store-map seed for templates, D-2) and the four use-case providers + `useExisting` token bindings + the four token exports (mirror the drill block).
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx run-many -t test --projects=pack-kids-football,pack-kids-football-api` (the api project proves the module still composes).
- [ ] **Step 5: Commit** — explicit `git add` of the 9 created files + `src/index.ts` + `pack-kids-football.module.ts`, then `git commit -m "feat(exercir): kids-football S5 — template use-cases (list/create/update/delete, Result<T,E>) + module wiring"`.

## Task 6: Drill→template cascade wiring (DeleteDrillService)

**Files:**
- Modify: `libs/pack-kids-football/src/application/delete-drill.service.ts` (+ `delete-drill.service.spec.ts` if present, else add cases in `drill-use-cases.spec.ts`)

- [ ] **Step 1: Write the failing spec.** In the drill delete tests (in-memory `DrillRepository` + in-memory `TemplateRepository` under the same `activeTenant`): seed a drill `D` and two templates — one referencing `D` (`items:[{D,15},{X,10}]`), one not (`items:[{X,10}]`). Call `deleteDrill(D.id)`. Assert: result ok; `D` gone from the drill repo; the referencing template's items become `[{X,10}]`; the non-referencing template is untouched. Add: deleting a NON-existent drill returns `drill-not-found` and **does NOT call `removeDrillReferences`** (use a spy/counter on the template repo, or assert templates unchanged when the drill id is absent).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Add `@Inject(TEMPLATE_REPOSITORY) private readonly templateRepo: TemplateRepository` to `DeleteDrillService`; after `repo.delete(id)` returns true, `await this.templateRepo.removeDrillReferences(id)` BEFORE returning ok. Update the header doc-comment:

```ts
/**
 * Cascade (slice 5, design §2.3): a successful drill delete reconciles every
 * template that references the drill — removeDrillReferences strips the matching
 * {drillId, min} items (a template emptied of items PERSISTS, it is not deleted).
 * Non-atomic across the drill + template repos (slice-2 cascade convention): a
 * crash between the two leaves a template referencing a deleted drill (the
 * builder renders "Missing drill" defensively). The scheduled-EVENT cascade arm
 * arrives in slice 6 with the event table. No F1 event-log write (exercir#245).
 */
```

  Confirm the `DeleteDrillService` provider in `PackKidsFootballModule` resolves (the `TEMPLATE_REPOSITORY` provider added in Task 5 must be in the same module).
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football/src/application/delete-drill.service.ts libs/pack-kids-football/src/application/*drill*.spec.ts` then `git commit -m "feat(exercir): kids-football S5 — wire drill->template cascade into DeleteDrillService"`.

## Task 7: Templates HTTP controller + RBAC e2e + cascade e2e

**Files:**
- Create: `apps/pack-kids-football-api/src/app/templates.controller.ts`, `…/templates.e2e.spec.ts`
- Modify: `…/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS`)

- [ ] **Step 1: Write the failing e2e** (`templates.e2e.spec.ts`, in-memory binding; mirror `drills.e2e.spec.ts`):
  - as club-A **coach** — `GET /kids-football/templates` → 200 `[]` (no seed, D-2); `POST` a valid template (items reference a real seeded drill id — `GET /kids-football/drills` first to grab one) → 201, `GET` shows 1; `PATCH /:id` `{name}` → 200 merged; `DELETE /:id` → 204, `GET` back to 0;
  - as club-A **assistantCoach** — `POST` → 201 (mirror-drills grant, D-1) [if no assistantCoach e2e identity helper exists, assert via a coach + a teamManager and note the assistantCoach grant is unit-proven in Task 1];
  - as club-A **teamManager** — `GET` → 403, `POST` → 403; as **facilities** — `GET` → 403;
  - as club-B **coach** — `GET` → 200 with ONLY club B's templates (A's created template absent — cross-club invisibility);
  - invalid `POST` (`items:[]`) → 400 `{kind:'invalid-input'}`; `PATCH` unknown uuid → 404 `{kind:'template-not-found'}`;
  - **cascade e2e:** as coach, create a drill `D`, create a template referencing `D`, `DELETE /kids-football/drills/:Did` → 204, then `GET /kids-football/templates` shows the template with `D`'s item removed.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `templates.controller.ts` — copy `drills.controller.ts` verbatim, swapping drill→template tokens/use-cases and `drill-not-found`→`template-not-found`:

```ts
@Controller('kids-football/templates')
export class KidsFootballTemplatesHttpController {
  // GET    @RequiresPermission(KF_PERMISSIONS.templateRead)   → 200 Template[]
  // POST   @RequiresPermission(KF_PERMISSIONS.templateWrite)  → 201 Template | 400
  // PATCH  :id @RequiresPermission(KF_PERMISSIONS.templateWrite) → 200 | 400 | 404(template-not-found)
  // DELETE :id @RequiresPermission(KF_PERMISSIONS.templateWrite) → 204 | 404(template-not-found)
}
```

  Append `KidsFootballTemplatesHttpController` to `PACK_KF_CONTROLLERS` in `pack-kids-football-auth.bootstrap.ts`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-api`, then with Postgres up `npm run test:db` (the new `template` RLS proof + the regression that the dropped `club` index leaves club CRUD green — extend the live-RLS proof set to cover `template` cross-tenant count-0 on update/delete, mirroring the slice-3/4 drill proof).
- [ ] **Step 5: Commit** — `git add apps/pack-kids-football-api/src/app/templates.controller.ts apps/pack-kids-football-api/src/app/templates.e2e.spec.ts apps/pack-kids-football-api/src/app/pack-kids-football-auth.bootstrap.ts` then `git commit -m "feat(exercir): kids-football S5 — templates RBAC endpoints + e2e (403 matrix + cascade)"`.

## Task 8: UI data tier — client methods + store collection

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec), `lib/data/kf-club-store.ts` (+ spec)

- [ ] **Step 1: Write the failing tests.**
  - Client spec: `listTemplates()` GETs `/kids-football/templates` with identity headers, parses `z.array(TemplateSchema)`, rejects a malformed entry; `createTemplate(payload)` POSTs + parses `TemplateSchema` (plain entity — per-endpoint shape); `updateTemplate(id, patch)` PATCHes; `deleteTemplate(id)` DELETEs, resolves void.
  - Store spec: `templates()` empty initially; `loadTemplates()` populates + clears `templatesError`; a 403 sets `templatesError` via `mapKfError` and leaves `templates` untouched; `loadTemplates` is NOT part of `refresh()`; the sign-out effect clears `_templates`/`_templatesError`.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-ui`.
- [ ] **Step 3: Implement.** Client — add `TemplateListSchema = z.array(TemplateSchema)` and four methods mirroring the drill quartet (`buildHeaders` + `firstValueFrom` + zod parse; `createTemplate(payload: Omit<Template,'id'>)`, `updateTemplate(id, patch: Partial<Omit<Template,'id'>>)`, `deleteTemplate(id)`). Store — add `_templates`/`_templatesError` signals + readonly views + `loadTemplates()` (mirror `loadDrills`, incl. the error-isolation convention); add the two new signals to the sign-out clear effect; doc-comment why templates stay out of `refresh()`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.spec.ts libs/pack-kids-football-ui/src/lib/data/kf-club-store.ts libs/pack-kids-football-ui/src/lib/data/kf-club-store.spec.ts` then `git commit -m "feat(exercir): kids-football S5 — template client methods + store collection"`.

## Task 9: Routes + nav (canSeeTemplates) + i18n

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/routes.ts`, `lib/shell/kf-shell.component.ts` (+ `kf-shell.component.spec.ts`), `lib/kf-i18n.ts`

- [ ] **Step 1: Write the failing shell spec.** `kf-shell.component.spec.ts`: a `coach` session renders the Templates nav link (`[data-testid="kf-nav-templates"]`) pointing at `['/t', tenant, 'p', 'kids-football', 'templates']`; an `assistant-coach` session renders it; a `club-admin` session does NOT render it (asymmetry vs Drills — D-1); a `team-manager` session does not.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `routes.ts` — add three children under the shell wrapper AFTER the drills routes (`templates/new` BEFORE `templates/:id`):

```ts
{ path: 'templates', loadComponent: () => import('./templates/template-list-page.component.js').then((m) => m.TemplateListPageComponent) },
{ path: 'templates/new', loadComponent: () => import('./templates/template-builder-page.component.js').then((m) => m.TemplateBuilderPageComponent) },
{ path: 'templates/:id', loadComponent: () => import('./templates/template-builder-page.component.js').then((m) => m.TemplateBuilderPageComponent) },
```

  Update the route-shape doc-comment.
  - `kf-shell.component.ts` — add the predicate (note the deliberate asymmetry, D-1):

```ts
  /**
   * Roles that can see the Templates nav link: coach + assistant coach ONLY.
   * Deliberately EXCLUDES club-admin — unlike canSeeDrills() — even though
   * clubAdmin holds templateRead via Object.values: Templates is a coaching
   * surface; clubAdmin lives on the Club tabs (design §2.2). Do not "fix" this.
   */
  protected readonly canSeeTemplates = computed(() =>
    ['coach', 'assistant-coach'].includes(this.session()?.role ?? ''),
  );
```

  Render the nav link in the `<nav class="topnav">` (after the Drills `@if`, before the Club `@if`), and add `navTemplates: kfMsg('kf.shell.nav.templates')` to `msg`:

```html
@if (canSeeTemplates()) {
  <a class="nav-link" [routerLink]="link('templates')" [attr.data-testid]="'kf-nav-templates'">{{ msg.navTemplates }}</a>
}
```

  - `kf-i18n.ts` — add `'kf.shell.nav.templates': 'Templates'` (+ the keys Tasks 10/11 need — see those tasks; add them all here in one pass to keep the i18n edits localised).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/routes.ts libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.ts libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.spec.ts libs/pack-kids-football-ui/src/lib/kf-i18n.ts` then `git commit -m "feat(exercir): kids-football S5 — templates routes + canSeeTemplates nav (coach/assistant-coach)"`.

## Task 10: Shared phase-color map + Template list page

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/drills/kf-phase-colors.ts`, `lib/templates/template-list-page.component.ts`, `…/template-list-page.component.spec.ts`
- Modify: `lib/drills/kf-phase-tag.component.ts`

- [ ] **Step 1: Write the failing spec** (`template-list-page.component.spec.ts`, pre-populated store stub for unit cases): renders a card per template with name, "{age} · {n} drills · {total} of {targetMin} min" (total via `summarizeTemplateBudget`), a phase-bar with one segment per item colored from `KF_PHASE_COLORS[drill.phase]` (look the drill up by `item.drillId` from `store.drills()`), and a first-3-drills "A → B → C → …" summary; an over-budget template's meta still renders the real total (no clamp); the empty-state card shows when `templates()` is empty; "+ New template" button navigates to `templates/new`; a card click navigates to `templates/:id`; `ngOnInit` calls BOTH `loadTemplates()` and `loadDrills()` (the initial-load lesson — drills are needed for names + phase colors).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `kf-phase-colors.ts` — promote the phase map (DRY, D-8):

```ts
import type { KF_DRILL_PHASES } from '@de-braighter/pack-kids-football-contracts';
type DrillPhase = (typeof KF_DRILL_PHASES)[number];
/** Full-saturation phase colors (handoff §6 phase palette). Shared by the phase
 *  tag (which tints them) and the template budget bar (which uses them raw). */
export const KF_PHASE_COLORS: Readonly<Record<DrillPhase, string>> = {
  'Warm-up': '#E8A93C', 'Technical': '#4C9BD6', 'Game': '#5BA864', 'Cool-down': '#9C8DC9',
};
export const KF_PHASE_FALLBACK = '#9AA0A8';
```

  Refactor `kf-phase-tag.component.ts` to import `KF_PHASE_COLORS`/`KF_PHASE_FALLBACK` instead of its private `PHASE_COLORS`/`FALLBACK` (behavior unchanged — the existing phase-tag spec stays green).
  - `template-list-page.component.ts` (`selector: 'lib-kf-template-list-page'`, `styleUrls: ['../club-grass.css']`, OnPush) — mirror `drill-library-page.component.ts`'s header/grid scaffolding. Inject `KfClubStore`, `Router`, `ActivatedRoute`. A `drillById = computed(() => new Map(store.drills().map(d => [d.id, d])))` lookup. Per card: name (display 19), meta line, a phase-bar (`@for` over `template.items`; each segment `width: (item.min / Math.max(template.targetMin, budget.total)) * 100 + '%'`, `background: KF_PHASE_COLORS[drill?.phase] ?? KF_PHASE_FALLBACK`), and the first-3 summary (`template.items.slice(0,3).map(it => drillById().get(it.drillId)?.name).filter(Boolean).join(' → ')` + `' → …'` when `items.length > 3`). Empty-state dashed card. `ngOnInit`: `void this.store.loadTemplates(); void this.store.loadDrills();`. Navigation via `resolveTenantFromRoute` absolute arrays. i18n keys (add to `kf-i18n.ts` in Task 9's pass): `kf.templates.title`, `kf.templates.subtitle`, `kf.templates.new`, `kf.templates.empty`, `kf.templates.meta` (substitution `{age} · {drills} drills · {total} of {target} min` — use `kfMsgSubst`), `kf.templates.drillsError`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-ui`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/drills/kf-phase-colors.ts libs/pack-kids-football-ui/src/lib/drills/kf-phase-tag.component.ts libs/pack-kids-football-ui/src/lib/templates/template-list-page.component.ts libs/pack-kids-football-ui/src/lib/templates/template-list-page.component.spec.ts` then `git commit -m "feat(exercir): kids-football S5 — shared KF_PHASE_COLORS + template list page"`.

## Task 11: Template builder page (sequence + budget card)

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/templates/template-builder-page.component.ts`, `…/template-builder-page.component.spec.ts`
- Modify: `lib/kf-i18n.ts` (builder keys — added in Task 9's pass; confirm present)

- [ ] **Step 1: Write the failing spec.** Cases (mirror `drill-editor-page.component.spec.ts` patterns; stub `store.drills()` with a few drills):
  - `new`: blank model (name '', age 'U9', targetMin 90, items []); Save with empty name → inline `role="alert"` + focus name, no API call; Save with a name but 0 items → inline alert ("add at least one drill"), no API call; adding a library drill appends `{drillId, min: drill.min}`; the per-item minutes stepper changes `items[i].min`; ▲/▼ reorder swaps adjacent items (▲ disabled at index 0, ▼ at last); ✕ removes; the budget card total = Σ item.min, shows "{spare} min spare" under target and turns over-budget ("{overBy} min over the slot — trim a drill" + the `#FFB199` class) when total > targetMin; the slot-length stepper (30–120 step 5) changes targetMin and re-derives the budget; Save (valid) calls `createTemplate` then navigates to `templates`.
  - `:id` edit: loads via `store.templates().find(id)` → `loadTemplates()` fallback; `templatesError` set → load-failed state (not not-found); id absent after successful load → not-found state; populated form; Save calls `updateTemplate`; the delete button opens a focus-trapped confirm (kf-modal-focus) → `deleteTemplate` → navigate.
  - a drill referenced by an item but absent from `store.drills()` renders "Missing drill" (defensive, D-2) without crashing.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `template-builder-page.component.ts` (`selector: 'lib-kf-template-builder-page'`, `styleUrls: ['../club-grass.css']`, OnPush, imports `ReactiveFormsModule` + `KfSketchThumbnailComponent` + `KfPhaseTagComponent` + `KfIntensityDotsComponent`). Mirror `drill-editor-page.component.ts` for: the sr-only focused `<h1>`, sticky header (back link + name input + Age `<select>` + slot-length stepper + Delete/Cancel/Save with enabled-submit + `aria-busy`), the store-backed `loadTemplate(id)` (loadFailed/notFound precedence), the focus-trapped delete modal (`trapTabKey`/`focusFirstField`/`restoreFocus`), and `mapKfError`. Builder-specific model + view:
  - `form = new FormGroup({ name: FormControl('',{nonNullable}), age: FormControl<Template['age']>('U9',{nonNullable}) })`; `targetMin = signal(90)`; `items = signal<readonly TemplateItem[]>([])`; library filter signals `search = signal('')`, `focus = signal('')` (reuse `KF_DRILL_FOCUS_AREAS`).
  - `budget = computed(() => summarizeTemplateBudget(this.items(), this.targetMin()))`.
  - `lib = computed(() => store.drills().filter(d => (!focus || d.focus===focus) && (!q || d.name.toLowerCase().includes(q))))`.
  - `drillById = computed(() => new Map(store.drills().map(d => [d.id, d])))`.
  - Left column: search input + focus chips + the compact drill rows — each row `<lib-kf-sketch-thumbnail [sketch]="d.sketch" [ariaLabel]="null" />` (width ~84) + name + "{focus} · {min}′ · {phase}" + a green "+" button (`add(d)` → `items.update(xs => [...xs, {drillId:d.id, min:d.min}])`, `aria-label` "Add {name}").
  - Right column: `<span class="x-label">` "Session sequence"; empty-state dashed card when `items().length===0`; `@for (it of items(); track $index; let i = $index)` rows — 2-digit display index (`String(i+1).padStart(2,'0')`), ▲ (`move(i,-1)`, disabled `i===0`)/▼ (`move(i,1)`, disabled `i===items().length-1`), `drillById().get(it.drillId)?.name ?? 'Missing drill'`, `<lib-kf-phase-tag [phase]="drill?.phase ?? 'Technical'" />`, "{focus} · {players}", `<lib-kf-intensity-dots [level]="drill?.intensity ?? 1" />`, a minutes stepper (2–45, `setMin(i,delta)`), ✕ remove (`remove(i)`); aria-labels per row. `move`/`remove`/`setMin`/`add` all rebuild a NEW `items` array.
  - Footer budget card (ink bg): `{{ budget().total }} of {{ targetMin() }} min planned` (turns `#FFB199` when `budget().over`), "{overBy} min over the slot — trim a drill" / "{spare} min spare"; a proportional phase bar (`@for` over items, segment `width: (it.min / Math.max(targetMin(), budget().total)) * 100 + '%'`, `background: KF_PHASE_COLORS[drill?.phase] ?? KF_PHASE_FALLBACK`); a phase legend (`@for` over the 4 phases with a swatch). Use `aria-live="polite"` on the budget total so the over/under change is announced.
  - `save()` (enabled-submit): if `saving()` return; if `loading()` return; trim name → empty ⇒ `nameError` + focus name + return; if `items().length===0` ⇒ `itemsError` (a `role="alert"` near the sequence) + return; build `payload = { name, age, targetMin: targetMin(), items: [...items()] }`, `CreateTemplateInputSchema.safeParse` (belt-and-braces; on failure log + generic alert), then `create`/`update` → navigate to `templates`; `finally` clear `saving`.
  - i18n keys (add to `kf-i18n.ts`): `kf.template.title`, `kf.template.back`, `kf.template.nameLabel`, `kf.template.namePlaceholder`, `kf.template.nameError`, `kf.template.itemsError`, `kf.template.age`, `kf.template.slotLength`, `kf.template.slotDecrease`, `kf.template.slotIncrease`, `kf.template.save`, `kf.template.create`, `kf.template.cancel`, `kf.template.delete`, `kf.template.saving`, `kf.template.libraryLabel`, `kf.template.searchPlaceholder`, `kf.template.sequenceLabel`, `kf.template.sequenceEmpty`, `kf.template.add` (subst {name}), `kf.template.moveUp`/`kf.template.moveDown` (subst {n}), `kf.template.itemMinLabel` (subst {name}), `kf.template.remove` (subst {name}), `kf.template.missingDrill`, `kf.template.budgetPlanned` (subst {total}{target}), `kf.template.budgetOver` (subst {overBy}), `kf.template.budgetSpare` (subst {spare}), `kf.template.loadError`, `kf.template.loadFailed`, `kf.template.createFailed`, `kf.template.deleteFailed`, `kf.template.deleteConfirmTitle`/`Body`/`Confirm`/`Cancel`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-ui`, then `NX_DAEMON=false npx nx run-many -t lint --projects=pack-kids-football-ui`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/templates/template-builder-page.component.ts libs/pack-kids-football-ui/src/lib/templates/template-builder-page.component.spec.ts libs/pack-kids-football-ui/src/lib/kf-i18n.ts` then `git commit -m "feat(exercir): kids-football S5 — template sequence builder + phase-colored budget card"`.

## Task 12: Slice gate, browser run-through, story issue, PR, verifier wave, ritual

- [ ] **Step 1: Full local gate.** From `../exercir-wt-kf-s5`: `npm run ci:local` (all projects green — expect the test count to grow by the new suites) and `npm run test:db` with Postgres up (the new `template` live-RLS proof + the regression that the dropped `club` index leaves club CRUD green).
- [ ] **Step 2: Browser run-through** (kill any orphan `:3150` first; serve the api + the visual-editor host on a spare port, e.g. `:4250`, redirecting serve logs to a file — never pipe through `head`). As a coach: open `/templates` → empty-state; "+ New template" → builder; add 3–4 drills, reorder with ▲▼, change a per-item minute, watch the budget bar fill; push items past the slot length → confirm the over-budget warning (`#FFB199` + "trim a drill"); Save → the card appears in the list with the right total + phase bar; open it, Delete → confirm modal → gone. Then exercise the **cascade**: build a template referencing a drill, go to `/drills`, delete that drill, return to `/templates` → its item is gone from the template. Confirm the Templates nav shows for coach (and is absent for a club-admin session). Capture a screenshot to `de-braighter/docs/club-grass-templates-s5-proof.png`.
- [ ] **Step 3: Story issue + PR.** Open the exercir story issue (`type/story`, slice 5) and the PR **before** the wave (so the wave findings are harvestable). PR body carries the conventional summary + the three twin lines:
  - `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`
  - `Effort: standard`
  - `Effect: cycle-time 0.01±0.02 expert` and `Effect: findings 6±4 expert` (self-observing cross-repo indicators; declare ONLY these — Sonar metrics are deferred on cross-repo PRs).
  - State the D-6 (#245 posture), D-2 (cascade + no event arm + no template seed), D-5 (#251 index drop folded), and D-7 (subjectSensitivity unset) decisions explicitly.
- [ ] **Step 4: Verifier wave** (review floor: non-trivial → full wave). Spawn in parallel, all `isolation: "worktree"`, read-only, git-writes forbidden: `local-ci` + `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer`. The wave prompt must tell the charter-checkers: subjectSensitivity stays unset by design (D-7), the cascade non-atomicity is the sanctioned slice-2 posture (D-2), and the nav asymmetry (D-1) is a founder decision — so none are flagged as defects.
- [ ] **Step 5: Post-findings → fix blockers/should-fixes → merge → twin ritual.** Write the wave findings to a temp JSON (`[{verifier, severity, path?, line?, text}]`, severity ∈ `blocking|should-fix|nit|note`) and `npx tsx src/cli.ts post-findings de-braighter/exercir#NN findings.json` (from `domains/devloop`) BEFORE merge. Fix any blocking/should-fix in the worktree (re-run the gate). Merge (squash). Then the **mandatory twin ritual**: `drain exercir#NN` → `backfill de-braighter/exercir` → `reconcile exercir#NN` → `reviews` → `resolve-findings` (or `npm run ritual:post-merge`). Update the `exercir-kids-football-mvp-arc` memory (slice 5 SHIPPED + any new gotchas) and the RESUME POINT → slice 6 (calendar + scheduling; the event table + the event arm of the cascade + the teamManager template-read question land there). Remove the worktree (`git worktree remove ../exercir-wt-kf-s5` after verifying the PR LANDED).

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: permissions §2.1/§4.1 → T1; contracts + budget §3/§4.1 → T2; migration + #251 §4.2/§2.6 → T3; repository + cascade primitive §4.3 → T4; use-cases + ≥1 invariant §4.3 → T5; cascade wiring §2.3/§5 → T6; controller + e2e §4.3/§6 → T7; client + store §4.4 → T8; routes + nav asymmetry §2.2/§4.4 → T9; list page §4.4 → T10; builder + budget card §4.4 → T11; gate/run-through/ritual §6/§8 → T12. The §7 out-of-scope items (scheduling, event-cascade arm, F1 wiring) are explicitly deferred, not built.

**2. Placeholder scan** — no TBD/TODO; every code step shows real code or a precise mirror-this-file instruction with the exemplar named.

**3. Type consistency** — `TemplateRepository` methods (`list`/`findById`/`create`/`update`/`delete`/`removeDrillReferences`) are used identically in T4 (port), T5 (use-cases), T6 (cascade); `summarizeTemplateBudget(items, targetMin)` signature matches across T2 (def), T10 + T11 (consumers); `CreateTemplateInput`/`UpdateTemplatePatch` defined in T4, re-exported + consumed in T5; `KF_PHASE_COLORS` defined in T10, consumed in T10 (phase-tag) + T11 (builder); use-case Symbol tokens (`CREATE_TEMPLATE_USE_CASE` etc.) wired in T5, injected in T7's controller; `templateRead`/`templateWrite` defined T1, used T7 (`@RequiresPermission`); `canSeeTemplates()` defined T9, no collision with `canSeeDrills()`. Consistent.
