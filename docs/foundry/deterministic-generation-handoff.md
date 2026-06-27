# Handoff prompt — build the deterministic AI artifact-generation system (ADR-274)

> Paste the block below into a **fresh Claude Code session launched from the cluster root**
> (`D:/development/projects/de-braighter/`). The design is approved + merged; this session
> builds it, slice by slice, starting with slice 1. Created 2026-06-25.

---

You are picking up the **deterministic AI artifact-generation system** for the Workbench/Foundry fusion. The architecture is **approved and merged** (ADR-274 + companion concept). Your job is to **BUILD it, slice by slice, starting with slice 1** — not to redesign it.

## STEP 0 — Read the authoritative design FIRST (do not re-derive)

- **ADR-274** — `layers/specs/adr/adr-274-deterministic-ai-artifact-generation-metamodel-first.md` (the decision + the first slice).
- **Concept (full design, deliverables 1–6)** — `layers/specs/concepts/design/2026-06-25-deterministic-ai-artifact-generation.md` (MCP tool interface §4.5, SDK module model §4.6, example schemas §4.4, the modelable/logic-slot boundary §4.2, the decision matrix §6, the end-to-end flow §7, the slice plan §8).

Read both fully before writing any code. They are the source of truth; this prompt is only a pointer + the deferred-decision context.

## The thesis (one line)

AI authors a schema-validated **metamodel**; deterministic generators render the repeatable structure/boilerplate/tests/exports from versioned templates; AI/humans hand-write only the irreducible domain logic inside fenced, typed **logic slots**.

## Hard constraints (gate-level — from ADR-274; charter-checker enforces)

- **ADR-176**: this is **Foundry/Workbench meta-product tooling — NEVER the substrate kernel**. Nothing lands in `layers/substrate`. (ADR-274 §"ADR-176 inclusion test" shows both legs fail for every component — keep it that way.)
- **D2 — the crux**: the modelable surface is a **CLOSED, versioned operation catalog** (`opCatalog@vN`). Every model node resolves to exactly one of: a catalog op · a **fenced+typed+unit-tested logic slot** (`<generation:logic-slot>`, survives regeneration, verify-time stub-check) · a `gen_propose_op` catalog-extension proposal. Never build "a worse programming language in JSON."
- **D3 — determinism is a contract**: render is a **pure function of `(modelHash, templateSetVersion, contextPackHash)`** — no wall-clock, no network, no randomness; **golden/snapshot-tested**. A template change that alters output without a version bump is a `golden-drift` RED.
- **D5 — clean boundary**: the **Generation MCP** (`gen_*` tools) is a thin inbound adapter (no engine logic); the **Generation SDK** is the stable engine. Mirror the existing Foundry split (`tools.ts` → `ops.ts`).
- **D6 — event-sourced runs**: a generation run emits `foundry:GenerationRun.v1` + `foundry:ArtifactGenerated.v1` (carrying `modelHash`, `templateSetVersion`, `contextPackHash`, `mode`) into the **EXISTING** Foundry log (`domains/foundry/data/events.jsonl`), coupled to a Foundry `claimRef`. **No parallel log or orchestrator.** These two event types are additive Foundry pack-level events (ADR-027/030), not kernel.

## SLICE 1 — build this first: the Angular-feature generator (ADR-274 D7)

Slice 1's job is to prove the **loop closes end-to-end** (determinism + policy + event-coupling + replay) — **NOT** to settle the catalog crux (that's slice 2). Build:

1. Wrap the **existing, trusted `angular-feature-generator-decomposition-aware`** Nx generator as an **SDK renderer target** (reuse it — do not rewrite a generator).
2. The **`angular-feature` metamodel schema** (Zod/JSON-Schema; see concept §4.4 for the shape).
3. A **thin policy** (e.g. a11y battery present + i18n keys present) evaluated by `gen_validate_model` before render.
4. **One logic-slot kind** — the component's computed-signal expression (fenced, typed, mandatory named unit test, verify-time assertion that no slot keeps its throwing stub).
5. The **event coupling** (D6) — `gen_generate` takes a `claimRef` and emits the two events into `events.jsonl` as `DomainEventEnvelope`s (so `backfill`/`reconcile` ingest them unchanged).
6. **Golden-snapshot discipline** — same `(model, templateSetVersion, contextPackHash)` → byte-identical output, asserted.
7. The **`gen_*` MCP tools** per concept §4.5 — implement the subset slice 1 exercises (list-kinds, describe-schema, describe-op-catalog, validate, preview, generate, verify, explain-failure, propose-op); stub the rest with clear TODOs.

**Where the code lives:** the SDK as a module/lib under `domains/foundry` (keep it foundry-internal for slice 1 — OQ-4 defers any `@de-braighter/*` publication until a second consumer demands it). The `gen_*` MCP extends the Foundry MCP surface (or a sibling gen-MCP that delegates to the SDK).

**Slice-1 success criterion:** an `angular-feature` metamodel → schema-validate → policy-check → deterministic render (golden-tested, replay-stable) → a `foundry:GenerationRun.v1` event in the Foundry log, end-to-end, with one fenced logic slot proven. The loop closes.

## SLICE 2 (only after slice 1 merges) — the service-method generator

Exercises the catalog crux (D2): curate `opCatalog@v1`, the PHI-scope policy, the effect-algebra reuse (`combineEffects` per ADR-154). It gets **its own ADR** recording `opCatalog@v1` + the catalog-versioning policy (OQ-3). Do **not** start it until slice 1's loop is proven on the trusted renderer.

## Deferred founder decisions — respect, do not guess

- **OQ-2 [FOUNDER] — which artifacts are NEVER-AI-free for regulated (T2/oncology) products.** NOT resolved. Slice 1 (`angular-feature`) is not T2, so proceed — but **do NOT point the generation system at any T2 build path** until a `type/decision` issue resolves OQ-2. Interim assumption (per ADR-274): anything carrying a prior, causal claim, effect declaration, or clinical/regulatory decision is NEVER-AI-free.
- **Event-schema scoping (founder-deferred).** Working assumption: the two Foundry event types **ride slice 1** (the D6 event-coupling is part of proving the loop — the loop isn't "closed" without event-sourcing). They are additive Foundry pack-level events, not kernel. If you'd rather sequence them as a separate Foundry work item, **surface it to the founder before splitting** — don't silently fork.

## Process (cluster conventions — non-negotiable)

- **PR-gated everywhere** (no direct-to-main). Branch → PR → verifier wave → merge. Specs/ADRs too.
- **TDD**; golden/snapshot tests for every renderer + template.
- **Verifier wave** on non-trivial PRs: `reviewer` + `qa-engineer` + `charter-checker` (the charter-checker validates the ADR-176 boundary — the highest-stakes check here). Run them as parallel `isolation: "worktree"` subagents.
- **Twin ritual after every merge** (mandatory): from `domains/devloop`, `drain <repo#pr>` → `backfill <owner/repo>` → `reconcile <repo#pr>`. PR body carries `Producer:` / `Effort:` / `Effect:` lines.
- **Foundry flow is available + idiomatic** (Foundry is self-applying — its own Substrate product). You may `/build-path` slice 1 into scope-disjoint claimable work items and run the foundry worker/conductor flow, **or** build directly TDD in one session — your call based on slice size.
- **Never bypass pre-push hooks.** Local gate is `npm/pnpm run ci:local` per repo + SonarQube (`localhost:9000`); remote GHA is billing-blocked.

## First actions

1. Read ADR-274 + the concept in full.
2. **Verify the cluster reality the ADR leans on still holds** (don't trust blind): the Foundry log + `DomainEventEnvelope` shape (`domains/foundry`), the deterministic prompt compiler precedent (`domains/foundry/src/prompts.ts`), and the `angular-feature-generator-decomposition-aware` Nx generator.
3. Decompose slice 1 (a `/build-path`, or a clear TDD task list).
4. Build slice 1 → PR → verifier wave → merge → twin ritual.
5. Report: what shipped, golden-test coverage, the event-coupling proof (point to a `GenerationRun` event in `events.jsonl`), the one proven logic slot, and surface the event-schema-scoping confirmation to the founder.

## Scope guard

Build **only the generation system** (SDK + `gen_*` MCP + schemas/op-catalog/policies/templates in `domains/foundry`). Do **NOT** touch `domains/studio/libs/board-editor` — a separate autonomous chain (board-editor-studio: S2 → P1 → …) may be live there; stay scope-disjoint.
