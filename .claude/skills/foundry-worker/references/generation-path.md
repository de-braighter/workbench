# Foundry worker — the generation path (ADR-277)

When a claimed item carries a `generationKind` tag, you **AUTHOR A MODEL** that the
deterministic Generation SDK renders, instead of hand-authoring the artifact. This
is ADR-274's dogfooding step — AI moves from artifact-author to **model-author** on
the cluster's own engineering. Use the `gen_*` MCP tools ONLY (D5 — never reach into
`domains/foundry/src/generation/**`); they read/write the LIVE foundry log, coupling
the run to your claim.

## When this route applies

The session prompt (and `foundry_next`) carries `generationKind` (e.g.
`angular-feature`, `service-method`). The build-path stage only tags an item
generation-eligible when its artifact is a kind the SDK renders **and** that kind is
NOT NEVER-AI-free **and** the product is non-T2 (OQ-2). If the tag names a kind
`gen_list_kinds` does NOT advertise, treat the item as a normal hand-authored item
(fall back to the Phase-3 default route) or `foundry_release { blocked }` with the
reason — never silently hand-author a run that claims to be generated.

## The loop (after Phase 1 CLAIM + Phase 2 ISOLATE)

1. **Validate the kind.** `gen_list_kinds` → confirm `generationKind` is present;
   note its `mode` (`deterministic` | `bounded`) and `neverAiFree`. Unknown kind →
   fall back / block (above).
2. **Learn the contract.** `gen_describe_schema(kind)` (the metamodel JSON Schema) +
   `gen_describe_op_catalog(kind)` (the closed op set, for logic-bearing kinds).
3. **Author the MODEL** — a JSON object conforming to the schema. Target paths
   INSIDE your claim's scope `pathPrefix` (the model's route/feature paths must land
   in scope). This is where your creative work goes — the model, not the code.
4. **Validate** — `gen_validate_model(kind, model)`. Loop on schema/policy findings
   until `ok`. A `policy-violation` (e.g. missing a11y battery / `requireScope`) is a
   MODEL fix, not a code fix. `gen_explain_failure` decodes a finding (its class,
   remedy, and whether it is retriable).
5. **Preview** — `gen_preview(kind, model)` → inspect the rendered files + the
   logic-slot list. No write, no event.
6. **Generate** — `gen_generate(kind, model, claimRef=<your claimId>)`. This is the
   ONE write: validate → render → write the tree to the SDK outDir → emit
   `GenerationRun.v1` + `ArtifactGenerated.v1` into the LIVE foundry log coupled to
   your claim (replayable via `modelHash` + `templateSetVersion` + `contextPackHash`).
   Pass your **`claimId`** as `claimRef` — that coupling is what makes the run
   attributable and replayable; never call `gen_generate` without a live claim.
7. **Move the artifact into your worktree.** The SDK writes under its own
   `dataDir/generated`, NOT your worktree. Copy the rendered tree into your worktree
   at the in-scope path. Then `git diff --name-only` and confirm EVERY path is inside
   your scope `pathPrefix` — the generator output is bound by the same scope boundary
   as any hand-authored diff.
8. **Fill the logic slots** (BOUNDED-mode kinds only; `deterministic` kinds have
   none). Each `<generation:logic-slot id=...>` fence ships a typed throwing stub.
   Fill the body + write its named unit test (the policy requires one). This is the
   irreducible domain logic — the 20% that is genuinely yours to write.
9. **Verify** — `gen_verify_artifact(report)` → slot-filled check + golden/lint. A
   `slot-unfilled` finding means a stub remains; a `golden-drift` means a template
   regression. Fix until `ok`.

## Then rejoin the standard protocol

From here the item is a normal PR: **Phase 4 QUALITY** (open the PR, run `ci:local` +
the tier verifier wave, post findings before any fix), **Phase 5 LAND** (merge per
tier + the twin ritual), **Phase 6 RELEASE**. The twin ritual ingests the
`GenerationRun` from the log with no extra step — the run is already coupled to your
claim. Declare `Producer:` + `Effort:` as usual; a generated artifact still gets the
tier-appropriate wave.

## Hard rules (fail closed)

- **MCP only.** Use the `gen_*` tools; never edit or import `domains/foundry/src/generation/**`.
- **Scope is the boundary.** Nothing the generator writes may land outside your
  claim's `pathPrefix`. Author the model so its target paths fall in scope.
- **Never T2.** Never point the generator at a T2/oncology item — OQ-2 (the regulated
  NEVER-AI-free membership) is FOUNDER-gated. The tag should never appear on a T2
  item; if you see one, `foundry_release { blocked }` and flag it.
- **A write needs a claim.** `gen_generate` is a LIVE-log write coupled to your
  `claimId` — the same fail-closed rule as every other foundry write.
