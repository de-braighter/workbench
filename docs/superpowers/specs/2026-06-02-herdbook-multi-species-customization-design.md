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
  This is a PACK-level change in domains/herdbook. It is NOT a kernel addition.
  Per the ADR-176 inclusion test the metamodel lives in the pack (typed pack libs
  + per-tenant rows + metadata JSONB), not the kernel. Exactly one future kernel
  amendment is identified (selfing / self-edges) and is deliberately DEFERRED
  until a plant pack creates the >=2-pack demand.
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
and *is* used by >=2 packs. But the kernel mapping (Section 4.1) shows today's
lineage model is already kingdom-agnostic for ~90% of plant reproduction; the
remaining 10% is a single, named, **deferred** amendment.

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
| `reproduction_model` | kernel dam/sire convention | Allowed parent roles + per-role cardinality + tree-slot roles + `allow_selfing`/`allow_clone` flags (Section 4) |
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

## 4. Reproduction model + the single deferred kernel amendment

### 4.1 Kernel lineage mapping (verified against substrate source)

| Question | Finding | Citation |
|----------|---------|----------|
| Parent cardinality | **No 2-parent cap**; open set of role-keyed edges; UNIQUE only on `(parent, child, role)` | `substrate-runtime/sql/pedigree-schema.sql:103-119` |
| Parent-role vocabulary | **Free TEXT**, not enum; contracts union `'sire'\|'dam'\|'donor'\|'recipient'` is pack-side type-safety only | `pedigree-schema.sql:108`; `substrate-contracts/.../lineage-repository.port.ts:43` |
| Acyclicity / self-edges | Trigger **rejects self-edges AND cycles**; selfing `X→X` is blocked | `pedigree-schema.sql:147-183` |
| Traversal ports | `parents()` (role-bearing slots), `ancestors()` (dedup, loses roles), `descendants()`, `commonAncestors()`, `kinship()`, `inbreedingCoefficient()`, `recordEdge()`, `deleteEdge()` (exists, ADR-208) | `lineage-repository.port.ts:199-264` |
| Individual identity | UUID PK + `tenant_pack_id` TEXT; **no species discriminator**; `metadata` JSONB for species/breed/cultivar | `pedigree-schema.sql:60-71` |

### 4.2 The `reproduction_model` definition

Per-tenant: `allowed_roles[]`, per-role cardinality, `tree_slot_roles[]` (which
roles populate the pedigree tree vs. informational roles like donor/recipient),
and forward-compat flags `allow_selfing` / `allow_clone`.

### 4.3 What is pure pack — zero kernel touch (works on today's kernel)

| Plant/species need | Where it lives | Change |
|--------------------|----------------|--------|
| Custom roles (`seed-parent`, `pollen-parent`, `clone-source`) | pack validates against `reproduction_model.allowed_roles`, then `recordEdge` (role is free TEXT) | **none** |
| >2 parents / role cardinality | pack enforces cardinality before `recordEdge` | **none** |
| Pedigree tree from configured slots | `pedigree.service` reads `tree_slot_roles` instead of hardcoded `if role==='sire'/'dam'` | **pack generalization** |
| Kinship / inbreeding | kernel algorithm is already role-agnostic (sums all parents, missing→0) | **none** (semantic caveat: coefficient interpretation shifts with custom cardinality) |

### 4.4 What is deferred to the kernel — ADR-176-gated until a plant pack exists

1. **Selfing** — the acyclicity trigger rejects self-edges, so `allow_selfing`
   cannot be honored. Future small ADR amendment: exempt a designated `self` role
   (or `is_self_cross` flag) from the self-edge check.
2. **Clonal identity** — recording kinship=1 between a clone and its source needs
   a representation decision (edge convention or `metadata` flag).
3. **Contracts role type** — widen `LineageEdgeRole` from the closed union to an
   open/branded string. A *contracts* change (not schema), only when a plant pack ships.

**Forward-compat:** `allow_selfing`/`allow_clone` exist in the model **now**;
today the pack rejects a selfing edge with a clean
`"selfing requires kernel support (deferred)"` error. When a plant pack creates
the demand, the kernel amendment + flag-flip is the *only* added work — nothing in
the pack reshapes.

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
| **5 — Plant pack + selfing amendment** | *demand-gated*: real plant association signs | **the one amendment** | cross-kingdom |

Cross-*species* value arrives at Phase 3, before the expensive builder. The kernel
is touched only at Phase 5, only on demand. If budget stops after Phase 3, the
product is a working multi-species SaaS (operator-onboarded).

## 7. Governance & process

- **Repo:** `domains/herdbook`. PR-gated; verifier wave (`local-ci` + `reviewer` +
  `charter-checker` + `qa-engineer`) — charter-checker to confirm the metamodel
  stays pack-not-kernel.
- **ADR:** this design warrants a herdbook-pack ADR (the spine/variable line + the
  metamodel + the deferred kernel seam). The kernel amendment (4.4) gets its own
  future substrate ADR when demand arrives.
- **Charter posture:** pack-resident metamodel; `metadata` JSONB as the simplicity
  boundary; kernel minimality preserved (ADR-176).

## 8. Out of scope (explicit)

- The plant pack itself and the selfing kernel amendment (Phase 5; demand-gated).
- Swiss-DP export/erasure/residency implementation (watch-items; `swiss-pro`).
- Builder UI visual design (follows the metamodel; Angular skills at impl time).
- Any change to the kernel beyond the named, deferred amendment.
