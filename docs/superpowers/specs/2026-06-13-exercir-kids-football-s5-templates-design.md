# Exercir kids-football MVP — Slice 5 (templates) design

> **Status:** approved (brainstorming) 2026-06-13. Slice 5 of the Club Grass kids-football MVP — reusable **session templates**: a list + a sequence builder with a phase-colored time-budget bar (over-budget warns, allowed), plus the drill→template cascade the slice-4 seam pinned.
> **Repo:** `domains/exercir`. **Substrate:** consumes published `@de-braighter/substrate-{contracts,runtime}@^2.0.0` (auth/tenant/RLS only — no kernel/inference).
> **Related:** `2026-06-11-exercir-kids-football-mvp-design.md` (the MVP; §8 row 5 is this slice, §4 the data model) · `2026-06-12-exercir-kids-football-mvp-slice4-drills.md` (the drill vertical + the cascade seam this cashes) · handoff `domains/exercir/docs/design/exercir-mvp-handoff/README.md` screen 5 + prototype `exercir/proto/templates.jsx`.

## 1. Goal

A coach (or assistant coach) composes reusable **session templates** by sequencing drills from the library, each with a per-item minute budget, against a target slot length. The builder shows a live, phase-colored **time-budget bar**; going over the slot length **warns but is allowed** (the coach trims a drill if they choose). Templates are the bridge between slice 4 (drills) and slice 6 (scheduling): in slice 6 a coach assigns a template to a slot to create a calendar event. This slice ships the full template vertical (real per-club persistence + RBAC) and wires the **drill→template cascade** (deleting a drill removes its items from every template that references it).

The kernel is used only as the tenant/auth/RLS substrate — **no kernel concepts** (no plan-tree, no effect-declaration, no inference).

## 2. Decisions (2026-06-13 brainstorming)

1. **Templates permissions = mirror drills (founder decision).** A new `templateRead` + `templateWrite` permission pair. `coach` and `assistantCoach` both get **both** (identical to the slice-4 drill grants); `clubAdmin` inherits both via `Object.values(P)` (permission-layer only); `teamManager` / `facilities` get **neither**. This resolves a direct contradiction: the handoff Roles table says assistant coach is "coach **minus Templates**", but the kickoff prompt + the slice-4 precedent (coach and AC author drills identically) say mirror drills. **Mirror drills wins** — the founder chose it explicitly.
2. **Nav asymmetry (deliberate, pinned).** The Templates nav link shows for **`coach` + `assistantCoach` only** — it does **not** show for `clubAdmin`, even though clubAdmin holds the permission via `Object.values(P)`. This differs from the Drills nav (`canSeeDrills()` includes `club-admin`, `kf-shell.component.ts:297`): Templates is a coaching surface; clubAdmin lives on the "Club" admin tabs per the handoff. A doc comment pins the asymmetry so a future reader does not "fix" it.
3. **Drill→template cascade = remove the item; empty templates persist.** Deleting a drill removes its `{drillId, min}` items from every template in the active tenant (handoff: "drill → removed from templates"). If removing items leaves a template with zero items, **the empty template persists** — passive reconciliation is not a user-save, so the save-time `items.length ≥ 1` invariant does not apply; the coach sees "0 drills" and re-adds. We do **not** auto-delete templates as a side effect of a drill delete (too destructive/surprising), and we do **not** tombstone (the handoff says remove). Defensive "Missing drill" rendering stays in the builder for any transient gap. The cascade's **event arm stays deferred to slice 6** (the event table does not exist yet).
4. **Budget totals are derived-on-read (ADR-176).** `total = Σ items.min`, `over = total > targetMin`, and the over/spare delta are computed, never persisted — the same discipline as the slice-2 `AnnotatedSlot` (`conflictIds`/`maintenance` derived on read). The persisted template row carries only `name`, `age`, `targetMin`, `items[]`.
5. **Subject-sensitivity boundary holds (charter declaration).** Templates carry **drill-template effect data only** (a `targetMin` and an ordered list of `{drillId, min}`) — no per-player inferred state, no observations, no twin. `PackManifest.subjectSensitivity` stays **unset** this slice. The pinned trigger (re-stated for slices 6/7): the moment a slice surfaces *inferred player state*, `subjectSensitivity: 'developmental-minor'` must be set in that same red→green pass so the ADR-187/188/189 gates engage.
6. **New `kids_football.template` table + folded nit.** A migration is required (items as JSONB per design §4). The slice **folds in exercir#251's deferred redundant-`club @@index` drop** in the same migration (the `@@unique([tenantPackId])` already creates `club_tenant_pack_id_key`; the plain `@@index([tenantPackId])` → `club_tenant_pack_id_idx` is dead).

## 3. Data model

```
Template     { id, name, age: 'U7'..'U12', targetMin: int 30..120, items: TemplateItem[] }
TemplateItem { drillId, min: int 2..45 }                 // items[] is JSONB (pack boundary, ADR-176)
```

- `name` is required (`min(1)`); `age` is a `KF_TEAM_AGE_BANDS` enum; `targetMin` is the slot length the template is planned against (stepper 30–120 step 5, default 90); `items[]` is the ordered drill sequence.
- `TemplateItem.min` is the planned minutes for that drill *in this template* (defaults to the drill's own `min` when added; the per-item stepper 2–45 mirrors the drill duration stepper). The drill's other fields (name, phase, focus, intensity, sketch) are **looked up by `drillId`** at render time — never copied into the item (single source of truth; the cascade keeps it honest).
- **Derived (never stored):** `total = Σ items.min`, `over`/`overBy`/`spare`, and the per-segment phase colors.

## 4. Layer plan

### 4.1 Contracts (`pack-kids-football-contracts`)

New `templates.ts`, exported from `src/index.ts`:

- `TemplateItemSchema = z.object({ drillId: z.string(), min: z.number().int().min(2).max(45) })`.
- `TemplateSchema = z.object({ id, name: min(1), age: z.enum(KF_TEAM_AGE_BANDS), targetMin: z.number().int().min(30).max(120), items: z.array(TemplateItemSchema) })`.
- `CreateTemplateInputSchema = TemplateSchema.omit({ id: true })`.
- Pure budget helper — `summarizeTemplateBudget(items: readonly TemplateItem[], targetMin: number): { total; over; overBy; spare }`. **Color-free** (returns no phase/color — phase→color stays a UI concern: the builder looks up each item's drill phase for segment colors, like the prototype's `XPHASE_COLOR`). Exhaustively unit-tested incl. boundary cases (0 items; total exactly at target; over).

Permissions in `roles.ts`: append `templateRead`/`templateWrite` to `KF_PERMISSIONS` (order matters — the manifest spec asserts `Object.values` order).

### 4.2 Migration (`prisma/packs/kids-football.prisma` + a new migration)

New `Template` model + `kids_football.template` table mirroring the drill table verbatim (`20260612200000_kids_football_onboarding/migration.sql` is the template):

- Columns: `id UUID PK`, `tenant_pack_id UUID`, `name TEXT`, `age TEXT`, `target_min INT`, `items JSONB NOT NULL DEFAULT '[]'`, `created_at`, `updated_at`; `@@index([tenantPackId])`.
- RLS: **ENABLE + FORCE**; `USING` isolation policy keyed on `current_setting('app.tenant_pack_id', true)` (`::text` cast); `FOR INSERT WITH CHECK`; an **explicit `FOR UPDATE` USING+WITH CHECK** policy (templates have an in-place update path — the builder save; mirrors the slot/drill precedent); guarded `DO` block granting `SELECT/INSERT/UPDATE/DELETE` to the `app` role.
- **Folded nit (exercir#251):** `DROP INDEX IF EXISTS "kids_football"."club_tenant_pack_id_idx";` and remove `@@index([tenantPackId])` from the `Club` model (the unique index already covers tenant lookups).

### 4.3 API (`pack-kids-football` + `pack-kids-football-api`)

- `TemplateRepository` out-port: `list()`, `findById(id)`, `create(input)`, `update(id, patch)`, `delete(id)`, **+ `removeDrillReferences(drillId): Promise<number>`** (the cascade primitive — strips items referencing `drillId` from every template in the active tenant, returns count touched). `items` is JSONB so this is load→filter→write-back in app code (no SQL array op), like the slice-2 team/resource cascades. The `#245` no-event-log doc-comment posture is carried on every mutation.
- Two impls (`InMemoryTemplateRepository` + `PrismaTemplateRepository`) against **one** `template.repository.contract.ts` suite (mirrors `drill.repository.contract.ts`): CRUD, cross-tenant count-0 on update/delete, JSONB round-trip on `items[]`, mutation isolation, and `removeDrillReferences` (removes matching items, leaves non-referencing templates untouched, returns the count, cross-tenant invisibility).
- Use-cases (`Result<T,E>`, mirroring the **drill quartet** — `List` / `Create` / `Update` / `Delete`, **no `Get`**): `ListTemplates`, `CreateTemplate`, `UpdateTemplate`, `DeleteTemplate`. The builder loads a single template via the store (`store.templates().find(id)` → `loadTemplates()` fallback), exactly like the drill editor — so there is **no `GetTemplate` use-case and no `GET :id` endpoint** (`repository.findById` exists only as the internal primitive the update/delete services use). Save invariant at the use-case: `name` non-empty + `items.length ≥ 1` (`invalid-input` otherwise); update validates the merged candidate; not-found → `template-not-found`.
- **Cascade wiring:** `DeleteDrillService` gains a `TemplateRepository` dependency and calls `removeDrillReferences(drillId)` after the drill delete succeeds. Non-atomic across repos (drill repo + template repo) — pinned in a doc comment exactly like the slice-2 cascades. The seam doc-comment is updated (event arm still deferred to slice 6).
- `templates.controller.ts` (mirrors `drills.controller.ts` exactly): `GET` list, `POST`, `PATCH :id`, `DELETE :id` with `@RequiresPermission(templateRead/templateWrite)` (no `GET :id`); e2e proves the 403 matrix (teamManager/facilities denied) + the cross-club invisibility + the cascade (delete a referenced drill → its items vanish from templates). Response shapes: list = `Template[]`, create/update = plain `Template` (the per-endpoint-shape lesson).
- Stub-club demo seed: seed a couple of starter templates for both stub clubs at bootstrap (in-memory only), composed from the seeded starter drills, so the list demos populated — mirroring `seedDemoDrills` (slice 4 D-2).

### 4.4 UI (`pack-kids-football-ui`)

- Routes under the shell (mirroring drills; `new` before `:id`): `templates` (list), `templates/new` (builder), `templates/:id` (builder).
- Nav: new `canSeeTemplates() = ['coach', 'assistant-coach']` in `kf-shell.component.ts` (the pinned asymmetry, decision 2). New i18n string `kf.shell.nav.templates`.
- `KidsFootballApiClient`: `listTemplates` / `createTemplate` / `updateTemplate` / `deleteTemplate` (no `getTemplate` — the builder loads via the store), each with per-endpoint zod parse (`TemplateListSchema` / `TemplateSchema`). `KfClubStore` gains a `templates` collection + `templatesError` + `loadTemplates()` (mirror `loadDrills`; not part of `refresh()`).
- **Template list page** (`templates/template-list-page.component.ts`): card grid — name, "age · n drills · total of target min", phase-colored segment bar (via `summarizeTemplateBudget` + per-item drill-phase lookup), first-3-drills summary, empty state, "+ New template". Loads templates **and** drills in `ngOnInit` (drills needed for phase colors + names — the slice-2 initial-store-load lesson).
- **Template builder page** (`templates/template-builder-page.component.ts`): sticky header (name input, Age `PSelect`, slot-length stepper 30–120 step 5, Delete/Cancel/Save — **enabled-submit** house pattern: Save stays enabled, clicking with no name or no items renders an inline `role="alert"` and focuses the first problem); left 400px searchable/focus-filtered compact drill list reusing **`kf-sketch-thumbnail`** + green "+" add; right sequence rows (2-digit display index, ▲▼ reorder, `KfPhaseTag` + `KfIntensityDots`, per-item minutes stepper, ✕ remove); footer ink budget card (over-budget → `#FFB199` + "trim a drill", proportional non-overflowing phase bar, phase legend). Reuses `resolveTenantFromRoute`, `mapKfError`, and `kf-modal-focus` for the delete confirm. On `templates/:id` it loads the template via the store (`store.templates().find(id)` → `loadTemplates()` fallback → re-find; load-error vs not-found states distinguished via `templatesError`, the drill-editor `loadDrill` pattern) and loads drills (`loadDrills`) for the library + sequence-row rendering; save-while-loading guard (drill-editor parity).

## 5. Cascade — data flow

```
DELETE /kids-football/drills/:id
  └─ DeleteDrillService.deleteDrill(id)
       ├─ drillRepo.delete(id)                → false ⇒ 404 (template repo untouched)
       └─ on success: templateRepo.removeDrillReferences(id)   (active tenant only, RLS-scoped)
            └─ each template: items = items.filter(it => it.drillId !== id); write back if changed
               (a template may end up with 0 items — it persists; "0 drills" in the list)
  (non-atomic across the two repos — pinned, slice-2 cascade convention; event arm = slice 6)
```

## 6. Testing

- **Contracts:** `TemplateSchema`/`TemplateItemSchema` parse + reject (bad `targetMin`, bad item `min`, missing name); `summarizeTemplateBudget` boundary cases (0 items → total 0/spare = target; exactly at target → not over, spare 0; over → over true, overBy correct).
- **Repository contract suite (both impls):** CRUD + cross-tenant count-0 (update/delete) + JSONB `items[]` round-trip + mutation isolation + `removeDrillReferences` (removes matching, leaves others, returns count, cross-tenant invisibility).
- **Use-cases:** create/update validation (name empty, items empty → invalid-input; merged-candidate validation), not-found paths, list/get happy.
- **Cascade:** `DeleteDrillService` calls `removeDrillReferences` only on successful delete; a referenced drill's items vanish; an unreferenced template is untouched; an emptied template persists with `items: []`.
- **Controller e2e:** RBAC 403 matrix (teamManager/facilities), cross-club invisibility, cascade end-to-end, invalid POST → 400, unknown PATCH → 404.
- **UI:** list (cards render, phase bar, empty state, initial drills+templates load), builder (add/remove/reorder, per-item minute stepper, over-budget styling, save-gating + focus-first-invalid, delete confirm focus trap), client (per-endpoint parse), store (loadTemplates populates + error isolation).
- **`test:db`:** live RLS proof on the new `template` table incl. cross-tenant count-0 on update/delete under `NOBYPASSRLS`; regression that the folded `club` index drop leaves club CRUD green.
- **Gate:** `npm run ci:local` + `npm run test:db`; full browser run-through (build a template, over-budget warn, reorder, delete a referenced drill → cascade visible); screenshot proof.

## 7. Scope / YAGNI

- **In:** the template vertical (contracts → migration/RLS → repo×2 → use-cases → controller → client → 2 UI pages), the drill→template cascade (template-item arm), the folded `club @@index` drop, stub-club demo seed.
- **Out (deferred):** scheduling a template onto a slot → event (slice 6, incl. the event arm of the cascade + the teamManager template-read-for-calendar question); F1 event-log writes (exercir#245 posture carried forward — doc-comment, not wired); remaining #251/#255 nits beyond the folded index; i18n bundles beyond the existing `kf-i18n` pattern for the new strings; drag-and-drop reorder (▲▼ buttons only, prototype parity — a11y-friendly).

## 8. Risks / notes

- **Cross-repo cascade non-atomicity** (slice-2 precedent): a crash between `drillRepo.delete` and `templateRepo.removeDrillReferences` could leave a template referencing a deleted drill. Tolerated + pinned (the builder renders "Missing drill" defensively); a real fix is a single-transaction cascade, deferred with the F1/event-log posture (#245).
- **`items[]` JSONB cascade is O(templates)** per drill delete — acceptable at club scale (tens of templates); a `>N` warn guard is unnecessary now (unlike the slot O(n²) annotation) but noted.
- **Nav asymmetry** (decision 2) will read as inconsistent to a casual reviewer (clubAdmin sees Drills but not Templates) — the doc comment + this spec are the rationale of record.
- **Shared-host theme collision** (battle-tested): the new pages carry the `--cg-*` literal-value `:host` idiom via the shell cascade — no `:root` skin load.
