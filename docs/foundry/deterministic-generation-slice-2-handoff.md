# Handoff prompt — Slice 2: the service-method generator (the catalog crux)

> Paste the block below into a **fresh Claude Code session launched from the cluster root**
> (`D:/development/projects/de-braighter/`). Slice 1 is merged (foundry#50 + #51); this
> session builds slice 2. Created 2026-06-25.

---

You are building **Slice 2** of the deterministic AI artifact-generation system (ADR-274): the **service-method generator**. Slice 1 (the Angular-feature generator) is **merged and proven** (foundry#50, fix #51) — the loop closes end-to-end (schema-validate → policy → deterministic render → fenced logic slot → two event-sourced run events coupled to a Foundry claim → replay). Slice 2's job is to settle the **highest-variance design decision in the whole system: the closed, versioned operation catalog (D2 — the crux)**. You build ON the proven slice-1 SDK; you do not reinvent the loop.

## STEP 0 — Read the authoritative design + the slice-1 code you extend (do not re-derive)

- **ADR-274** — `layers/specs/adr/adr-274-deterministic-ai-artifact-generation-metamodel-first.md` (D2 the crux; Alternatives #3 = the slice-2 rationale; OQ-2 [FOUNDER] + OQ-3).
- **Concept** — `layers/specs/concepts/design/2026-06-25-deterministic-ai-artifact-generation.md`. For slice 2, read closely: **§4.2** (the modelable/logic-slot boundary + the illustrative `opCatalog@v1`), **§4.4(a)** (the `ServiceMethodModel` schema — `OpNode` union), **§7** (the end-to-end `PlayerTraitService.cohortThreshold` example — the acceptance shape), **§4.8** (the `unknown-op` failure class), **§5.2** (the two catalog risks: degenerate-into-a-DSL vs ossify).
- **The slice-1 SDK you extend** (all merged on `domains/foundry` main): read `src/generation/{kinds,validate,generate,preview,failure,slots}.ts`, `src/generation/renderers/angular-feature.ts`, `src/generation/op-catalog/index.ts` (the **stub** you replace), `src/generation/schemas/angular-feature.ts` (the schema+JSON-Schema-parity pattern to mirror), and the slice-1 plan `docs/superpowers/plans/2026-06-25-foundry-generation-sdk-slice-1.md`.

Read these before writing any code.

## The thesis + the crux (one paragraph)

AI authors a schema-validated metamodel; deterministic generators render the artifact; AI/humans hand-write only fenced, typed logic slots. **Slice 2's crux (D2):** a service-method *body* is a sequence of `OpNode`s drawn from a **CLOSED, versioned operation catalog (`opCatalog@v1`)** — never arbitrary control flow. Every node resolves to exactly one of three dispositions: (1) **a catalog op** → typed, deterministically rendered; (2) **bounded domain logic** → a **logic slot** (the slice-1 `<generation:logic-slot>` fence — typed, unit-tested, stub-checked); (3) **a recurring novel op** → a **`gen_propose_op` proposal**, human-curated into `opCatalog@v(n+1)` only on demonstrated multi-use need. This is what keeps the metamodel from becoming "a worse programming language in JSON." Hold that line in every review.

## Hard constraints (gate-level; charter-checker enforces)

- **ADR-176 — kernel grows by ZERO.** The op-catalog, the service-method schema, the policies, the renderer, the MCP — all Foundry/Workbench meta-product tooling. Nothing in `layers/substrate`; nothing added to `@de-braighter/substrate-contracts`. The `combineEffects` op **reuses** the published `EffectDeclarationSchema`/`composeEffects` (ADR-154) from `@de-braighter/substrate-contracts/plan-tree` — it consumes, it does not author.
- **D2 — the catalog is closed + versioned.** `opCatalog@v1` is a static `ReadonlyMap` of typed op signatures, derived at module load (the slice-1 "store generators, derive graphs" pattern). A model referencing an op absent from the pinned `catalogVersion` is an `unknown-op` failure (§4.8), routed to `gen_propose_op` or a logic slot — never silently accepted.
- **D3 — determinism unchanged.** The service-method render is a pure function of `(model, templateSetVersion, contextPackHash)` — golden + replay tested, byte-identical, LF (see the `.gitattributes test/golden/** text eol=lf` lock from slice-1 fix #51 — keep it).
- **D5 — MCP↔SDK boundary unchanged.** `gen_*` tools stay thin adapters; `gen_describe_op_catalog` (a stub today) becomes **real** for `service-method`. All engine logic stays in the SDK.
- **D6 — events reused as-is.** `gen_generate` emits the same `foundry:GenerationRun.v1` + `ArtifactGenerated.v1` (kind-generic) into the existing log, coupled to a `claimRef`. No new event types.

## STEP 1 (do FIRST, before building) — the designer-first ADR for `opCatalog@v1`

The catalog crux is an **architectural decision that gets its own ADR and a founder gate** (ADR-274 OQ-3). Use the `designer` (or `substrate-architect` if you judge it borderline) agent to draft a new ADR in `layers/specs/adr/` recording:

1. **`opCatalog@v1` membership** — the closed, typed op set + each op's signature. Curate a *realistic minimal* v1, not the full illustrative list. Strong candidates (from §4.2): `requireScope`, `load`, `filter`, `groupBy`, `map`, `persist`, `emitEvent`, `mapError`, `combineEffects` (reuses ADR-154), plus the `logic-slot` escape hatch. **Recommend deferring `inferPosterior`** to a later catalog version (it needs InferenceBackbone wiring — demand-driven, not speculative). The ADR justifies each inclusion/exclusion.
2. **The catalog-versioning/promotion policy (OQ-3)** — the ADR-176 §3 analog for the catalog: when does `opCatalog` bump MAJOR (remove/retype an op = breaking) vs MINOR (add an op) vs PATCH; and the **demand-driven promotion rule** (an op enters the catalog only on demonstrated ≥2-use need via `gen_propose_op` — never speculative).
3. **The PHI-scope policy** the service-method kind enforces (D4/R5): e.g. "a method that `load`s PHI declares a `requireScope`"; "`emitEvent`'s type is in the pack's declared event catalog"; "every logic slot carries a named unit test."
4. **The ADR-176 verdict** — both inclusion-test legs fail for every component (same as ADR-274 §9) → pack/tooling territory, kernel grows by zero.

**Open ADR PR → founder Gate (architecture/ADR).** Do NOT build the catalog until the ADR is approved + merged — the membership is the founder's call.

## STEP 2 (after the ADR merges) — build the service-method generator, extending the slice-1 SDK

Reuse the loop; add the kind. Concretely (TDD, golden, per the slice-1 task style):

1. **`service-method` metamodel schema** (`src/generation/schemas/service-method.ts`) — the `OpNode` discriminated union + `ServiceMethodModel` (§4.4a): `{ kind, catalogVersion, class, method, params, returns, body: OpNode[] }`. Zod **and** a mirrored JSON Schema with a **parity-guard test** (the slice-1 pattern — don't skip it; it caught a real bug in slice 1).
2. **`opCatalog@v1`** (`src/generation/op-catalog/index.ts`) — replace the stub with the ADR-curated closed `ReadonlyMap` of typed op signatures; `describeOpCatalog('service-method')` returns it.
3. **The PHI-scope policy** (`src/generation/policies/service-method.ts`) per the ADR.
4. **The service-method renderer** (`src/generation/templates/service-method/v1.ts` + register it) — render the `OpNode[]` body into a deterministic TS service method: each catalog op → its deterministic code fragment; each `logic-slot` → the slice-1 fenced typed stub; `mapError`/`requireScope` emitted by construction (this is the payoff — the unmapped-error→500 + missing-scope failure modes vanish). From-scratch template (no Nx schematic to wrap).
5. **Generalize the SDK dispatch** — turn the angular-feature-hardcoded paths into kind-keyed registries (the slice-1 `// TODO(slice-2)` markers): `validateModel` (a kind→validator map, not `if (kind !== 'angular-feature')`), and a top-level renderer registry keyed by `(kind, templateSetVersion)` that `generate.ts`/`preview.ts` dispatch through. **Regression-guard: the `angular-feature` kind's behavior + goldens must stay byte-identical.**
6. **Register the kind** — `GENERATION_KINDS` (`src/generation/kinds.ts`) gains `service-method` (mode `bounded`, schemaRef `service-method@v1`, `neverAiFree` per OQ-2 interim — see below).
7. **The `unknown-op` path goes live** — a body op outside `opCatalog@v1` yields an `unknown-op` finding (§4.8); `gen_propose_op` (the slice-1 stub) becomes the curation channel.
8. **gen_* MCP** — `gen_describe_op_catalog`, `gen_validate_model`, `gen_preview`, `gen_generate`, `gen_verify_artifact` all work for `service-method`; stub nothing new.
9. **End-to-end acceptance** — reproduce the §7 `cohortThreshold` flow as the acid test: a `bounded` service-method (load → groupBy → **logic-slot** → persist → emitEvent, with `requireScope`) → validate (all ops in catalog + slot typed) → policy (scope present, event type in catalog) → deterministic render (catalog ops + fenced slot) → two events into a temp log coupled to `claimRef` → verify (slot-filled gate bites, then passes) → golden + replay byte-identical.

**Slice-2 success:** a service-method metamodel authored against `opCatalog@v1` → validate (schema + the closed-catalog check + PHI policy) → deterministic render with `mapError`/`requireScope` by construction + one fenced logic slot → `GenerationRun.v1` in the log → golden/replay-stable. The crux is settled: the modelable surface is a curated closed catalog; everything else is a bounded slot or a curation proposal.

## Deferred founder decisions — respect, do not guess

- **OQ-2 [FOUNDER] — NEVER-AI-free for regulated T2/oncology — UNRESOLVED.** Target a **non-T2** demo (the §7 exercir pack-football `PlayerTraitService` example is ideal). Interim per ADR-274: anything carrying a prior / causal claim / effect declaration / clinical-regulatory decision is NEVER-AI-free → flows through a logic slot or a human. A plain CRUD/rollup service-method is fine; but **do NOT point the generator at any T2/oncology build path** until a `type/decision` issue resolves OQ-2. (Note: the `combineEffects` op *renders* an effect declaration — flag service-methods that emit one as `neverAiFree` per-model, or keep the effect inside a logic slot, per the interim rule.)
- **`inferPosterior` deferral** — recommend leaving it out of `opCatalog@v1` (demand-driven; it needs InferenceBackbone wiring). If you include it, that's a design call the ADR must justify — surface it.

## Process (cluster conventions — non-negotiable)

- **Designer-first** (this slice leads with an ADR + founder gate — the catalog is risky/cross-cutting). Then **PR-gated** everywhere (specs + code). Branch → PR → verifier wave → merge.
- **TDD**; golden/snapshot tests for the renderer + the parity-guard test for the dual schema. Keep `test/golden/** text eol=lf`.
- **Verifier wave** on the build PR: `reviewer` + `qa-engineer` + `charter-checker` (charter-checker is the **highest-stakes** gate here — it guards the ADR-176 boundary *and* the closed-catalog discipline: a catalog op must not smuggle kernel concerns, and the catalog must stay a static pack-owned lookup). Run as parallel read-only reviewers against the worktree (NOT `isolation:worktree` from the cluster root — that worktrees the wrong repo; tell them to work read-only in the foundry worktree path).
- **Isolation:** work in a git worktree off `origin/main` of `de-braighter/foundry` under `.claude/worktrees/` (never the dirty main clone; another session may be writing the live foundry log).
- **Twin ritual after every merge:** from `domains/devloop`, `npm run dev -- drain <repo#pr>` → `backfill de-braighter/foundry` → `reconcile`. PR body carries `Producer:` / `Effort:` / `Effect:` lines (Effort: `deep` — this is a wave + designer-first-ADR slice).
- Foundry flow is available + idiomatic; `/build-path` the build into scope-disjoint items if you prefer, or build directly TDD — your call by size. Never bypass pre-push hooks.

## First actions

1. Read ADR-274 §D2/Alt-3/OQ-3 + concept §4.2/§4.4a/§7/§4.8/§5.2 + the slice-1 SDK in full.
2. Verify cluster reality: slice-1 code is merged on `domains/foundry` main (`src/generation/op-catalog/index.ts` is a stub with `// TODO(slice-2)`); the `GenerationKind` type already names `service-method`; `combineEffects`/`EffectDeclarationSchema` are available from the published substrate-contracts.
3. **Draft the `opCatalog@v1` ADR (designer-first) → open the ADR PR → request the founder architecture/ADR gate.** Stop and wait for approval before building the catalog.
4. After the ADR merges: build slice 2 (STEP 2) → PR → verifier wave → merge → twin ritual.
5. Report: the curated `opCatalog@v1`, the closed-catalog enforcement (an `unknown-op` rejection + a `gen_propose_op` proposal), the PHI-scope policy in action, the one logic slot, golden/replay proof, the `GenerationRun.v1` event, and confirm the `angular-feature` kind is regression-clean.

## Scope guard

Build ONLY the service-method generator + `opCatalog@v1` + its policies/renderer/schema in `domains/foundry/src/generation/`, reusing the slice-1 loop. Do NOT regress the `angular-feature` kind. Do NOT touch `domains/studio/libs/board-editor` (a separate autonomous chain may be live there). Do NOT point the generator at any T2/oncology target until OQ-2 resolves.
