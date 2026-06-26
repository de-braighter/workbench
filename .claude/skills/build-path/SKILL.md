---
name: build-path
description: "Foundry pipeline stage 4 — turn an approved Product Charter into a machine-executable build path: /new-domain scaffold plan, epic ladder (herdbook E1…En style), ADR needs, UI-surface plan derived from the dossier's prototype artifacts, and the tier-derived quality-battery config — decomposed into claimable work items with DISJOINT scopes and pushed via foundry_queue_push. Use when the founder says 'build-path <product-key>' or after a product's charter merges."
tags: [foundry, build-path, pipeline]
---

# Build Path (Foundry stage 4)

Turns `docs/foundry/<key>/charter.md` into the full build path (spec §3 stage 4 of
`docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`).
**The load-bearing output is scope disjointness**: parallel worker sessions are
safe at claim time exactly because disjointness was *designed* here — F1's
`scopesDisjoint` only enforces what this stage designs.

## The disjointness algorithm (design against EXACTLY this)

The claim plane (foundry `scopesDisjoint` — source of truth:
`domains/foundry/src/state.ts`; fail-closed) treats two item scopes as
disjoint iff:

1. different `repo` → disjoint;
2. same repo, BOTH scopes carry `pathPrefix` → disjoint iff neither normalized
   prefix (compare with trailing `/`) is a prefix of the other. **Path
   comparison is authoritative: a differing `issue` canNOT rescue overlapping
   paths.**
3. same repo, at least one scope without `pathPrefix` → disjoint iff both carry
   `issue` and the issues differ;
4. anything else → OVERLAP. An item with neither `issue` nor `pathPrefix`
   claims the **whole repo**.

Claimability: an item is claimable when it is still queued (not done, not
actively claimed), its `dependsOn` items are all released `done`, AND its scope
is disjoint from every ACTIVE claim. Design consequences:

- Items **ordered** by the dependency DAG (one transitively depends on the
  other) may share scope — they can never hold claims simultaneously.
- Items **unordered** relative to each other MUST be pairwise disjoint by
  rules 1–3.
- **Shared files break path disjointness** — mutations of shared surfaces
  (route tables, module barrels, app config, root package.json) belong in a
  *sequencing item* that the parallel items `dependsOn`; a parallel item's
  pathPrefix must contain every file it will touch. Root-level files
  (`package.json`, the lockfile, root `tools/` scripts) are the common
  greenfield trap — they sit outside every non-scaffold pathPrefix, so
  dependency additions belong to the scaffold or a sequencing item.
- `lane` is informational labeling only (no claim semantics); the real
  parallelism contract is `dependsOn` + disjoint scopes.

## Rules

- **The charter is the authority.** Tier, wedge, what-NOT-to-build, quality
  plan. The build path never widens the wedge; an item that needs something the
  charter excludes is a design smell to surface, not to queue.
- **qualityObligations are copied VERBATIM from the charter's quality plan**
  onto every item they apply to (universal obligations on all items;
  UI-specific ones like `a11y-battery` on UI-scoped items). Never add
  obligations the charter doesn't carry (a T0 charter has no mutation
  threshold).
- **Item grain = one worker session = one PR** (the F2 foundry-worker protocol
  works items whole: claim → worktree → execute → wave → land → release). An
  epic too large for one session decomposes into `E<n>.1, E<n>.2 …` items.
- **Item titles are self-contained.** A worker session sees ONLY the itemId,
  title, scope, and obligations (plus what it reads from the repo + the
  build-path doc). Write titles a cold session can act on.
- **Store generators, derive graphs:** the foundry store is the single
  operational truth for queue/claim state. The build-path doc records the
  *design* — never mirror queue status into it.

## Procedure

1. **Read the inputs.** `docs/foundry/<key>/charter.md` (must exist with
   `status: chartered`), `opportunity-brief.md`, `dossier-record.md` + the
   UI-prototype artifacts it manifests. Missing charter → stop and name the
   missing pipeline stage (`/dossier-intake` → `/opportunity-brief` → charter).
2. **Scaffold plan.** From the charter's Repo plan: target repo, `/new-domain`
   tiers, suggested port pair (grep `repos.yaml` + `domains/*/docker-compose.yml`
   for taken ports, suggest the next free pair). For a greenfield repo the
   scaffold is **E1**: scope = whole repo (no pathPrefix, no issue — claims the
   repo), and every other item transitively `dependsOn` it.
3. **Epic ladder** (herdbook E1…En convention): each epic is a user-facing
   capability with a one-line deliverable + an acceptance statement, decomposed
   into items at the one-session grain. Honor the wedge: the ladder ends when
   the charter's end-to-end loop demonstrably runs — not when the dossier's
   full vision ships.
4. **UI-surface plan.** From the dossier's UI-prototype artifacts: list each
   prototype surface, judge it against the charter's wedge loop (`in` /
   `deferred` + one-line justification), and map in-scope surfaces onto
   design-system-brick pages. Each in-scope surface becomes an item under a UI
   epic, pathPrefix'd to its own page directory; the UI shell (routing, app
   config, shared layout) is a sequencing item the surface items `dependsOn`.
   UI text is i18n'd (working-language convention): each surface's strings
   live in a page-scoped i18n file INSIDE its pathPrefix; the shell item owns
   the i18n loader wiring and any shared/common keys.
5. **ADR needs.** For each ADR the path requires:
   1. Read the target repo's current `next-free-adr` from its ADR registry
      (`layers/specs/adr/README.md` for cross-cutting/kernel ADRs; a domain
      repo's equivalent for domain-local ADRs) — this is the **floor** and is
      REQUIRED: `foundry_reserve_adr` rejects a missing floor.
   2. Call `foundry_reserve_adr { itemId: '<key>/ADR-<n>', repo: '<adr-repo>',
      floor: <floor> }` to obtain the allocated number. The tool serializes
      under the shared store-lock — two parallel build-path runs cannot grab the
      same number.
   3. Emit a dedicated **ADR-authoring work item** with `itemId: '<key>/ADR-<n>'`
      scoped to the ADR file path in that repo (`{ repo: '<adr-repo>',
      pathPrefix: 'adr/adr-<n>-' }`). This item is disjoint from all
      product-code items by *different repo* (rule 1 of the disjointness
      algorithm), or, when co-located in the same repo — e.g. a kernel ADR +
      substrate code both in `layers/specs` — a non-nested `adr/` prefix;
      see step 8.
   4. Add `'<key>/ADR-<n>'` to the code item's `dependsOn` array for every
      code item that cites that ADR — the MINIMAL set (only items that actually
      need the ADR spec before they can be built). Over-broad `dependsOn`
      serializes the fan-out unnecessarily.

   T0: expected none (pack-native; an apparent kernel need is a charter design
   smell to escalate, not to build). T1: the ADR set and authoring items go to
   Gate 2. T2: additionally mark affected items `designer-first` and note the
   per-ADR founder gates (spec §3).
6. **Quality battery config.** Derive from the tier row + charter quality
   plan: which deterministic gates run for this product (lint audit set, knip,
   coverage-delta, mutation tier, non-superuser DB tests, a11y battery) and
   which obligations land on which items (an applicability table).
7. **Decompose into work items.** For each item: `itemId` (`<key>/E<n>` or
   `<key>/E<n>.<m>`), `title`, `epic` (optional), `scope` (`repo` + `pathPrefix` and/or
   `issue` — greenfield products rely on pathPrefix), `dependsOn` (itemIds),
   `lane`, `qualityObligations`, and optionally `yields`. `scope.issue` is filled
   when the target repo + story issues exist; worker sessions create story issues
   per the story-tracker workflow once the repo exists.

   **`yields` — substance the item produces into the log (ADR-251 / ADR-242).**
   Each work item MAY declare `yields: SubstanceRef[]` where
   `SubstanceRef = { kind: 'pack' | 'board' | 'policy' | 'indicator', id: string }`.
   `yields` names the substance (pack, board, policy, or indicator) that a DONE
   item delivers — this is what gives a generated product its substance face in
   the canonical log and enables downstream consumers to discover what was built.
   Emit `yields` on items whose primary output IS a discrete substance unit (e.g.
   the scaffold item that produces the pack, a UI epic that produces a board); omit
   it on sequencing, ADR-authoring, and purely infrastructural items.

   **`generationKind` — mark an item generation-eligible (ADR-277).** An item MAY
   declare `generationKind: '<kind>'` when its primary artifact is a kind the
   Generation SDK renders — check the LIVE registry with `gen_list_kinds` (today
   `angular-feature`, `service-method`, and `pack-scaffold`). A tagged item routes the worker to the
   GENERATION PATH: it **authors a model** the SDK deterministically renders instead
   of hand-authoring the artifact (the worker's `references/generation-path.md`).
   Tag ONLY when ALL hold: (a) the artifact is a renderable kind, (b) that kind's
   `neverAiFree` is `false` (per `gen_list_kinds`), and (c) the product is **non-T2**
   — never tag a T2/oncology item until the regulated NEVER-AI-free set is decided
   (OQ-2 [FOUNDER]). `generationKind` is inert routing metadata — it NEVER affects
   scope/claim/disjointness (the worker re-validates the tag against the live
   `gen_list_kinds` at execution). Omit it on sequencing, ADR-authoring, and items
   whose artifact no kind renders.
8. **Disjointness proof.** Enumerate every UNORDERED pair (neither transitively
   depends on the other) in a table: pair → evidence (`different repo` /
   `non-nested paths: <a> vs <b>` / `distinct issues`) → verdict. Any pair
   without provable evidence: re-scope (tighter pathPrefixes), move shared
   files into a sequencing item, or add ordering. Never rely on
   issue-distinctness when both items carry overlapping paths (rule 2). Also
   verify every `dependsOn` id appears in the item list (or is already queued
   for this product) — queue_push accepts dangling ids silently, and a dangling
   dependency bricks its item forever (its deps can never be satisfied).

   ADR-authoring items (`<key>/ADR-<n>`) in the specs repo are `different repo`
   from product-repo code items → trivially disjoint by rule 1 (no pair-table
   entry needed). The dangling-`dependsOn` check must confirm that every
   `<key>/ADR-<n>` referenced in a code item's `dependsOn` appears in the item
   list (either newly emitted in step 5 or already queued) — a dangling ADR
   dependency is caught here, not silently at push time.
9. **Write the doc** `docs/foundry/<key>/build-path.md`:

   ```markdown
   ---
   product_key: <key>
   build_path_date: <YYYY-MM-DD>
   status: build-path
   charter: docs/foundry/<key>/charter.md
   risk_tier: <from charter>
   item_count: <n>
   ---

   # Build Path — <Product Name>

   ## Scaffold plan
   ## Epic ladder
   ## UI-surface plan
   ## ADR needs & gates
   ## Quality battery config
   ## Lanes & parallelism
   ## Work items
   <table: itemId · title · scope · dependsOn · lane · qualityObligations · yields · generationKind>
   ## Disjointness proof
   <the unordered-pair table>
   ```

10. **Gate 2 — T1+ only.** T1/T2: register the product if needed
    (`foundry_queue_push { product, items: [] }` is idempotent — F3 lesson),
    then `foundry_gate_request { productKey: <key>, gateType: "architecture",
    payloadRef: "docs/foundry/<key>/build-path.md" }` and STOP — items are
    pushed only after `foundry_gate_decide` approves. T0: no Gate 2 — proceed.
11. **Push.** Check `foundry_status` first: itemIds must be NEW (queue_push
    rejects existing ones — never re-push). Then `foundry_queue_push {
    product: { productKey, name, repo, riskTier, charterRef, stage:
    "execution" }, items: [<the full item list>] }`. Items with a substance
    output carry `yields` in the payload, e.g.:
    `{ itemId: 'acme/E1', title: 'Scaffold pack', ..., yields: [{ kind: 'pack', id: 'acme-core' }] }`.
    For an already-registered
    product the product block is ignored (registration is write-once via the
    MCP surface) — the charter FILE stays the tier authority either way.
12. **Verify + hand off.** `foundry_status` shows the items queued with only
    dependency-free ones claimable; `foundry_next` surfaces them;
    `foundry_session_prompt` renders ready-to-paste launch prompts. Report the
    board + the first prompt(s) to the founder (hybrid spawn: the founder
    launches worker sessions).

## Failure stances

- **Foundry MCP unavailable** → author the doc anyway (it's a file); flag the
  push as pending; never simulate a push. (If `foundry_*` tools are absent the
  session needs a restart — they're wired in `.mcp.json`.)
- **queue_push rejects an itemId as already queued** → diff against
  `foundry_status`; push only the new items. Corrections to already-queued
  items: push the corrected item as a NEW itemId (`<id>-v2`), then RETIRE the
  stale item — claim it and release with outcome `done` and note
  `superseded by <id>-v2; do not implement` (the only terminal outcome:
  `abandoned` re-queues, and the stale item's older `queuedAt` would surface it
  BEFORE the v2 and suppress the v2 in session prompts). A stale item that is
  not yet claimable (pending deps) cannot be retired today — flag it to the
  orchestrator and retire it the moment it becomes claimable; an F1 retire op
  is the known gap.
- **Mid-build disjointness violation** (spec §7: two in-flight items turn out
  to touch the same file) → the older claim proceeds, the newer session hands
  back via `foundry_handoff`; THIS stage owns the fix: correct the lane map /
  scopes in `build-path.md`, push the corrected items as new itemIds, and
  retire the handed-back item (claim → release `done` with a superseded-by
  note) — the retire-claim is only possible once the older overlapping claim
  has released; until then the handoff note is the guard.
- **Gate 2 rejected** → revise per the founder's note; new gate request;
  nothing is pushed until approved.
- **The charter excludes something the ladder seems to need** → do not queue
  it; surface the conflict to the founder (a charter change is a founder
  decision, not a build-path edit).
