---
product_key: oncology
build_path_date: 2026-06-12
status: build-path
charter: layers/specs/concepts/oncology-product-charter.md
risk_tier: T2
item_count: 8
---

# Build Path — Oncology (Swiss breast-cancer-survivorship MDR device)

> **Adapted stage-4 run.** The foundry pipeline stages 1–3 (dossier-intake →
> opportunity-brief → tiered charter Gate 1) are **already satisfied** for this
> product by the ratified **Oncology Product Charter**
> (`layers/specs/concepts/oncology-product-charter.md`, `status: ratified`,
> adopted by **ADR-221**; data-protection / survival-family successors in
> **ADR-222** / **ADR-223**). This document is the build-path (stage 4) only:
> the epic ladder, ADR needs + gates, the quality battery, and the disjoint
> claimable items. `charterRef` points at the ratified charter; the charter —
> **not** the superseded prototype-assumptions-charter — is the tier authority.
>
> **⚠ Charter access (follow-up).** The canonical path
> `layers/specs/concepts/oncology-product-charter.md` currently holds only a
> 16-line **redirect stub** (WS-2 knowledge-corpus reorg; its `moved-to` target
> `domains/health/docs/design/oncology-product-charter.md` was never created —
> the physical move is PARKED). The **full 504-line ratified charter** is
> recoverable from git history:
> `git -C layers/specs show e6389ee~1:concepts/oncology-product-charter.md`.
> Restoring it to a readable canonical location is a **specs-repo follow-up**
> (not done in this build-path session). Claimants: read the charter via the git
> command above until it is restored.
>
> **First T2 product in the foundry.** Risk tier **T2 (regulated)**: per-ADR
> founder gates, designer-first for any new port, the highest quality battery,
> and **no real PHI in any build artifact** — synthetic / fabricated cohorts
> only, until the charter §11 demo→real gate is crossed by a real consented
> patient (a regulated-operations event, never a build step).

## Status of the prior arc (already DONE — NOT queued)

The substrate-side prerequisites the charter §9 commits the product to are
**already shipped** and must not be re-queued:

- **B1 — PHI field-encryption** (ADR-222): `FieldCipher` / `KeyProvider` /
  `AesGcmFieldCipher` / `fieldEncryptionExtension` (nested-PHI relation-graph
  traversal) / blind-index companions / crypto-shred erasure — all 6 slices +
  the durable `kernel.audit_event` WORM follow-up, proven end-to-end against
  live Postgres in `domains/health/libs/health-api` (the live B1 proof).
- **B3 — survival inference family, first arc** (ADR-223): contracts + Weibull
  / log-logistic / Kaplan-Meier adapters + 3 `distribution_catalog` rows + the
  production `event_log` survival read + event-sourced run-manifest persistence
  + `sample()` + the production goodness-of-fit signal (`fitDivergence` /
  `fitMisfitFlag`) + survival `counterfactual()` + **the charter §11
  synthetic-cohort validation gate** (Layer-1 per-fit misfit detection across 3
  families + Layer-2 two-arm PH-residual). S1→S5b complete.
- **substrate 2.0.0 / 2.1.0 PUBLISHED** (2026-06-11) — contracts + runtime on
  GitHub Packages. **Real-PHI survival fits are unblocked, behind the §11 gate.**

This build path is the **health-product** half: the PHI data layer, the
breast-survivorship pathway, the survival-twin wiring on the health DB, EPD
ingest/egress, and a small cross-repo hardening tail.

## Scaffold plan

**Not greenfield — no E1 scaffold.** The target repo `de-braighter/health`
already exists and builds green (B1 shipped here):

- `libs/health-api` — NestJS + Prisma data layer. Multi-schema (`health` +
  `kernel`), flat `src/`, `prisma/schema.prisma` (models: `Patient`,
  `AuditEvent*`), 3 migrations. Composes `SubstrateModule.forRoot({ keyProvider,
  fieldEncryptionRegistry })`. Dev DB `health-postgres` **:5546**, two-role
  (`app` NOSUPERUSER + `auditor`), `ci:local` (DB-free) + `ci:local:db`.
- `libs/health-fhir` — FHIR projection lib (currently **R5** / mCODE export
  foundation, ADR-204). Pure projectors + opt-in NestJS HTTP surface. **The EPD
  ingest/egress (R4) home** — R4 is a *new* surface here (an `r4/` subtree),
  deliberately NOT the R5 export (charter §6: the EPD wire format is R4; R4↔R5
  conflation is a known defect class).

**Substrate version (claim-time verification — the known trap).** Both libs
pin `@de-braighter/substrate-{contracts,runtime}@^1.1.0`. The survival family
(needed by **O-3**) exists only in **2.x**, and pnpm resolves a single version
per workspace, so the bump to **`^2.1.0`** is **atomic across both libs + the
root `pnpm-lock.yaml`** and pulls the **6-arg router migration** (the
`InferenceRunRecorder` forRoot binding, per
`layers/substrate/docs/migration-substrate-2.0.md`). **O-1 owns this bump** as
the arc foundation. Worker note: adjudicate every substrate-API claim against
the consumer's `node_modules` `.d.ts`, **never** `layers/substrate` source
(main carries unpublished surface).

**Worktree hygiene (Windows).** Claim worktrees land under
`domains/<repo>/.claude/worktrees/<slug>` — long paths. Add
`.npmrc virtual-store-dir-max-length=60` for the pnpm install; fresh install
per worktree; never run git ops in the shared clone.

## Epic ladder

| Epic | Capability (one-line deliverable) | Acceptance (sketch) |
|---|---|---|
| **O-1** | Oncology PHI data layer `patient → tumor → observation` + the substrate-2.x foundation | Tumor + observation PHI tables (encrypted-at-rest, RLS-isolated, blind-indexed where queried); `fieldEncryptionExtension` gets the live relation graph from `client._runtimeDataModel`; nested-PHI encrypt/decrypt proven against live PG under the `app` role; workspace on substrate `^2.1.0`, 6-arg router wired; `ci:local` + `ci:local:db` green. |
| **O-2** | Breast-survivorship pathway plan-tree + effect declarations | A single-parent kernel plan-tree for the survivorship pathway (surveillance / endocrine-adherence / fatigue-exercise / psychosocial / recurrence-monitoring) seeded via substrate primitives, carrying survival-effect declarations in `metadata` JSONB; clinical content reused from `swiss-top5-cancer-pathways.md` (content only, NOT its superseded architecture); synthetic, no patient PHI. |
| **O-3** | Survival-twin wiring — synthetic cohort → §11-gated posterior → replay | A synthetic real-*shaped* breast-survivorship cohort seeded into the health `kernel.event_log`; a survival posterior fit through the §11-gated family (Weibull/LL/KM) composing O-2's effect declarations as log-HRs; **the fit cites + passes the §11 validation gate**; the run is an ADR-220 run-manifest, replayed bit-identically on the health DB. Output runs in **shadow / validation mode** (charter §8 rung-0 — unclaimed). |
| **O-4** | B2 — EPD-FHIR **R4** ingest (CH Core v7 / IHE MHD v4.2.2), sandboxed | A sandboxed read-ingest path: pull a patient's oncology documents (IHE MHD `DocumentReference` + `Binary`/XDS retrieve) and map the breast-cancer **mCODE** profile set (primary condition / TNM staging / tumor-marker + disease-status observations) into the O-1 schema. R4-only; reference/sandbox community, **no real Stammgemeinschaft calls, no real PHI**. Deliverable-B "B2" ADR. |
| **O-5** | B4 — EPD egress (survivorship `CarePlan` write-back), **rung-2-gated** | Staged-but-inactive: compose + write the survivorship `CarePlan` and structured documents back via IHE MHD/XDS provide-register, with write-back consent flows. **Activates only at charter rung-2** (full IIb target) — held behind a foundry **founder gate**, not merely a `dependsOn`. Deliverable-B "B4" ADR. |
| **O-6** | Hardening tail (cross-repo, parallel-friendly) | Three disjoint follow-ups: a **real cloud-KMS adapter** behind the existing `KmsKekClient` port (substrate); **substrate#137 WORM-trigger adoption** (substrate); the health **`requireScope` unit test + a non-`app` `closeAnchor` role** (health). |

## UI-surface plan

**No UI surfaces in this wedge.** The charter's build-path wedge is the
**data + survival-twin + EPD spine** — the patient/clinician-facing
application is a later product cycle (charter §2 describes the twin; §12
"Out of scope" defers journey slices to sub-project #3). Consequently: **no UI
epic, no shell sequencing item, no `a11y-battery` obligation, no i18n surface**
in this build path. When the patient/clinician UI is later chartered it adds
its own UI epic + shell item per the standard F4 UI-surface procedure.

## ADR needs & gates

T2 ⇒ each new port / regulated-architecture decision is **designer-first**, and
its ADR is a **per-ADR founder gate** (the claimant authors the ADR in its own
session and the founder ratifies it via the PR — the normal spec-PR flow is the
gate; the foundry-level gate record is reserved for the rung-2 promotion below).

| Item | ADR need | Gate |
|---|---|---|
| **O-1** | Oncology PHI data-layer design **extending ADR-222** (the `tumor`/`observation` schema, the relation-graph re-wire, blind-index posture on the new tables). Designer-first. | Founder ratifies the ADR/design-note PR. |
| **O-2** | Breast-survivorship pathway model design-note (the plan-tree shape + effect-declaration encoding on `metadata`; consumes ADR-199/200). Designer-first (light — no new port). | Founder ratifies the design-note PR. |
| **O-3** | No new ADR — consumes ADR-223 (survival family) + ADR-220 (reproducibility). A design-note for the cohort-seeding + shadow-mode wiring. | — (rides existing ADRs). |
| **O-4** | **Deliverable-B "B2"** ADR — the EPD-FHIR **R4** ingest architecture (bundle composition, reference resolution, mCODE profile binding strengths, per-access AuditEvent). New port (the IHE-MHD client). Designer-first. | **Per-ADR founder gate** (charter §6/§12 hands this to `fhir-pro`). |
| **O-5** | **Deliverable-B "B4"** ADR — the egress write protocol (IHE MHD/XDS provide-register, write-back consent). New port. Designer-first. | **Rung-2 founder gate** (below) **+** per-ADR gate. |
| **O-6.1** | Cloud-KMS provider ADR (which KMS; the `KmsKekClient` port already exists — this is the provider decision, not a new port). Designer-first (light). | Founder ratifies the provider ADR. |
| **O-6.2 / O-6.3** | No new ADR. | — |

**Charter §12 founder/consultant matters — gates & risks, NOT work items.**
These are recorded here so they are not silently encoded as build work; each is
a founder + external-consultant decision the build path must not pre-empt:

- MDR conformity-assessment route + notified body; **CH-REP** identity; the
  rung-0 IIa-vs-IIb borderline confirmation (§3/§8).
- PCCP envelope parameters + PMS/PSUR cadence (§10).
- nDSG retention periods, Swiss hosting provider, consent text, per-provider
  assurance-level bindings (§4/§7).
- The breast-cancer **mCODE profile set** + binding strengths (§6) — informs
  O-4 but the authoritative profile decision is the §12 EPD workstream's.
- A **material deviation** (risk class lands at III; narrow-v1 claim untenable;
  EPD-write conflicts a Stammgemeinschaft requirement) is a **new founder
  decision**, escalated — never re-encoded in an item.

**The rung-2 gate (O-5).** Charter §6/§8 stage write-egress as
**inactive until rung-2** (the full IIb target rung), unlocked by a governed
ADR-216 evidence promotion. This is modelled as a foundry **founder gate**
(`gate_request`), not a queue dependency, so a pool worker can never auto-claim
egress when O-4 lands. **O-5 is therefore NOT queued in this push.** It is
pushed only after the founder approves the rung-2 gate (with rung-1 prospective
validation evidence in place and O-4 merged).

## Quality battery config (T2)

Derived from the **T2** tier row + the charter quality commitments. Universal
obligations on every item; the conditional ones land per the applicability
table. `verifier-wave-full` = the four-agent wave (`local-ci` + `reviewer` +
`charter-checker` + `qa-engineer`, isolation: worktree). `exercir-charter-checker`
does **not** apply (not `domains/exercir`); the **oncology charter** is enforced
by `charter-checker` + reviewer citing the charter sections.

| Obligation token | Meaning | Source |
|---|---|---|
| `verifier-wave-full` | full four-agent verifier wave on every PR | T2 battery |
| `synthetic-cohorts-no-real-phi` | no real PHI in any build artifact; fabricated / synthetic cohorts only (until the §11 gate, a regulated-ops event) | charter §9/§11; T2 |
| `mutation-t2-where-battery-exists` | Stryker `break:75` on the changed lib where a test battery exists | T2 battery |
| `designer-first-adr-new-port` | new port / regulated-architecture decision ⇒ designer-first ADR before code | T2 battery |
| `assert-non-superuser-db-suites` | DB suites run under the `app` role (NOSUPERUSER + NOBYPASSRLS) so FORCE RLS genuinely bites | charter §4; T2 |
| `rls-secure-by-default` | tenant rows isolated by `tenant_pack_id` RLS, no default-readable path | charter §4 / ADR-209 |
| `phi-encrypted-at-rest-and-in-transit` | PHI columns encrypted at rest + TLS in transit | charter §4 |
| `blind-index-queryable-phi` | equality-queried PHI columns get a blind-index companion (field-name, not physical column) | B1 follow-up |
| `relation-graph-wiring-reverify` | pass the real `prismaClient` to `forRoot` so `_runtimeDataModel` populates the relation graph; nested-PHI must fail-loud, never silent plaintext | B1 follow-up (S6 passed none → empty graph) |
| `consent-audit-tamper-evident` | consent receipts + append-only audit hash-chain bind the data | charter §4 |
| `survival-fit-cites-section-11-gate` | any survival fit cites + passes the §11 validation gate (GoF + PH-violation detection) | charter §9/§11; T2 |
| `run-manifest-reproducibility` | every fit is an ADR-220 run-manifest, replayable bit-identically (the PCCP audit trail) | charter §9/§10 / ADR-220 |
| `clinician-in-the-loop-shadow-mode` | survival output is advisory / shadow-mode at rung-0, unclaimed; never an autonomous order | charter §5/§8 |
| `epd-r4-only` | EPD surface is R4 (CH Core v7 / IHE MHD v4.2.2); never conflate with the kernel R5/mCODE export | charter §6 |
| `epd-sandboxed-no-real-community` | EPD calls sandboxed — reference/sandbox community only, no real Stammgemeinschaft, no real PHI | charter §4/§6 |
| `egress-write-consent-flows` | write-back gated by write-back consent flows; rung-2 only | charter §6/§8 |

**Applicability:**

| Item | Obligations (in addition to the universal `verifier-wave-full` + `synthetic-cohorts-no-real-phi` + `mutation-t2-where-battery-exists`) |
|---|---|
| **O-1** | `designer-first-adr-new-port` · `phi-encrypted-at-rest-and-in-transit` · `blind-index-queryable-phi` · `relation-graph-wiring-reverify` · `rls-secure-by-default` · `assert-non-superuser-db-suites` · `consent-audit-tamper-evident` |
| **O-2** | `designer-first-adr-new-port` (light) |
| **O-3** | `survival-fit-cites-section-11-gate` · `run-manifest-reproducibility` · `clinician-in-the-loop-shadow-mode` · `rls-secure-by-default` · `assert-non-superuser-db-suites` |
| **O-4** | `designer-first-adr-new-port` · `epd-r4-only` · `epd-sandboxed-no-real-community` · `assert-non-superuser-db-suites` |
| **O-5** | `designer-first-adr-new-port` · `epd-r4-only` · `epd-sandboxed-no-real-community` · `egress-write-consent-flows` |
| **O-6.1** | `designer-first-adr-new-port` (provider ADR) |
| **O-6.2** | `assert-non-superuser-db-suites` |
| **O-6.3** | `assert-non-superuser-db-suites` · `rls-secure-by-default` |

## Lanes & parallelism

The real parallelism contract is `dependsOn` + disjoint scopes; `lane` is
labelling.

- **`data-spine`** (repo `de-braighter/health`, lib `libs/health-api`,
  **serial chain**): **O-1 → O-2 → O-3 → O-6.3**. Flat `src/` + a shared
  `prisma/schema.prisma` + a shared composition root make the lib a single
  ordered chain; ordered items may share scope, so this is sound. O-1 is the
  arc **foundation**.
- **`epd`** (repo `de-braighter/health`, lib `libs/health-fhir`, serial chain):
  **O-1 → O-4 → O-5**. O-4 `dependsOn` O-1 (needs the schema write-target + the
  bumped lockfile); O-5 `dependsOn` O-4. O-5 additionally **rung-2-gated** (not
  queued until the founder approves).
- **`hardening-substrate`** (repo `de-braighter/substrate`, parallel): **O-6.1
  ∥ O-6.2** — disjoint by directory.

**Initial claimable frontier:** **O-1** (health-api foundation), **O-6.1**
(substrate KMS), **O-6.2** (substrate WORM) — three parallel claims across two
repos. After O-1 releases: **O-2** (data-spine) ∥ **O-4** (epd) ∥ the substrate
items become claimable.

**Foundation / root-surface ownership (the one designed escape-hatch).** O-1's
declared `pathPrefix` is `libs/health-api/`, but the atomic substrate-2.x bump
also edits the **root `pnpm-lock.yaml`** and **`libs/health-fhir/package.json`**
(outside that prefix). This is sound because **every other `de-braighter/health`
item transitively `dependsOn` O-1** — so no unordered item is ever co-active
with O-1; O-1-vs-each disjointness is by **ordering**, not path (the F4
algorithm permits ordered items to share scope). Downstream items add **no new
root dependencies** except **O-4** (R4 FHIR libs), which is the only
health-repo-lockfile editor in its unordered set (O-2/O-3/O-6.3 consume existing
deps; O-6.1/O-6.2 are a different repo's lockfile) — so the root lockfile is
never touched by two unordered items.

## Work items

| itemId | title | scope.repo | scope.pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|---|
| `oncology/O-1` | Oncology PHI data layer `patient→tumor→observation` + substrate-2.x foundation (relation-graph re-wire, blind-index, 6-arg router) | `de-braighter/health` | `libs/health-api/` | — | data-spine | wave-full · no-real-phi · mutation-t2 · designer-first · phi-encrypted · blind-index · relation-graph-reverify · rls-secure · assert-non-superuser · consent-audit |
| `oncology/O-2` | Breast-survivorship pathway plan-tree + survival-effect declarations (clinical content reused, not its architecture) | `de-braighter/health` | `libs/health-api/` | `oncology/O-1` | data-spine | wave-full · no-real-phi · mutation-t2 · designer-first(light) |
| `oncology/O-3` | Survival-twin wiring: synthetic cohort → health `event_log` → §11-gated survival posterior → ADR-220 replay (shadow-mode) | `de-braighter/health` | `libs/health-api/` | `oncology/O-1`, `oncology/O-2` | data-spine | wave-full · no-real-phi · mutation-t2 · §11-gate · run-manifest-repro · clinician-shadow · rls-secure · assert-non-superuser |
| `oncology/O-4` | B2 — EPD-FHIR **R4** ingest (CH Core v7 / IHE MHD v4.2.2, sandboxed) → map mCODE into the O-1 schema | `de-braighter/health` | `libs/health-fhir/` | `oncology/O-1` | epd | wave-full · no-real-phi · mutation-t2 · designer-first · epd-r4-only · epd-sandboxed · assert-non-superuser |
| `oncology/O-6.1` | Real cloud-KMS adapter behind the existing `KmsKekClient` port (provider ADR; replaces the dev-only in-memory KEK) | `de-braighter/substrate` | `libs/substrate-runtime/src/adapters/field-encryption/` | — | hardening-substrate | wave-full · no-real-phi · mutation-t2 · designer-first(provider) |
| `oncology/O-6.2` | substrate#137 — adopt the BEFORE-UPDATE/DELETE WORM trigger on `kernel.audit_event*` (the chain-append `SELECT FOR UPDATE` vs append-only-grant 42501 fix) | `de-braighter/substrate` | `libs/substrate-runtime/src/audit/` | — | hardening-substrate | wave-full · no-real-phi · mutation-t2 · assert-non-superuser |
| `oncology/O-6.3` | health `requireScope` unit test (the GUC-unset audit-write guard) + a non-`app` `closeAnchor` role for the anchor-retention job | `de-braighter/health` | `libs/health-api/` | `oncology/O-3` | hardening-substrate | wave-full · no-real-phi · mutation-t2 · assert-non-superuser · rls-secure |

> **O-5 (B4 egress) is intentionally absent from this table's push set.** It is
> held behind the rung-2 founder gate (above) and pushed — as
> `oncology/O-5`, `de-braighter/health`, `libs/health-fhir/`, `dependsOn:
> oncology/O-4`, lane `epd` — only after the founder approves the gate.

## Disjointness proof

Ordering chains (transitive `dependsOn`): `O-1 < O-2 < O-3 < O-6.3` ·
`O-1 < O-4` · `O-6.1`, `O-6.2` independent. Every **unordered** pair (neither
transitively depends on the other) below is proven disjoint by the foundry
`scopesDisjoint` rules (different `repo` → disjoint; same repo + both
`pathPrefix` → disjoint iff neither normalized prefix is a prefix of the other).

| Unordered pair | Evidence | Verdict |
|---|---|---|
| O-2 vs O-4 | same repo, `libs/health-api/` vs `libs/health-fhir/` — non-nested | disjoint ✓ |
| O-2 vs O-6.1 | different repo (health vs substrate) | disjoint ✓ |
| O-2 vs O-6.2 | different repo | disjoint ✓ |
| O-3 vs O-4 | `libs/health-api/` vs `libs/health-fhir/` — non-nested | disjoint ✓ |
| O-3 vs O-6.1 | different repo | disjoint ✓ |
| O-3 vs O-6.2 | different repo | disjoint ✓ |
| O-4 vs O-6.1 | different repo | disjoint ✓ |
| O-4 vs O-6.2 | different repo | disjoint ✓ |
| O-4 vs O-6.3 | `libs/health-fhir/` vs `libs/health-api/` — non-nested | disjoint ✓ |
| O-6.1 vs O-6.2 | same repo (substrate), `…/adapters/field-encryption/` vs `…/audit/` — sibling dirs, neither a prefix of the other | disjoint ✓ |
| O-6.1 vs O-6.3 | different repo | disjoint ✓ |
| O-6.2 vs O-6.3 | different repo | disjoint ✓ |
| O-6.1 vs O-1 | different repo | disjoint ✓ |
| O-6.2 vs O-1 | different repo | disjoint ✓ |

All other pairs are **ordered** (one transitively `dependsOn` the other) and may
share scope: `O-1`↔{O-2,O-3,O-4,O-6.3}, `O-2`↔{O-3,O-6.3}, `O-3`↔O-6.3.

**Cross-prefix touches (recorded, all sound):**

1. **O-1 → root `pnpm-lock.yaml` + `libs/health-fhir/package.json`** (the atomic
   substrate-2.x bump, outside O-1's `libs/health-api/` prefix). Sound: every
   health item transitively `dependsOn` O-1, so none is ever co-active with it.
2. **O-4 → root `pnpm-lock.yaml`** (R4 FHIR deps). Sound: the only other
   health-repo-lockfile editor is O-1 (ordered before O-4); O-2/O-3/O-6.3 add no
   root deps.
3. **O-6.2 → `libs/substrate-runtime/prisma/migrations/`** (the WORM-trigger
   migration, outside its `src/audit/` prefix). Sound: O-6.1 — the only
   unordered substrate partner — touches neither `src/audit/` nor `prisma/`.

**Dangling-dependsOn check:** every `dependsOn` id (`oncology/O-1`,
`oncology/O-2`, `oncology/O-3`, `oncology/O-4`) is present in the pushed item
list. O-5's eventual `dependsOn: oncology/O-4` resolves once O-5 is pushed
post-gate. No dangling ids.

## Known traps carried onto the items

- **Published-vs-main** — adjudicate substrate API claims against the consumer's
  `node_modules` `.d.ts`, never `layers/substrate` source (main carries
  unpublished surface). The 6-arg router is the live shape on `^2.1.0`.
- **Windows MAX_PATH** in claim worktrees → `.npmrc
  virtual-store-dir-max-length=60` (pnpm). health dev DB `health-postgres`
  **:5546**; substrate dev DB **:5544**.
- **DB tier** runs via the `--config …/vitest.db.config.ts` path (loads `.env`),
  NOT the env-prefix path (which scrubs the DB URL). The `app` role is
  NOSUPERUSER + NOBYPASSRLS — a superuser would BYPASSRLS and false-pass.
- **post-findings** — severity enum `blocking|should-fix|nit|note`; FULL
  `owner/repo#pr`; out-of-diff paths cause gh 422.
- **Standard block** — worktree isolation everywhere; fresh install per
  worktree; never git ops in the shared clone; freeze-merge `--admin`; twin
  ritual after every merge (`drain <repo#pr>` / `backfill OWNER/REPO` /
  `reconcile <repo#pr>`).
