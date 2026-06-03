# Drill Library — Define / Search / Display (design)

- **Date:** 2026-06-04
- **Status:** design (brainstormed autonomously per founder directive; decisions documented below)
- **Domain:** `de-braighter/domains/exercir` — `pack-football` (model + use-case), `pack-football-api` (endpoint), `pack-football-contracts` (DrillWire), `pack-football-ui` (search/display/create)
- **Goal:** a kids-football coach can **define** a new drill from scratch, **search** the drill library by text + facets, and **display** a drill with its prose objective + diagram.
- **Governing:** ADR-158 (intervention catalog), ADR-160 Scene 4 (drill-diagram editor), ADR-033 §4 (vendor-tier immutability), ADR-176 (metadata-JSONB extension boundary), prototype-assumptions-charter (in-memory demo persistence).

---

## 1. Summary

The browse + diagram-authoring surface already exists (`DrillBibliothekComponent`, `DrillBoardEditorComponent`, `GET /pack-football/drills`, `POST /drills/:key/fork`, `PUT /drills/:key/diagram`). This design closes three gaps so a coach can run the full loop:

- **DEFINE** — create a brand-new drill (name + description + metadata + diagram), not just fork a vendor template.
- **SEARCH** — text search over name/description + facet filters (equipment, age band) on top of the existing phase/intensity filters.
- **DISPLAY** — a prose `description` (objective/instructions) alongside the diagram, plus the requirements, in the detail view.

Persistence stays **in-memory tenant-tier** (the same delta layer fork uses) — consistent with the running demo and the prototype charter. Prisma persistence is a deliberate follow-up.

---

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Coach-facing fields | Add **`name`** + **`description`** to drill `metadata` (passthrough JSONB) | `name` distinct from the system key; `description` = the prose objective a kids coach needs (diagram alone is insufficient). Metadata-extension, no kernel change (ADR-176). |
| D2 | DEFINE path | **`CreateDrillUseCase` + `POST /pack-football/drills`** → tenant-tier drill in the existing in-memory delta; UI create-form → opens `DrillBoardEditorComponent` | Mirrors fork's persistence (in-memory, demo posture). The form captures metadata; the existing editor authors the diagram. |
| D3 | SEARCH | **Client-side** over an enriched `DrillWire` (+ `description` + `requirements`) | Catalog is tiny (12 vendor + a few tenant); `GET /drills` already returns all. Instant filtering, no new endpoint. |
| D4 | Persistence | **In-memory tenant delta** (no Prisma) | Matches the running demo + fork behavior; the prototype charter sanctions in-memory. Prisma is a separate follow-up. |
| D5 | Vendor-tier safety | Create only ever writes **tenant-tier**; vendor drills stay immutable (ADR-033 §4) | A created drill is always `tier: 'tenant'`, never mutates the frozen manifest. |

---

## 3. Architecture (three slices, one PR each)

### Slice 1 — Backend: model + create + enriched wire

**`pack-football` (domain):**
- The drill `metadata` gains optional `name?: string` + `description?: string` (passthrough — no schema-shape change required; they ride the existing JSONB). The `requirements` sub-object already exists (`minPlayers`, `maxPlayers`, `equipment[]`, `ageBands[]`).
- **`CreateDrillUseCase`** (`in-ports/create-drill.use-case.ts`): input `{ name, description?, phase, intensity, requirements?, diagram? }`. Validates (name non-empty; phase/intensity in the known sets); mints `key = 'football.intervention.drill.custom.' + shortUuid`; builds the `Intervention` and registers it in the catalog repository's **tenant-tier delta** (sibling to `forkTemplate`); emits `DrillCreated.v1`. Returns the created drill entry.
  - **Tier marker (important):** `InterventionSchema.metadata.tier` is pinned to `'vendor'` (S-3), and the wire `tier` is derived as `metadata.forkedFrom === undefined ? metadata.tier : 'tenant'`. A *created* drill has no `forkedFrom`, so it would wrongly read `vendor`. The `toWire` mapper must instead report `tier: 'tenant'` for **any key in the tenant delta** — i.e. the list use-case / repository tags tenant-tier entries (the repo already knows its tenant keys), and `toWire` consults that rather than only `forkedFrom`. Cleanest: the `DrillCatalogEntry` the repo returns carries an explicit `tier: 'vendor' | 'tenant'` field set by the repo from delta membership; `toWire` passes it through. This fixes both fork and create uniformly.
- **Repository:** extend `INTERVENTION_CATALOG_REPOSITORY` with `createDrill(input): Intervention` writing to the existing tenant-tier maps (sibling to `forkTemplate`). The default `ManifestInterventionCatalogRepository` implements it.

**`pack-football-contracts`:** enrich the `DrillWire`/squad-style wire (wherever `DrillWire` lives — `drill-diagram.schemas.ts` or a new `drill.schemas.ts`) with `description?: string` and `requirements?: { minPlayers?, maxPlayers?, equipment: string[], ageBands: string[] }`. `name` already exists.

**`pack-football-api`:** **`POST /pack-football/drills`** on the drills controller — `@RequiresPermission(FOOTBALL_PERMISSIONS.drillWrite)`, body-validated via a Zod schema mirroring the create input, calls `CreateDrillUseCase`, returns the enriched `DrillWire`. Failure mapping: invalid-input → 400.

**Also:** `GET /pack-football/drills`'s `toWire` mapper now surfaces `description` + `requirements` from the intervention metadata so the client can search/filter + display them.

**Tests:** create-drill use-case (mints tenant key, stores, emits event, validates), controller (201/200 happy + 400 invalid + permission), toWire enrichment (description + requirements present).

### Slice 2 — Frontend: search + display

**`pack-football-ui`:**
- **`drill-catalog.client.ts`** + the `DrillCatalogEntry` wire mirror: add `description` + `requirements`.
- **`DrillBibliothekComponent`** (library view):
  - **Search box** — a text input; client-side filter matching `name` + `description` (case-insensitive substring).
  - **Facet filters** — equipment multi-select + age-band multi-select, derived from the union of all loaded drills' requirements, ANDed with the existing phase/intensity filters and the text query.
  - **Detail panel** — show `name` prominently, the `description` prose, and the `requirements` (equipment / age / players) alongside the existing diagram + phase/intensity pills.
- All filtering is a pure `computed()` over the loaded list + the filter signals (text, phase, intensity, equipment, ageBands).

**Tests:** text search narrows the list; equipment/age facet filters narrow + combine with phase/intensity; detail panel renders description + requirements; empty-result state.

### Slice 3 — Frontend: define (create form)

**`pack-football-ui`:**
- **`DrillCreateFormComponent`** (`drills/drill-create-form.component.ts`) — a reactive form: `name` (required), `description` (textarea), `phase` (select), `intensity` (select), `equipment` (chips/multi-add), `minPlayers`/`maxPlayers` (number), `ageBands` (multi-select). On submit → `drillCatalog.createDrill(input)` → on success emit `created(drillKey)`.
- **Wiring** — a "Neuer Drill" button in `DrillBibliothekComponent` opens the create form (inline panel or a route). On `created`, it either opens `DrillEditorPanelComponent`/`DrillBoardEditorComponent` for the new drill's diagram, or returns to the library with the new drill selected. (Pick the inline-panel flow to stay within the existing master-detail shell.)
- **`drill-catalog.client.ts`** gains `createDrill(input, signal?)` → `POST /pack-football/drills`.

**Tests:** form validation (name required); submit calls createDrill with the right payload; success opens the diagram editor for the new drill; create failure surfaces inline (German copy via the existing failure-describe helper).

---

## 4. Data flow

```
CREATE:  DrillCreateForm → drillCatalog.createDrill → POST /drills
         → CreateDrillUseCase → repo.createDrill (tenant delta) → emit DrillCreated.v1
         → returns DrillWire → UI opens DrillBoardEditor for the new drill's diagram
SEARCH:  GET /drills → DrillCatalogEntry[] (now w/ description+requirements)
         → DrillBibliothek computed(filter: text + phase + intensity + equipment + ageBands)
DISPLAY: selected entry → detail panel: name + description + requirements + diagram
```

---

## 5. Out of scope (follow-ups)

- **Prisma persistence** of tenant-created drills (in-memory today; lost on restart — matches the demo). Charter-noted.
- **Edit/delete** of a created drill's metadata (this arc covers create + diagram-edit via the existing PUT; metadata-edit-after-create is a follow-up).
- **Server-side search** (only needed if the catalog grows large).
- **Drill effects authoring** (the `effects` EffectDeclaration array — vendor drills have them; created drills get none initially).
- **Vendor-drill descriptions** — the `description` field exists for all tiers, but back-filling prose onto the 12 vendor drills is content work, not in this arc.

---

## 6. Open questions

None blocking. The create-flow UX (inline panel vs route) is settled as **inline panel** to reuse the existing master-detail shell; the diagram step reuses `DrillBoardEditorComponent` unchanged.
