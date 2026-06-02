---
title: "Herdbook mating planner (planned-matings registry) — technical design"
status: design (pre-scaffold) — for review
kind: technical-design
created: 2026-06-02
author: stibe
home: domains/herdbook
relates-to:
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - docs/superpowers/specs/2026-06-02-herdbook-multi-species-customization-design.md
origin: >
  A breeding registry has animals + pedigree + the kernel's kinship/inbreeding
  math, but no surface to plan a mating: pick a sire and a dam and see how inbred
  the offspring would be before deciding to breed. This designs a planned-matings
  registry — evaluate a pair, persist the plan, track it to offspring, and compare
  the predicted inbreeding coefficient against the offspring's actual one.
decisions: >
  Settled in brainstorming: (D1) scope = planned-matings registry (evaluate +
  persist + lifecycle), not just a live calculator; (D2) verdict thresholds live
  in the per-tenant Setting table with conventional defaults (amber >= 1/32,
  red >= 1/16); (D3) offspring link back to the mating (predicted-vs-actual);
  (D4) architecture = pack-native registry, evaluator over the kernel kinship
  port, zero kernel change.
note: >
  PACK-level feature in domains/herdbook. NOT a kernel addition: a "mating" is
  herdbook-specific breeding and fails the ADR-176 inclusion test (needed by one
  pack, not >=2), so it stays pack-resident even though it looks plan-node-shaped.
  The kinship / commonAncestors / inbreedingCoefficient primitives it consumes
  already exist on the published LineageRepository port (substrate-contracts).
---

# Herdbook mating planner (planned-matings registry) — technical design

> A registrar deciding whether to breed two animals needs one number before they
> commit: how inbred would the offspring be? The kernel already computes
> `kinship(sire, dam)` — which *is* that offspring's would-be inbreeding
> coefficient — and `commonAncestors` to explain why. This feature turns those
> primitives into a planning surface: evaluate a pair against the association's
> threshold, save the plan, carry it to the registered offspring, and learn from
> the gap between predicted and actual.

## 1. Scope, decisions, and the inclusion test

### 1.1 What it is

A planned-matings registry for the herdbook pack: a registrar selects a sire and
a dam, sees the predicted offspring inbreeding coefficient (F) with a
green/amber/red verdict and the shared ancestors driving it, and persists the
pairing as a tracked plan (`planned → mated → offspring-registered`/`cancelled`).
Once offspring are registered they link back to the mating, enabling a
predicted-vs-actual comparison.

### 1.2 The four decisions (settled in brainstorming)

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Scope = **planned-matings registry** | Evaluate + persist + lifecycle + offspring link — not just a live calculator |
| D2 | Thresholds in the **per-tenant `Setting` table** | Standard defaults (amber >= 1/32 ~= 3.125%, red >= 1/16 = 6.25%); each association can tune later |
| D3 | **Link offspring** back to the mating | Predicted-vs-actual F comparison once the offspring's pedigree exists |
| D4 | Architecture = **pack-native registry** | New pack table + port + adapter + evaluator over the kernel kinship port; zero kernel change |

### 1.3 Why pack, not kernel (the inclusion test)

A planned mating looks kernel-shaped: the substrate kernel's first concern is
"recurse the plan — intervention nodes carrying typed effect declarations," and a
mating is an intervention with a predicted effect (the offspring's F). But the
ADR-176 inclusion test requires a concept be (a) one of the four kernel concerns
**and** (b) needed by **>= 2 packs**. "Mating" is herdbook-specific breeding; no
second pack needs it. It fails gate (b) → pack territory. The kernel primitives it
consumes (`kinship`, `commonAncestors`, `inbreedingCoefficient`) already exist on
the published `LineageRepository` port; this feature only *reads* them.

## 2. Data model

### 2.1 New table `planned_mating` (herdbook schema)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | app-assigned uuid (pack convention) |
| `tenant_pack_id` | TEXT | RLS-scoped |
| `sire_animal_id` | TEXT → `herdbook.animal(id)` ON DELETE RESTRICT | validated male at create |
| `dam_animal_id` | TEXT → `herdbook.animal(id)` ON DELETE RESTRICT | validated female at create |
| `predicted_f` | `NUMERIC(8,6)` | snapshot of `kinship(sire, dam)` at plan time |
| `predicted_verdict` | `MatingVerdict` enum | snapshot verdict at plan time |
| `status` | `MatingStatus` enum | manual lifecycle |
| `planned_date` | DATE | |
| `notes` | TEXT NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ(6) | |
| `created_by_user_id` / `updated_by_user_id` | TEXT | audit (mutable record — full quartet) |

Enums (Postgres, matching the pack's `AnimalPersonRoleKind` convention):

- `MatingVerdict`: `green` / `amber` / `red`
- `MatingStatus`: `planned` / `mated` / `offspring_registered` / `cancelled`

`predicted_f` + `predicted_verdict` are **deliberate snapshots of derived values** —
the decision record at plan time. The live value is recomputed on display (§4.3).
Persisting derived state in a *pack* is charter-sound (ADR-176's "store generators,
derive graphs" is kernel-scoped; the same ruling applied to the player-trait work).

### 2.2 Offspring link (mirrors the `litter_id` pattern)

A nullable `from_planned_mating_id` FK on the existing `animal` table (ON DELETE
SET NULL), with an `offspring Animal[]` back-relation on `planned_mating`. This
matches the existing `animal.litter_id → litter` precedent exactly: one mating →
many offspring (the litter case), the heavily-used `animal` table gains only a
safe additive nullable column, and both "a mating's offspring" and "which mating
produced this animal" are one query. A join table is rejected — it would wrongly
imply many-to-many (an animal has at most one origin mating).

### 2.3 Thresholds in `Setting`

Two per-tenant `Setting` rows, seeded by `db:setup`:

- `mating.inbreeding.amberThreshold` = `0.03125`
- `mating.inbreeding.redThreshold` = `0.0625`

The evaluator reads them, falling back to those constants if absent. Editing them
is a future hook into the customization-engine admin surface; for now they are
seed-managed per tenant.

## 3. The evaluator (read path)

`MatingEvaluatorService.evaluate(sireAnimalId, damAnimalId)`:

1. Resolve both animals (pack `IndividualReadAdapter` / animal read) → their
   `kernelIndividualId` + `sex`. Validate: sire is male, dam is female, and the
   two are distinct animals (else a typed `invalid-pairing` error).
2. `lineage.kinship(sireKernelId, damKernelId)` → the predicted offspring F (the
   kinship coefficient between the parents *is* the offspring's inbreeding
   coefficient — no hypothetical record needed).
3. `lineage.commonAncestors(sireKernelId, damKernelId)` → the shared ancestors
   that explain the relatedness (rendered as the "why").
4. Load the two thresholds from `Setting` → verdict: `F < amber` ⇒ `green`,
   `amber <= F < red` ⇒ `amber`, `F >= red` ⇒ `red`.
5. Return `MatingEvaluation { predictedF, predictedFPct, verdict, sharedAncestors[], thresholds }`.

Pure read; no persistence. Reuses the kernel kinship + commonAncestors machinery
the pedigree already consumes.

## 4. Registry service + lifecycle + predicted-vs-actual

### 4.1 Port + adapter

`PlannedMatingRepository` (port) + `PrismaPlannedMatingAdapter` (ScopedRunner raw
SQL, the established pack adapter pattern — `enum::text` read casts, TEXT ids,
`randomUUID()`). Methods: `create`, `list`, `findById`, `updateStatus`,
`update` (notes/cancel), `linkOffspring(matingId, animalId)`,
`unlinkOffspring(matingId, animalId)`, `listOffspring(matingId)`.

### 4.2 Lifecycle

`create` calls the evaluator first, snapshots `predicted_f` + `predicted_verdict`,
validates sex/self, and inserts at status `planned`. Status advances manually
(`planned → mated → offspring_registered`, or `cancelled`). `linkOffspring` sets
`animal.from_planned_mating_id = matingId` (soft check: warn if the offspring's
recorded sire/dam don't match the mating's — non-blocking). `unlinkOffspring`
clears it.

### 4.3 Predicted-vs-actual

On a mating's detail, for each linked offspring the service calls
`lineage.inbreedingCoefficient(offspringKernelId)` (live actual F) and returns it
alongside the snapshot `predicted_f`. The mating detail also recomputes the
*current* `kinship(sire, dam)` so a registrar sees whether the prediction has
drifted as pedigree data grew. This is the calibration payoff of persisting
matings rather than only evaluating live.

## 5. API + permissions

### 5.1 Endpoints (`MatingController`)

| Method + path | Purpose |
|---------------|---------|
| `POST /matings/evaluate` | Evaluate `{sireAnimalId, damAnimalId}` → `MatingEvaluation` (read, no persist) |
| `POST /matings` | Create a planned mating (snapshots F + verdict) |
| `GET /matings` | List planned matings (sire×dam summary, predicted F, verdict, status) |
| `GET /matings/:id` | Detail incl. offspring list + predicted-vs-actual + live recompute |
| `PATCH /matings/:id` | Update status / notes / cancel |
| `POST /matings/:id/offspring` | Link an offspring animal `{animalId}` |
| `DELETE /matings/:id/offspring/:animalId` | Unlink an offspring |

`actorUserId` is server-derived from `TenantPackContext.userId` (the controller
pattern used across herdbook); request DTOs omit it.

### 5.2 Permissions + audit

New manifest permissions: `herdbook.mating.read`, `herdbook.mating.plan` (+
`herdbook.mating.update` for status/notes), granted to the `registrar` role. New
audit subtypes `mating.plan` + `mating.update`. `MatingController` registered in
`HERDBOOK_CONTROLLERS` (the decorator-reference validation runs at bootstrap).

## 6. UI surface

A "Matings" nav section:

- **Planner page** — sire + dam animal pickers → a live `MatingEvaluation` card
  (predicted F %, verdict, shared-ancestors list) → "Save plan".
- **Matings list** — status, sire × dam, predicted F, verdict.
- **Mating detail** — lifecycle controls, the offspring list with predicted-vs-actual
  F, and the live-recompute drift indicator.
- An entry point from the **animal detail** page ("plan a mating for this animal" →
  pre-fills one side).

a11y: the verdict is conveyed by a glyph + screen-reader word, **never colour
alone** (the canonical herdbook/exercir convention); the predicted-vs-actual delta
uses a directional glyph, not colour. Angular standalone + OnPush, following the
existing herdbook-ui patterns.

## 7. Phasing

| Slice | Delivers | Kernel? |
|-------|----------|---------|
| **1 — backend** | enums + `planned_mating` table + offspring FK + RLS + threshold seed + evaluator + registry port/adapter + API + permissions + two-tier tests (fakeRunner shape + DB-gated RLS/round-trip/predicted-vs-actual) | none |
| **2 — UI** | the Angular Matings surfaces (planner / list / detail) + the animal-detail entry | none |

## 8. Governance & out of scope

- **Repo:** `domains/herdbook`. PR-gated; verifier wave (local-ci + reviewer +
  charter-checker + qa-engineer). Pack-resident; zero `core.*` change.
- **Out of scope:** the mate *recommender* (ranking all candidates by lowest F — a
  later enhancement on top of the evaluator); the register-offspring create-flow
  shortcut (offspring are linked, not created, in v1); marker/genomic kinship
  methods (the kernel's `KinshipComputationMethod` non-default paths are deferred);
  threshold editing UI (seed-managed until the customization-engine admin lands).
- **ADR:** warrants a herdbook-pack ADR (the registry + the evaluator-over-kernel
  pattern). No kernel ADR — nothing kernel changes.
