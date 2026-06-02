---
title: "Herdbook multi-species / cross-kingdom customization — technical design"
status: design (pre-scaffold) — for review
kind: technical-design
created: 2026-06-02
author: stibe
home: domains/herdbook
relates-to:
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md
origin: >
  Herdbook is becoming a SaaS for breeding associations across different animal
  kinds — and potentially plants. Today it ships as a single Swiss-sheep registry
  with species- and country-specific structure baked into the schema (enums,
  fixed assessment columns, TVD identity, Swiss address fields). This document
  designs how that structure becomes tenant-authored configuration data so one
  pooled deployment can serve many associations, many species, and eventually
  more than one kingdom.
decisions: >
  Brainstorming settled four scoping decisions before design: (D1) reach =
  cross-kingdom incl. plants; (D2) tenancy = shared multi-tenant (pool), so all
  customization is runtime per-tenant data; (D3) authoring = tenant self-service
  (a configuration builder, not only operator-curated profiles); (D4) architecture
  = hybrid (typed invariant spine + data-driven variable layer + JSONB long-tail).
note: >
  The metamodel is a PACK-level change in domains/herdbook (typed pack libs +
  per-tenant rows + metadata JSONB), not a kernel addition, per the ADR-176
  inclusion test. Reproduction is the one kernel-touching concern: selfing already
  works on today's kernel (model a selfed offspring as two same-parent gamete
  edges), but the kinship runner hardcodes the gamete roles `IN ('sire','dam')` —
  parameterizing that by the tenant's gamete_roles is a small substrate change
  brought INTO scope (its own ADR). Only clonal identity and the >2-gamete divisor
  stay demand-gated.
---

# Herdbook multi-species / cross-kingdom customization — technical design

> Today a sheep association and a cattle association cannot share one herdbook
> deployment, because "what a sheep is" lives in Postgres enums and fixed columns.
> This design moves the *species model itself* out of the schema and into
> tenant-authored configuration data — so one pooled deployment serves many
> associations, many species, and eventually plants, while the database that the
> kernel works hard to keep minimal is touched **last and only on demand**.

## 1. Scope, decisions, and the inclusion test

### 1.1 What the SaaS must become

Herdbook v1 is a single Swiss-sheep registry. The product target is a pooled
multi-tenant SaaS where each tenant is a breeding association — sheep, goats,
cattle, and (eventually) plant cultivars — each with its own traits, scorecards,
identity schemes, measurement protocols, and reproduction rules, authored by the
association itself.

### 1.2 The four scoping decisions (settled in brainstorming)

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Reach = **cross-kingdom incl. plants** | The model must generalize beyond two-parent pedigree, wool/markings traits, and national livestock identity |
| D2 | Tenancy = **shared multi-tenant (pool)** | All customization is **runtime per-tenant data** keyed by `tenant_pack_id`; there is no per-deployment seam |
| D3 | Authoring = **tenant self-service** | The species model is tenant-authored data → we build a configuration engine **and** a builder UI, not only operator-curated profiles |
| D4 | Architecture = **hybrid** | Typed invariant spine + data-driven variable layer + `metadata` JSONB long-tail (Section 2) |

### 1.3 Why this is pack territory, not kernel

The substrate kernel is exactly four concerns and is governed by the ADR-176
inclusion test: a thing enters the kernel only if (a) it is one of the four
concerns **and** (b) >=2 packs need it as shared infrastructure the kernel must
validate / query / version.

The species metamodel **fails gate (b)** for everything except lineage: it is
herdbook-specific representation (trait catalogs, scorecards, identity schemes).
Per ADR-176 it lives in the pack as typed libs + per-tenant rows + `metadata`
JSONB — the deliberate simplicity boundary, not a leak. The kernel stays generic.

The **one** exception is reproduction (Section 4): lineage *is* a kernel concern
and *is* used by >=2 packs. The kernel mapping (Section 4.1) shows the lineage
model is already kingdom-agnostic for most of plant reproduction — *selfing
included* (Section 4.4). One small, named kernel change is **in scope** (making the
kinship runner's gamete-role set tenant-configurable); two further reproduction
concerns (clonal identity, >2-gamete divisor) stay demand-gated.

## 2. The hybrid model: spine, variable layer, long-tail

### 2.1 The spine/variable line

The load-bearing decision. Everything else follows from where this line falls.

> **Spine (typed DDL):** true for *any* individual in *any* kingdom, *and* the
> engine itself must query or constrain it.
> **Variable (definition-driven data):** describes *what* an individual is, or
> *how* it is scored / identified / measured / bred within a breeding program.
> **Long-tail:** genuine one-off oddities → `metadata` JSONB.

Applied to the current schema:

| Concern | Today | Lands in | Why |
|---------|-------|----------|-----|
| Individual identity, lineage edges | kernel `core.individual` / `core.lineage_edge` | **Spine (kernel)** | Invariant; the engine traverses it |
| Birth/death/lifecycle events | event rows | **Spine** | Every organism has a lifecycle |
| Person, contact, roles, ownership periods | typed tables | **Spine** | Kingdom-invariant relationships |
| `TraitCategory` enum (markings/wool/…) | DDL enum | **Variable** → `attribute_definition` | Categories vary per species |
| `score*` assessment columns | fixed columns | **Variable** → `assessment_template`+`field`+`attribute_value` | The scorecard differs per breeding program |
| `WeighingSequence` enum | DDL enum | **Variable** → `measurement_protocol` | Cadence/measures vary |
| TVD number + holding | fixed columns | **Variable** → `identity_scheme` | National ID is one scheme among many |
| Person `canton`/`salutation`/`careOf` | fixed columns | **Variable** (address-format config) | Swiss address shape, not universal |
| Reproduction rules (dam/sire) | kernel convention | **Section 4** | The one place that may reach the kernel |

The variable rows are *precisely* the hardcoded enums and fixed columns that make
the current schema species-locked. The line is not arbitrary: the things that are
painful to customize and the things that vary by kingdom are the same set.

### 2.2 Confirmed: the kernel spine is already kingdom-agnostic

The kernel mapping (Section 4.1) confirmed at the DDL level: `core.individual`
carries **no species discriminator** (just `id` + `tenant_pack_id` + `metadata`),
and `core.lineage_edge` has **no two-parent cap** and a **free-TEXT** `parent_role`.
The spine is kingdom-invariant in the database, not merely by assumption.

## 3. The metamodel (the variable layer)

The variable layer mirrors the existing `trait_catalog` pattern exactly:
**definitions** (the schema-as-data a tenant authors) and **instances** (values
recorded against an individual).

### 3.1 Definition layer — what a tenant admin authors

| Definition | Generalizes | Shape |
|------------|-------------|-------|
| `attribute_definition` | `trait_catalog` | Atomic recordable characteristic: `key`, `value_type` (number\|text\|bool\|date\|**code**\|computed), `unit`, `code_list_id` (when type=code), `validation` jsonb (min/max/required/regex), **versioned + append-only** |
| `assessment_template` + `assessment_template_field` | the fixed `score*` columns | Ordered, weighted scorecard; fields point at `attribute_definition`s |
| `measurement_protocol` + `measurement_protocol_step` | `WeighingSequence` enum | Timed measurement sequence with reference-day standardization |
| `identity_scheme` | `tvd_nr` / `tvd_holding` | Named identifier type: format rule, uniqueness scope, issuing authority |
| `reproduction_model` | kernel dam/sire convention | Allowed roles + per-role cardinality + tree-slot roles (display) + **gamete roles (kinship-contributing)** + `allow_selfing`/`allow_clone` flags (Section 4) |
| `derived_field` | `scoreSum` column | A **fixed-menu** aggregation (`sum`/`mean`/`weighted-sum`/`min`/`max`/`count`) over a named field set, realized as a **VIEW** — never stored |

### 3.2 Instance layer — recorded against individuals

- `attribute_value` — **unified for traits + assessment fields**: `individual_id`,
  `attribute_definition_id` + `definition_version`, typed value columns
  (`value_num` / `value_text` / `value_bool` / `value_date` / `value_code_value_id`
  FK), `observed_at`, optional `assessment_instance_id` grouping context.
- `assessment_instance` — one filled scorecard (individual, template+version,
  assessor, date); its field values are `attribute_value` rows.
- `measurement` / `measurement_event` — **separate time-series** instance type
  bound to `measurement_protocol` (decision: measurements are homogeneous series,
  not heterogeneous attributes; they want their own table + time indexing).
- `identity_value` — `individual_id`, `scheme_id`, `value`, validity range,
  per-scheme uniqueness.

### 3.3 The six rules that keep this typed, not EAV soup

1. **Typed-by-value-type storage** — value lands in the column matching
   `value_type`; never one stringly `value` column. A CHECK/trigger enforces
   "exactly one value column non-null, matching the definition's `value_type`."
2. **Definitions are versioned + append-only**; instances bind to the
   `definition_version` they were recorded against — editing a definition never
   rewrites history (the `trait_catalog` D8 rule, generalized).
3. **Computed = views** (`scoreSum`, standardized weight) — ADR-176 "store
   generators, derive graphs."
4. **Code-valued attributes FK into the existing `code_value`** — inheriting the
   4-language `code_translation` machinery for free.
5. **Every row carries `tenant_pack_id` + RLS** — pool-tenancy isolation at the row.
6. **Definitions are the only tenant-writable schema** — the spine stays DDL-fixed.

### 3.4 Two narrowing decisions (settled in brainstorming)

- **Measurements kept separate** from `attribute_value` (3.2) — series, not attributes.
- **Fixed aggregation menu**, not a tenant-authored expression evaluator — a
  closed enum we `switch` over, eliminating a per-tenant code-execution surface on
  pooled infra. Weighted-sum + per-field weights covers the scorecard case.

### 3.5 Worked example — the Swiss sheep scorecard, today vs. tomorrow

Today's four `score*` columns + `scoreSum` become:

- **4** `attribute_definition` rows (`value_type=number`, validation 1–9),
- **1** `assessment_template` "CH-Sheep-Linear v1" with 4 weighted `_field`s,
- **1** `derived_field` `scoreSum` = `weighted-sum` over those fields (a view).

Recording an inspection writes **1** `assessment_instance` + **4** `attribute_value`
rows. A grapevine tenant authors a *completely different* template (berry-size,
cluster-compactness, disease-resistance) with **zero code changes** — just
different definition rows.

## 4. Reproduction model + the one in-scope kernel change

### 4.1 Kernel lineage mapping (verified against substrate source)

| Question | Finding | Citation |
|----------|---------|----------|
| Parent cardinality | **No 2-parent cap**; open set of role-keyed edges; UNIQUE only on `(parent, child, role)` | `substrate-runtime/sql/pedigree-schema.sql:103-119` |
| Parent-role vocabulary | **Free TEXT**, not enum; contracts union `'sire'\|'dam'\|'donor'\|'recipient'` is pack-side type-safety only | `pedigree-schema.sql:108`; `substrate-contracts/.../lineage-repository.port.ts:43` |
| Acyclicity / self-edges | Trigger **rejects self-edges AND cycles**; a literal `X→X` self-loop is blocked (selfing does **not** need one — see 4.4) | `pedigree-schema.sql:147-183` |
| Traversal ports | `parents()` (role-bearing slots), `ancestors()` (dedup, loses roles), `descendants()`, `commonAncestors()`, `kinship()`, `inbreedingCoefficient()`, `recordEdge()`, `deleteEdge()` (exists, ADR-208) | `lineage-repository.port.ts:199-264` |
| **Kinship gamete roles** | Kinship runner `parentsOf` **hardcodes `parent_role IN ('sire','dam')`** and does not dedup (so selfing `[X,X]` computes); the pedigree-*tree* `parents()` does **not** filter roles | `postgres-lineage-repository.ts:604-614`, `:539-560` |
| Individual identity | UUID PK + `tenant_pack_id` TEXT; **no species discriminator**; `metadata` JSONB for species/breed/cultivar | `pedigree-schema.sql:60-71` |

### 4.2 The `reproduction_model` definition

Per-tenant: `allowed_roles[]`, per-role cardinality, `tree_slot_roles[]` (which
roles populate the pedigree tree), `gamete_roles[]` (which roles contribute
genetically → fed to the kernel kinship runner; e.g. `{sire,dam}` or
`{seed-parent,pollen-parent}`), and validation flags `allow_selfing` (one
individual may fill two gamete roles) / `allow_clone`.

### 4.3 What is pure pack — zero kernel touch (works on today's kernel)

| Plant/species need | Where it lives | Change |
|--------------------|----------------|--------|
| Custom roles (`seed-parent`, `pollen-parent`, `clone-source`) recorded | pack validates against `reproduction_model.allowed_roles`, then `recordEdge` (role is free TEXT) | **none** |
| >2 parents / role cardinality | pack enforces cardinality before `recordEdge` | **none** |
| Pedigree tree from configured slots | `pedigree.service` reads `tree_slot_roles` instead of hardcoded `if role==='sire'/'dam'` | **pack generalization** |
| **Selfing** (offspring from one parent providing both gametes) | record **two same-parent gamete edges** (`Y←X` twice, distinct gamete roles); see 4.4 | **none** (verified) |

### 4.4 Selfing works today; the real kernel change is gamete-role parameterization

The kernel mapping first suggested selfing needed a self-edge amendment. Reading
the actual kinship algorithm shows otherwise.

**Selfing is already correct on today's kernel — no self-edge.** Model a selfed
offspring `Y` as **two same-parent gamete edges** (`Y←X` as seed-parent, `Y←X` as
pollen-parent — allowed because `UNIQUE` is on `(parent,child,role)`). Then
`parentsOf(Y) → [X, X]` (the runner does not dedup) and
`computeInbreeding(Y) = computeKinship(X, X) = ½·(1 + F_X)` — exactly the textbook
selfing coefficient. Verified against `kinship-algorithm.ts` (the `idA===idB`
self-kinship branch). A *literal* self-edge (`X→X`, an individual as its own
parent) stays **rejected** — a degenerate model selfing does not require.

**The genuine kernel change (now in scope): the gamete-role hardcode.** The
kinship query runner pins the gamete-contributing roles:

```sql
-- postgres-lineage-repository.ts:604-614 (parentsOf)
WHERE child_individual_id = $1 AND parent_role IN ('sire', 'dam')
```

So a plant tenant using `seed-parent`/`pollen-parent` gets `parentsOf → []` and
kinship/inbreeding silently returns 0. To compute kinship on *any* reproduction
vocabulary, this `IN (...)` set must be **parameterized by the tenant's
`gamete_roles`** (from `reproduction_model`). This is a small, well-scoped
substrate change with its own ADR — brought into scope so selfing and
cross-vocabulary kinship both work. The pedigree *tree* port `parents()` already
returns all roles unfiltered (`postgres-lineage-repository.ts:539-560`), so **only
the kinship runner is coupled**. Bundled with this change: widen the contracts
`LineageEdgeRole` union to an open/branded string so custom gamete roles type-check.

**Still demand-gated (deferred until a plant pack exists):**

1. **Clonal identity** — recording kinship=1 between a clone and its source
   (`clone-source` role) needs a representation decision (kinship-runner handling
   or a `metadata` flag); it is not a gamete relationship.
2. **>2 gamete contributors** — `computeInbreeding` hardcodes
   `expectedParentCount = 2`; polyploid / multi-gamete crosses need the divisor
   generalized (the algorithm already flags this deferred).

## 5. Self-service authoring + governance

### 5.1 The authoring surface (structured editors, not a blank form-builder)

- **Attribute editor** — name, value-type, unit, validation, code-list binding
  (4-language labels via existing `code_translation`).
- **Scorecard builder** — pick/order attribute fields, per-field weight + required,
  choose the derived aggregation from the fixed menu.
- **Measurement-protocol editor** — steps, timing, reference day.
- **Identity-scheme editor** — name, format/regex, uniqueness scope, authority.
- **Reproduction-model editor** — roles, cardinalities, tree slots, flags.

### 5.2 The draft → publish → retire lifecycle (governance core)

```text
draft ──publish──▶ published ──(edit)──▶ forks new draft (supersedes chain)
                       │
                    retire ──▶ retired   (no new instances; old instances still readable)
```

- A version is **immutable once published and referenced** by any instance.
- Editing a referenced version **forks a new draft version** — live records never
  silently re-interpret. (Event-sourcing discipline applied to schema-as-data.)
- Retiring stops *new* instances while keeping history readable. Expand/contract
  applied to definitions.

### 5.3 Guardrails (what keeps pooled infra safe)

1. **Spine read-only to tenants** — the builder exposes only definition tables.
2. **No mutate/delete of referenced versions** — retire, never hard-delete a
   version with instances (the R9 delete-guard pattern already in the codebase).
3. **Definitions validated at publish** — `min<max`, regex compiles, weights sane,
   cardinality bounds — bad schema caught before it accepts data.
4. **Per-tenant quotas** — caps on definitions / template-fields so runaway
   authoring cannot degrade the shared DB.
5. **A privileged `definition_author` role** — distinct from data-entry users;
   RLS for isolation, role for authoring privilege.

### 5.4 On-ramp: operator-curated starter profiles (clone-on-adopt)

Nobody authors a scorecard from a blank page. The operator ships **profiles**
(Swiss-sheep, dairy-cattle, grapevine) as seed bundles of definitions. A new
tenant **clones** a profile into their own draft set (a *copy*, not a live link),
then diverges freely. Operator profile updates never silently mutate a tenant's
live scorecard — an update is a new profile version the tenant can opt-in
re-adopt. This recovers the curated-default value without the propagation risk of
live-linked shared schema.

## 6. Tenancy, migration, and delivery sequence

### 6.1 Tenancy & RLS (pooled infra)

Every definition + instance table carries `tenant_pack_id` with RLS
`USING/WITH CHECK` on the `app.tenant_pack_id` GUC — the `GucPrismaRunner` pattern
already in `0002_herdbook_rls`. **Profiles are operator-scoped** (global); cloning
is the only operation that crosses that boundary. `definition_author` gates
authoring within a tenant.

### 6.2 Swiss data-protection watch-items (named risk, not solved here)

Pooling real Swiss member PII (persons/addresses — animal-side only; plants have
none) raises the nDSG/revFADP bar above RLS alone. RLS is the technical floor
(row isolation); still owed: data-subject export/erasure, per-tenant processing
boundaries, residency. **Flagged for `swiss-pro` escalation** — these gate go-live
with real PII, not the engine design.

### 6.3 Migration — expand/contract (the trait_catalog move, generalized)

1. **Expand** — add metamodel tables *alongside* existing enums + `score*`/TVD
   columns. Nothing dropped.
2. **Backfill** — seed a Swiss-sheep profile whose definitions *exactly reproduce*
   today's hardcoded model; auto-adopt the existing tenant; migrate each row
   (assessment → `assessment_instance` + `attribute_value`s; TVD → `identity_value`;
   weighings → `measurement`s).
3. **Parity window** — read paths switch to the metamodel; old columns kept
   readable; assert `derived scoreSum == old scoreSum` until green.
4. **Contract** — once parity holds, drop the hardcoded enums + `score*` + TVD
   columns. The spine keeps only the invariant.

### 6.4 Delivery sequence — each phase independently shippable

| Phase | Delivers | Kernel? | Value |
|-------|----------|---------|-------|
| **1 — Engine** | definition + instance tables, RLS, the six rules, derived-field views, adapters | none | internal foundation |
| **2 — Migrate live tenant** | Swiss-sheep profile + expand/contract; product runs *on* the metamodel, zero behavior change | none | proof the engine is real |
| **3 — Operator profiles + clone-on-adopt** | a 2nd profile (cattle/goat) → cross-species with **zero code**; onboard new tenant by cloning | none | **cross-species capability lands here** |
| **4 — Self-service builder UI** | tenant editors + draft/publish lifecycle + guardrails + quotas + author role | none | authoring moves operator → tenant |
| **5 — Cross-vocabulary kinship (kernel)** | parameterize the kinship runner's gamete-role set by `reproduction_model.gamete_roles` + widen contracts `LineageEdgeRole`; unlocks selfing & plant-vocabulary kinship | **the one in-scope kernel change** | reproduction works on any vocabulary |
| **6 — Plant pack + remaining deferrals** | *demand-gated*: real plant association signs (clonal identity = kinship 1, >2-gamete divisor) | further amendments | full cross-kingdom |

Cross-*species* value arrives at Phase 3, before the expensive builder. The one
in-scope kernel change (Phase 5) is small and self-contained — selfing computes
correctly the moment a tenant's gamete roles are honored. The remaining
reproduction edge cases (Phase 6) stay demand-gated. If budget stops after Phase 3,
the product is a working multi-species SaaS (operator-onboarded).

## 7. Governance & process

- **Repo:** `domains/herdbook`. PR-gated; verifier wave (`local-ci` + `reviewer` +
  `charter-checker` + `qa-engineer`) — charter-checker to confirm the metamodel
  stays pack-not-kernel.
- **ADR:** this design warrants a herdbook-pack ADR (the spine/variable line + the
  metamodel + the reproduction seam). The Phase-5 gamete-role parameterization gets
  its own substrate ADR (in scope); the Phase-6 deferrals (clonal identity,
  >2-gamete divisor) get theirs when demand arrives.
- **Charter posture:** pack-resident metamodel; `metadata` JSONB as the simplicity
  boundary; kernel minimality preserved (ADR-176).

## 8. Out of scope (explicit)

- The plant pack itself, clonal-identity kinship (=1), and the >2-gamete divisor
  (Phase 6; demand-gated). Selfing itself is **in scope** — it works on today's
  kernel, and Phase 5 parameterizes gamete roles so non-animal vocabularies compute.
- Swiss-DP export/erasure/residency implementation (watch-items; `swiss-pro`).
- Builder UI visual design (follows the metamodel; Angular skills at impl time).
- Any kernel change beyond the Phase-5 gamete-role parameterization (and the named
  Phase-6 deferrals).
