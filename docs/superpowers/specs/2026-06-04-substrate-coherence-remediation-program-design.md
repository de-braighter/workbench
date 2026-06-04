# Substrate Coherence Remediation Program — Design

- **Status:** proposed (awaiting user review)
- **Date:** 2026-06-04
- **Author:** orchestrator session (founder-directed)
- **Source:** the four-dimension architecture evaluation run 2026-06-04 (kernel-surface audit, domain-coverage matrix, charter-strain trail, governance/delivery assessment)
- **Successor artifact:** implementation plan at `docs/superpowers/plans/2026-06-04-substrate-coherence-remediation-plan.md` (written after this spec is approved)

---

## 1. Why this exists

The 2026-06-04 evaluation reached a clear verdict: **the kernel *design* is sound, but the *system* around it has drifted.** The four-concern collapse is real and the pack/`metadata` boundary genuinely holds (herdbook is the textbook proof). But:

- the spec corpus lags shipped code by ~5 runtime minors and several shipped ADRs still read `proposed`, so **the governance record cannot be trusted as source-of-truth**;
- the quality gate is **honour-system** — only 1 of 8 repos has a real git hook, and the ADR-181 frontmatter validator exists but is unwired;
- two concrete correctness hazards are live (two drifting inference ports; string-vs-UUID `tenant_pack_id`);
- the architecture's differentiator — inference + reproducibility — is **thinly proven**: counterfactual divergence in one domain, reproducibility (concern #4) in zero;
- the subject ontology is **person-shaped**, forcing non-person twins to lie (`kind:'person'`);
- one of the five "proof" domains (**conservation**) is a fork that *contradicts* the thesis rather than validating it;
- a ratified decision (FHIR eviction, ADR-204) **has not been executed** — the kernel still ships the evicted code.

This program brings those in order under the founder-chosen priority **Truth → Enforce → Correct**, then executes four owned arcs. Nothing is parked.

## 2. Goals / Non-goals

**Goals**

1. Make the spec record a trustworthy source-of-truth (statuses ↔ shipped code, missing ADRs, version reconciliation).
2. Convert the honour-system gate into machine enforcement across all 8 repos.
3. Close the two concrete correctness hazards (inference-port tenancy drift; tenant_pack_id type/axis inconsistency).
4. Discharge the derived-state debt question with a crisp, documented pack-side rule.
5. Execute the four owned big arcs: FHIR eviction, subject-ontology generalization, conservation de-fork, reproducibility proof.
6. Land all breaking kernel changes as **one coordinated `substrate@1.0`** so consumers migrate once.

**Non-goals**

- Re-litigating the kernel's four concerns or the inclusion test (ADR-176 stands).
- New user-facing domain features.
- External marketing of the substrate.
- Resolving the `mechanism`-registry / `LineageRepository` minimality questions *now* — they are logged for standing review, not actioned this program (they pass or are explicitly-overridden today).

## 3. Findings → workstream traceability

| Evaluation finding | Severity | Workstream |
|---|---|---|
| Governance record can't be trusted (proposed-but-shipped ADRs; missing 205/206/207/209; version lag) | High | **WS-1** |
| ADR-209/`core.tenant` reality unverified; mechanism + lineage are speculative/domain-shaped surfaces | Verify | **WS-1b** |
| Gate is honour-system; only devloop has a real hook; ADR-181 validator unwired | High | **WS-2** |
| Two inference port stacks drift on tenant isolation (legacy has no `tenantPackId`) | High (security) | **WS-3** → 1.0 |
| Tenancy is a bolt-on: string-vs-UUID `tenant_pack_id`, dual tenant axes, RLS off-by-default | High | **WS-4** |
| ~9 persisted "ADR-176 exception" derived-state tables accumulating on pack side | Medium | **WS-5** |
| FHIR eviction (ADR-204) ratified but not executed | Medium | **WS-6** → 1.0 |
| Subject ontology person-shaped; non-person twins lie (`kind:'person'`) | Medium-High | **WS-8** → 1.0 |
| conservation is a fork that contradicts the thesis | High (architectural) | **WS-7** |
| Reproducibility (concern #4) proven by no domain | High (value) | **WS-9** |

## 4. Program structure

Four phases, ordered by the founder priority. Each workstream lists **scope · owner agent(s) · tracking artifact · depends-on · done-when**.

### Phase 0 — TRUTH

**WS-1 — Specs ↔ shipped reconciliation**
- *Scope:* flip shipped-but-`proposed` ADRs (197, 202, 203, 196, 198) to `accepted`; locate-or-author the missing ADR files (205, 206, 207, 209); reconcile `layers/specs/adr/README.md` `next-free-adr`/`latest` against published `substrate-runtime` (0.19 local / 0.22 registry) and `substrate-contracts` 0.14; run `spec-auditor` to confirm closure.
- *Owner:* `spec-auditor` (audit) + `substrate-architect` (ADR content) + `designer` (status calls).
- *Tracking:* PR(s) on `layers/specs`.
- *Depends-on:* none.
- *Done-when:* `spec-auditor` reports zero proposed-but-shipped, zero dangling refs, README counters match reality; published-version table added to the ADR index.

**WS-1b — Verify the two mismatches**
- *Scope:* (a) determine whether `core.tenant`/ADR-209 actually exists and where, or whether `tenant_pack_id` is still a derived UUIDv5 hash with no enrollment table — record the truth; (b) add a standing-review note logging `kernel.mechanism` (admitted ADR-190 override) and `LineageRepository`/`core.individual`+`core.lineage_edge` (domain-shaped, passes ≥2-pack) as the two surfaces a future minimality review must revisit.
- *Owner:* `charter-checker` (minimality note) + `substrate-architect` (tenant truth).
- *Tracking:* note appended to WS-1 specs PR (or a short ADR if `core.tenant` truth requires one).
- *Depends-on:* none.
- *Done-when:* tenant-model truth is documented; the two surfaces are logged with their justification + review trigger.

### Phase 1 — ENFORCE

**WS-2 — Real gates in all 8 repos**
- *Scope:* propagate devloop's `core.hooksPath=.githooks` + pre-push hook (typecheck + test, with the documented audit comment) to `layers/specs`, `domains/exercir`, `domains/herdbook`, `layers/substrate`, `layers/design-system`, `domains/markets`, `domains/conservation`; wire the existing-but-unwired `layers/specs/tools/validators/frontmatter-schema.mjs` + `tools/lint-md.sh` into the specs pre-push hook.
- *Owner:* `windows-devops-pro` (hook mechanics) + per-repo `implementer`.
- *Tracking:* one PR per repo (small, mechanical) — or a single sweep PR where repos share infra.
- *Depends-on:* none (parallelizable across repos).
- *Done-when:* every repo's `git config core.hooksPath` resolves to a real pre-push that runs the repo's gate; specs hook fails on an ADR-181 frontmatter violation; the "never bypass pre-push hooks" rule now protects hooks that exist.

### Phase 2 — CORRECT

**WS-3 — Retire the legacy `INFERENCE_BACKBONE_PORT`** *(breaking → batched into 1.0)*
- *Scope:* ADR to deprecate-then-remove the root `out-ports/inference.port.ts` (`INFERENCE_BACKBONE_PORT`, no `tenantPackId`); sweep all consumers to the scoped `/inference` `INFERENCE_BACKBONE`; remove the duplicate symbol. Closes the cross-tenant read hazard.
- *Owner:* `substrate-architect` (ADR, this session) + `substrate-coder-pro` (removal, in 1.0).
- *Tracking:* ADR on `layers/specs` (this session) + epic issue on `de-braighter/substrate`.
- *Depends-on:* consumer sweep result; rides the 1.0 release.
- *Done-when:* only the tenant-scoped port remains published; no consumer imports the legacy token.

**WS-4 — Tenancy consistency**
- *Scope:* design note resolving (a) `tenant_pack_id` type unification (text vs `@db.Uuid` — pick one across kernel `core.prisma`, the distributed `pedigree-schema.sql`, and pack schemas), (b) the dual tenant-axis (`tenantId` org vs `tenantPackId` pack in the same table), (c) RLS-on-by-default vs flag-gated for demos. Couples with WS-7.
- *Owner:* `prisma-pro` + `substrate-architect`.
- *Tracking:* short design note → ADR; epic issue.
- *Depends-on:* WS-1b tenant truth.
- *Done-when:* a single documented tenant-id type + axis convention exists; migration path noted; conservation de-fork (WS-7) can adopt it.

**WS-5 — Persisted-derived-state audit**
- *Scope:* enumerate the ~9 `// ADR-176 exception` tables (exercir player-self family + `player_trait_value`; herdbook `planned_mating`); classify each as **snapshot/decision-record** (keep) vs **cache-in-disguise** (convert when a live generator exists); write the crisp pack-side rule ("kernel-scoped prohibition; pack snapshots permitted iff point-in-time decision record or stand-in for an un-wired generator, with a named retirement trigger").
- *Owner:* `exercir-charter-checker` + `charter-checker` (audit) + `implementer` (any conversions, tracked).
- *Tracking:* audit note in this program's plan; conversion issues where flagged.
- *Depends-on:* none.
- *Done-when:* every exception table has a documented classification + retirement trigger; the rule is written where future packs will see it.

### Phase 3 — BIG ARCS (owned, designer-first, scheduled)

**WS-6 — FHIR eviction (execute ADR-204)** *(breaking → batched into 1.0)*
- *Scope:* physically move `substrate-{contracts,runtime}/src/fhir/**` into a separate health-pack per ADR-204 (Direction B); remove FHIR exports from the substrate barrels; migrate the sole consumer (pack-football) onto the health-pack.
- *Owner:* `substrate-coder-pro` + `fhir-pro` + `implementer` (consumer).
- *Tracking:* epic issue on `de-braighter/substrate` + health-pack repo/dir decision.
- *Depends-on:* the 1.0 release train.
- *Done-when:* zero FHIR symbols exported from `substrate-runtime`/`-contracts`; pack-football green on the health-pack.

**WS-8 — Subject-ontology generalization** *(breaking → batched into 1.0)*
- *Scope:* design + implement a `SubjectRef.kind` that admits non-person subjects (asset, animal, repo, …) without the conjugate fast-paths rejecting them; remove the `kind:'person'` guards/lies in markets + exercir.
- *Owner:* `substrate-architect` (ADR) + `substrate-coder-pro` (contract + runtime) + consumer `implementer`s.
- *Tracking:* ADR on `layers/specs` + epic on `de-braighter/substrate`.
- *Depends-on:* rides 1.0; should land before WS-9 if the reproducibility subject is non-person.
- *Done-when:* a non-person subject runs a posterior without a `kind` workaround; markets drops the BTC-as-person hack.

**WS-7 — conservation de-fork**
- *Scope:* resolve the deferred ADR-027 consume-vs-fork question for conservation; flip it off its vendored `@de-braighter/conservation-{contracts,runtime}` onto the published `substrate@1.0`; migrate `tenant_org_id → tenant_pack_id` (WS-4 convention); remove `population`/`breeding_event`/`kinship_cache` from its kernel schema into pack territory.
- *Owner:* `substrate-architect` (ADR-027 resolution) + `prisma-pro` (migration) + `implementer`.
- *Tracking:* ADR + epic on `de-braighter/conservation`.
- *Depends-on:* `substrate@1.0` published; WS-4 tenant convention.
- *Done-when:* conservation consumes the published kernel through ports only; no domain tables in its kernel schema; thesis no longer self-contradicted.

**WS-9 — Reproducibility proof**
- *Scope:* pick one domain (candidate: markets — cleanest event→posterior loop — or a fresh minimal domain) and exercise concern #4 for real: a versioned catalog, a persisted run manifest, and a replay that reproduces a historical inference bit-for-bit.
- *Owner:* `designer`/`substrate-architect` (arc design) + `implementer` + `test-pro` (replay assertion).
- *Tracking:* concept doc + epic.
- *Depends-on:* WS-8 (if non-person subject); a stable `substrate@1.0`.
- *Done-when:* one domain replays a versioned catalog + manifest to reproduce a past posterior; concern #4 has a live proof.

## 5. Decision — coordinated `substrate@1.0`

WS-3 (port retirement), WS-6 (FHIR removal), and WS-8 (subject-ontology) are all **breaking changes to the same two published packages**. The evaluation observed real version drift and an already-occurred parallel-session version collision (the pedigree 0.14→0.15 bump). Dribbling three breaking minors would force exercir/herdbook/markets to migrate three times and re-expose the collision risk.

**Decision: batch WS-3 + WS-6 + WS-8 into one coordinated `substrate-contracts@1.0` / `substrate-runtime@1.0`.** Each consumer migrates once, against a single documented breaking surface, yielding a clean post-collapse / post-eviction 1.0 line. The 1.0 cut is gated on all three landing on a release branch with a single migration guide; conservation de-fork (WS-7) and reproducibility (WS-9) then target 1.0 as consumers.

## 6. Sequencing & dependency graph

```mermaid
graph TD
    WS1[WS-1 Specs reconciliation] --> WS1b[WS-1b Verify mismatches]
    WS1b --> WS4[WS-4 Tenancy consistency]
    WS2[WS-2 Enforce gates all repos]

    WS3[WS-3 Retire legacy inference port]:::breaking --> REL[substrate@1.0]
    WS6[WS-6 FHIR eviction]:::breaking --> REL
    WS8[WS-8 Subject-ontology]:::breaking --> REL

    WS4 --> WS7[WS-7 conservation de-fork]
    REL --> WS7
    REL --> WS9[WS-9 Reproducibility proof]
    WS8 -.if non-person subject.-> WS9

    WS5[WS-5 Derived-state audit]

    classDef breaking fill:#fde,stroke:#c39;
    classDef rel fill:#def,stroke:#39c;
    class REL rel;
```

Phase order (Truth → Enforce → Correct → Arcs) governs *start* order; WS-2 and WS-5 are independent and can run in parallel with Phase 0. The 1.0 release is the pivot: everything downstream of it (WS-7, WS-9) waits for it.

## 7. This session's scope (do-now)

Hands-on, **no breaking code**:

1. **WS-1 + WS-1b** — specs reconciliation + verify the two mismatches (specs PR).
2. **WS-2** — propagate real git hooks + wire the ADR-181 validator (per-repo PRs).
3. **WS-5 audit** — classify the derived-state exception tables + write the rule (note in the plan).
4. **Open the arcs** — author the ADRs for WS-3 and WS-8, and create coarse GitHub epic issues for WS-3/4/6/7/8/9 per the story-tracker convention.

Everything breaking (the 1.0 train) and the two large domain arcs (WS-7, WS-9) execute in dedicated later sessions against the implementation plan.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Parallel-session version collision on the 1.0 bump | Single release branch; confirm `npm view` immediately before publish (exact-equality check, never substring-grep); ADR number guard before merge. |
| Hook propagation breaks local dev (slow/blocking pre-push) | Mirror devloop's proven hook exactly; keep it to typecheck+test the repo already runs; document `--no-verify` is still forbidden. |
| Do-now specs reconciliation mis-states a status | `spec-auditor` verifier wave gates the specs PR; status flips cite the shipping PR/commit. |
| conservation de-fork is large and couples with tenancy | Sequence it strictly after `substrate@1.0` + WS-4; treat as its own arc with its own plan. |
| FHIR eviction is a breaking major with a live consumer | Batched into 1.0 with a migration guide; pack-football migration is part of WS-6 done-criteria. |

## 9. Tracking

- **This doc** is the program index.
- **The implementation plan** (`docs/superpowers/plans/2026-06-04-substrate-coherence-remediation-plan.md`) decomposes the do-now set into ordered, independently-reviewable tasks for subagent-driven execution.

### Tracking ledger (live as of 2026-06-04 execution)

**ADRs** (`de-braighter/specs`): ADR-212 (WS-3 legacy-port retirement) + ADR-213 (WS-8 subject-ontology) authored → PR #260. ADR-204 already covers WS-6. WS-4 tenancy convention + WS-7 consume-vs-fork resolution ADRs are deferred to their arcs.

**GitHub epics:**

| Arc | Issue | Repo | State |
|---|---|---|---|
| substrate@1.0 coordinating (WS-3+6+8) | #92 | substrate | open |
| WS-3 retire legacy inference port | #93 | substrate | open · ADR-212 |
| WS-6 execute FHIR eviction | #94 | substrate | open · ADR-204 |
| WS-8 subject-ontology | #95 | substrate | open · ADR-213 |
| WS-4 tenancy consistency (re-scoped) | #96 | substrate | open · relates #57 |
| WS-9 reproducibility proof | #97 | substrate | open |
| WS-7 conservation de-fork (ex-pedigree) | #18 | conservation | open |
| WS-5 derived-state rule ratification | #261 | specs | open |

**Do-now PRs:** WS-1/1b specs reconciliation → specs #259 (corpus now green; closes specs #245 + #238). WS-2 enforcement: markets pre-push gate → markets #5 (proven end-to-end); remaining 5 code repos + specs B3 pending. WS-5 audit → `docs/superpowers/notes/2026-06-04-derived-state-exception-audit.md`.

**Re-scope corrections (origin/main truth pass):** the prior evaluation ran on stale local checkouts — ADRs 205–211 + the persisted tenant model (ADR-209) already shipped; WS-4 shrank (org-vs-pack axis resolved by ADR-209); WS-7 shrank (pedigree already de-vendored); WS-6 confirmed not-in-progress.
