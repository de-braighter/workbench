# Shared Scope-Disjointness — Anti-Drift Design

- Date: 2026-06-21
- Status: proposed (design / investigation only — no code change in this note)
- Scope: `de-braighter/foundry` (authority) + `de-braighter/studio` (preview client)
- Related: ADR-176 (kernel minimality), ADR-027 (pack-on-platform / published-package consumption), ADR-247 (one-encoding of "claimable")

## 1. Problem statement

The "scope disjointness" rule — given two work-item scopes `{ repo, pathPrefix?, issue? }`,
may they be claimed in parallel? — is the foundry **claim-plane source of truth**. It is
implemented **twice**, in two separate git repos:

- **AUTHORITY (server, fail-closed):** `scopesDisjoint(a, b)` in
  `domains/foundry/src/state.ts` (lines 470–479). Routed through `scopeConflict` (state.ts
  line 510) by all three claim-plane call sites (claimable read, `claim()`, heartbeat
  revival) so read and write agree by construction (ADR-247 one-encoding).
- **CLIENT (preview):** `overlap(a, b)` inside `computeScopeDisjointness(draft)` in
  `domains/studio/apps/studio-ui/src/app/build-path/core/compute-scope-disjointness.ts`.
  Drives the Build Path Designer's disjointness panel (E4.1) and the E5 push-gate
  (`hasConflicts`) so a draft that the server would reject at claim time is blocked
  **before** it is pushed to the foundry queue.

**The risk is silent drift.** The client is a hand-copied port. A real divergence was
already caught in review: the client checked `issue` **before** path, producing a
false-DISJOINT preview for a case (same path, differing issue) that the server rejects.
A green push-preview followed by a server-side claim rejection is the exact failure mode
the preview exists to prevent. There is currently **no mechanism** that fails CI when the
client drifts from the server again.

## 2. Current-agreement findings

I read both implementations and both test suites in full:

- Authority: `domains/foundry/src/state.ts` lines 464–479; tests
  `domains/foundry/test/state.test.ts` lines 86–112 (`describe('scopesDisjoint (fail closed)')`).
- Client: `compute-scope-disjointness.ts` lines 39–56 (`overlap`); tests
  `compute-scope-disjointness.spec.ts` lines 18–108 + `core.integration.spec.ts`.

### Case-by-case (post-fix) — they AGREE

| Case class | Authority `scopesDisjoint` | Client `overlap` (null ⇒ disjoint) | Agree? |
|---|---|---|---|
| Different `repo` | `true` (disjoint) | returns `null` (disjoint) | ✅ |
| Same repo, both `pathPrefix`, non-nested (incl. `canvas` vs `canvas-extra`) | disjoint | disjoint | ✅ |
| Same repo, both `pathPrefix`, equal/nested (incl. `src/a` vs `src/a/deep`, trailing-slash-normalized) | overlap | `nested-path` | ✅ |
| Same repo, both `pathPrefix`, **differing `issue` but overlapping path** (wave-B1) | overlap (path authoritative) | `nested-path` (path authoritative) | ✅ |
| Same repo, both `issue` present, differing | disjoint | disjoint | ✅ |
| Same repo, both `issue` present, equal | overlap | `whole-repo` | ✅ |
| Same repo, one without `pathPrefix` AND without (both) `issue` (whole-repo claim) | overlap | `whole-repo` | ✅ |
| One has `issue`, other has none | overlap (issue rule needs BOTH) | `whole-repo` | ✅ |

**Trailing-slash normalization matches verbatim:** server `pa = endsWith('/') ? p : p + '/'`
(state.ts 473–474) and client `withSlash` (compute 35–37). Both prevent `canvas/` nesting
under `canvas-extra/` and force a file path like `app.routes.ts` to `app.routes.ts/`.

### The one residual textual difference (semantically inert)

- Authority: `if (a.issue != null && b.issue != null && a.issue !== b.issue)` — loose `!= null`
  guards **both `null` and `undefined`**.
- Client: `if (a.issue !== undefined && b.issue !== undefined && a.issue !== b.issue)` —
  strict, guards **`undefined` only**.

This is **not a live divergence**: in both type systems `issue` is `number | undefined`
(server `ItemScopeSchema` zod `.optional()` → `events.ts` 49–54; client `BuildScope.issue?: number`
→ `build-node.ts` 30–34; the client's `readScope` only ever sets `issue` to a positive integer
or leaves it absent — compute/`build-node.ts` 95–98). `issue` can never be `null` at runtime,
so the two predicates evaluate identically on every reachable input. It is, however, exactly
the kind of cosmetic gap that masks a future regression and is worth eliminating when we touch
this code.

**Verdict: the implementations CURRENTLY AGREE on every case class.** The earlier
issue-before-path bug has been fixed; the client is now a faithful, cited port. The open
problem is purely *durability* — nothing prevents the next edit from re-introducing drift.

## 3. Packaging reality (cheap vs heavy)

### Foundry (the authority)

- `@de-braighter/foundry`, `private: true`, `version: 0.0.0`. **No `main` / `module` /
  `exports` / `files` / `publishConfig`.** It is a server + MCP app, not a published library.
  **Foundry publishes no consumable lib today.**
- `scopesDisjoint` lives in `state.ts`, a large module that also holds `fold`, the claim/lease
  machinery, coordinator presence, `scopeConflict`, workflow-stage logic, etc. `state.ts`
  imports `./events.js` (the zod `ItemScope`), `./metamodel/vocabulary.js`,
  `./instances/workflow-keys.js`, `./log.js`. So `scopesDisjoint` itself is a clean leaf
  (it only needs the `ItemScope` *type* — `{ repo, issue?, pathPrefix? }` — and `zod`), but
  it is **not currently isolated** in its own file.
- Stack: ESM, `tsc` build to `dist/`, vitest, `moduleResolution: bundler`.

### Studio (the client)

- pnpm workspace; `studio-ui` is Angular 21 + vitest. It already consumes **published**
  `@de-braighter/*` packages: `design-system-core@^2.6.0`, `design-system-angular@^1.10.0`,
  `substrate-contracts@^2.1.0`. **No relative cross-repo imports** — it honors the cluster
  published-package rule already.

### Cost of a shared published package

To make studio consume a shared rule it must come from a **published `@de-braighter/*`
package** (cluster rule: no relative cross-repo paths). That requires, on the foundry side:

1. A new publishable lib (own `package.json` with `name`/`version`/`exports`/`files`, a build
   target, an `npm publish` step) — foundry has **zero** publishing infrastructure today.
2. Extracting `scopesDisjoint` + the `ItemScope` shape into that lib (or a sub-path export),
   then having `state.ts` import it back.
3. A version-bump + publish + consume cadence on **every** rule change, across two repos
   (the very friction ADR-027 accepts for stable contracts, but heavy for a 10-line function
   that changes rarely).
4. studio adding the dep + a version bump on each rule change.

That is real standing infrastructure for a function that is a handful of lines. It buys a
*compile-time* guarantee, but at the cost of a publish loop the foundry repo does not have.

## 4. Options

### Option A — TRUE extraction (shared published package)

Pull `scopesDisjoint` + the `ItemScope` type into a small published lib (e.g.
`@de-braighter/foundry-scope` or a `@de-braighter/foundry-contracts` sub-path). foundry
`state.ts` imports it; studio adds it as a dependency and its `overlap` calls it.

- **Pros:** single binary source of truth; client *cannot* diverge — it executes the same
  bytes; compile-time guarantee.
- **Cons:** foundry has no publishing setup → must stand one up; cross-repo version/publish/
  consume loop on every change; introduces a published-contract surface for a rule that is a
  pack/foundry concern, not a kernel one; the client still needs a thin adapter (it returns a
  *reason* string + walks a draft, the server returns a boolean), so a sliver of client-only
  code remains regardless. Heaviest option for the smallest shared unit.

### Option B — PRAGMATIC anti-drift (cited port + golden/contract test)

Keep the two implementations but make drift **mechanically impossible to merge**:

1. **Single-source the cases, not the code.** Define the disjointness **truth table** as
   data — a frozen array of `[a, b, expectedDisjoint, label]` rows that *is* the foundry test
   (it already exists, lines 86–112; promote it to an exported `SCOPE_DISJOINTNESS_CASES`
   fixture in foundry, or — to avoid any cross-repo coupling — keep one canonical copy and a
   byte-identical mirror guarded by a string-equality test, see step 3).
2. **A studio golden test** drives `computeScopeDisjointness` (via single-pair drafts) over
   *exactly* the foundry cases and asserts the server-equivalent verdict for each. Any client
   behavior that drifts from a server case fails studio CI.
3. **A drift tripwire.** Since the two repos can't share a file cheaply, embed the canonical
   case table as a small JSON/TS literal duplicated in both repos plus a test in *each* repo
   that hashes/compares its local copy against the agreed canonical text; if someone edits the
   server rule and updates only the server cases, the studio copy's checksum test fails until
   the table is re-synced. (Lighter alternative: a single comment-anchored block + a
   CI lint that the client's `overlap` carries the `// MIRRORS foundry scopesDisjoint @ <ref>`
   cite and the case table is present.)
4. **Tighten the inert difference** — change the client's `issue` guard to match the server's
   `!= null` form (or vice-versa) so the ports are textually identical line-for-line, removing
   the one cosmetic gap.

- **Pros:** single-repo per change (no publish loop); the golden test makes the *behavior*
  the contract; honors ADR-176 (rule stays in foundry/pack territory, never the kernel) and
  the published-package rule (nothing new to publish); cheap to land now.
- **Cons:** not a *compile-time* guarantee — it's a CI guarantee (a deleted or skipped test
  defeats it); the case table is duplicated (mitigated by the checksum tripwire); requires
  discipline to add a new case to the canonical table when the rule grows.

## 5. Recommendation

**Adopt Option B (pragmatic anti-drift).** Rationale in one line: the rule is a small,
rarely-changing foundry/pack concern (ADR-176 keeps it out of the kernel and the
published-package rule makes true extraction expensive because foundry publishes nothing
today), so a cited port + a golden contract test that mirrors foundry's exact cases buys the
anti-drift guarantee we actually need at a fraction of the cost — and it can land in a single
studio PR plus a tiny foundry PR, with **zero kernel change** and no new publishing infra.

Keep Option A on the shelf as the upgrade path: **if** foundry later grows a published
contracts lib for other reasons (it already consumes `@de-braighter/substrate-contracts`, so
the precedent exists), promoting the rule into it becomes nearly free and we should take it
then. Until that day, the publish loop is unjustified for a ~10-line function.

## 6. Decomposed implementation plan (Option B)

Two work items, **path-disjoint** so they can run in parallel; the studio item depends on
the foundry item only for the *canonical case table* text (a soft dependency — studio can
inline the agreed table if foundry lands second, so they are sequencable either way).

**Step 1 — foundry: publish the canonical case table + cite (foundry repo).**
- Extract the existing `scopesDisjoint` truth-table (test/state.test.ts 86–112) into an
  exported, frozen `SCOPE_DISJOINTNESS_CASES` fixture (e.g. `src/scope-disjointness-cases.ts`
  or `test/fixtures/scope-disjointness-cases.ts`), each row
  `{ a: ItemScope, b: ItemScope, disjoint: boolean, label: string }`.
- Re-point the existing `scopesDisjoint` test to iterate the fixture (no behavior change —
  same assertions, now data-driven), proving the fixture *is* the server's contract.
- Add the cite comment on `scopesDisjoint` ↔ the client (`// CONTRACT: mirrored by studio
  compute-scope-disjointness.ts; cases = SCOPE_DISJOINTNESS_CASES`).
- Optionally isolate `scopesDisjoint` into its own `src/scope-rule.ts` leaf (import the
  `ItemScope` type) so a future Option A extraction is a move, not a rewrite. Pure refactor.

**Step 2 — studio: golden/contract test + tighten the port (studio repo).**
- Add `compute-scope-disjointness.contract.spec.ts`: a byte-identical mirror of the canonical
  case table (kept in sync with foundry's), driving `computeScopeDisjointness` over each row
  via a single-pair draft and asserting `!hasConflicts === row.disjoint`.
- Add a checksum/string-equality tripwire test asserting the studio-local mirror equals the
  agreed canonical text (so editing the server rule without re-syncing studio fails studio CI).
- Change the client `issue` guard from `!== undefined` to `!= null` so the port is textually
  identical to the server (kills the inert cosmetic gap from §2).
- Strengthen the cite comment in `compute-scope-disjointness.ts` to name the foundry symbol +
  the case table.

**Quality battery (T0 baseline):** `wave-standard` (reviewer + qa-engineer + charter-checker)
+ `zero-kernel-change` on both items. Charter-checker confirms the rule stays in foundry/pack
territory (ADR-176) and nothing lands in `@de-braighter/substrate-contracts`.

## 7. Ready-to-queue Foundry work items

See the parent task's structured summary for the machine-ready spec (itemIds, disjoint
scopes, titles, dependsOn, qualityObligations).
