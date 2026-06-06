# WS-8 — Subject-Ontology Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SubjectRef.kind` carry inference *structure* only (`individual | cohort | aggregate`) with an opaque required `role` domain label, convert the inference fast-paths' domain-gates (`kind==='person'`) to structural-gates, and prepare the markets + exercir consumer migrations — so a non-person subject runs a posterior with no workaround.

**Architecture:** Two-part. **Part 1 (substrate — green-gated now):** edit `@de-braighter/substrate-contracts` (schema + error envelope) and `@de-braighter/substrate-runtime` (4 adapter guards), TDD'd against substrate's own vitest suite on a `release/1.0` branch. **Part 2 (consumers — diffs ready, verified at the 1.0 cut):** exact markets + exercir patches, applied/verified when substrate#92 publishes `substrate@1.0` (because cluster domains consume the *published* package, ADR-027; they cannot build against an unpublished 1.0). WS-8 must **not** publish in isolation — it rides the coordinated `substrate@1.0` batch (WS-3 + WS-6 + WS-8, epic substrate#92).

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), Zod (discriminated unions), `Promise<Result<T,E>>` port boundaries (no throws), Nx + vitest 4, NestJS (runtime only; contracts are pure TS).

**Spec:** `docs/superpowers/specs/2026-06-06-ws8-subject-ontology-design.md` (workbench, branch `docs/ws8-subject-ontology-design`).

---

## Pre-flight — branch strategy & gate commands

All Part-1 work happens in the **substrate** repo: `D:/development/projects/de-braighter/layers/substrate`.

- **Branch model.** If `release/1.0` does not exist (WS-8 is the first of the three batched workstreams), create it as the substrate#92 integration branch off `origin/main`, then branch WS-8 off it:

  ```bash
  SUB=D:/development/projects/de-braighter/layers/substrate
  git -C "$SUB" fetch origin
  git -C "$SUB" show-ref --verify --quiet refs/heads/release/1.0 || \
    git -C "$SUB" branch release/1.0 origin/main
  # isolate the work in a worktree (cluster practice; avoids disrupting the shared checkout)
  git -C "$SUB" worktree add D:/development/projects/de-braighter-substrate-ws8 -b feat/ws8-subject-ontology release/1.0
  ```

  PR `feat/ws8-subject-ontology` → `release/1.0` (NOT `main`). Do not publish.
- **Gate (remote CI is billing-frozen — local is the gate).** From the worktree dir:
  - Targeted tests: `npx vitest run <path-glob>` — **use `vitest run`, not `nx test`** (vitest-4 executor mismatch returns exit-1-without-summary; see memory `substrate-nx-vitest4-executor-and-worktree-daemon-lock`).
  - Lint: `npx nx affected -t lint --base=release/1.0`.
  - Full local gate before PR: `npm run ci:local`.
  - If a worktree nx daemon locks the DB (`EBUSY` on `nx reset`): kill orphan `node.exe` graph daemons, then `nx reset`.
- **Never bypass pre-push hooks** (cluster rule; substrate has the WS-2 `gate:prepush` hook).

## File-structure map

**Part 1 — substrate-contracts (`libs/substrate-contracts/src/`):**

| File | Change |
|---|---|
| `primitives/subject-ref.ts` | Rewrite schema → 3 structural variants + opaque required `role`; rewrite the doc comment. |
| `primitives/subject-ref.spec.ts` | **Create** — focused variant tests (this schema has no dedicated spec today). |
| `primitives/error-envelope.ts` | Rename `subject-kind-not-supported` → `subject-structure-not-supported` (`received: SubjectKind; supported: readonly SubjectKind[]`). |
| `inference/inference-zod.spec.ts` | Fixture sweep (7 refs). |
| `out-ports/member-resolution.port.spec.ts` | Fixture sweep (2 refs). |

**Part 1 — substrate-runtime (`libs/substrate-runtime/src/`):**

| File | Change |
|---|---|
| `inference/adapters/normal-normal-fast-path.adapter.ts` | 2 guards (`:105`, `:226`): `!== 'person'` → `!== 'individual'`, envelope rename. |
| `inference/adapters/beta-binomial-fast-path.adapter.ts` | 2 guards (`:91`, `:210`): same. |
| `inference/adapters/eb-hierarchical-beta-binomial.adapter.ts` | 1 member guard (`:165`): literal `'person'`→`'individual'` + message wording. **Keeps `validation-failed`** (NOT the envelope variant). |
| `adapters/inference/in-memory.adapter.ts` | 1 guard (`:83`): same as normal-normal. |
| `events/domain-event.schemas.ts` | Stale doc comment (`:14`) lists old kinds — update to new kinds. |
| `inference/adapters/*.adapter.spec.ts` (3), `adapters/inference/in-memory.adapter.spec.ts`, `inference/inference-backbone-router.spec.ts` (13 refs), `inference/inference-backbone-router.posterior-event-log.integration.spec.ts`, `inference/testing/in-memory-inference-backbone.spec.ts` | Fixture + assertion sweeps. |

**Part 1 — docs:** `docs/migration-substrate-1.0-ws8.md` (substrate) — WS-8 section to fold into the unified 1.0 guide at the cut.

**Part 2 — consumers (diffs only, this plan):** `domains/markets/apps/markets-api/src/readout/readout.service.ts`; `domains/exercir/apps/pack-football-api/src/app/{pack-football.controller.ts, pack-football-player-match-day.controller.ts, pack-football-team-twin.controller.ts}`.

**Transformation rules used by every fixture sweep below:**

- `{ kind: 'person', id: X }` → `{ kind: 'individual', id: X, role: 'test.subject' }` (use a domain-meaningful role where the test implies one; `'test.subject'` otherwise).
- `{ kind: 'agent'|'world', id: X }` → `{ kind: 'individual', id: X, role: 'test.subject' }` (these literals are deleted).
- Assertions of `kind: 'subject-kind-not-supported'` / `supportedV1: ['person']` → `kind: 'subject-structure-not-supported'` / `supported: ['individual']`.
- A test that asserted "non-person subject is rejected" now asserts "a `cohort`/`aggregate` subject is rejected" (the structural gate) and gains a positive case: a non-person `individual` (e.g. `role:'markets.crypto-asset'`) is **accepted**.

---

## Part 1 — Substrate (green-gated)

### Task 1: Branch + worktree setup

**Files:** none (git only).

- [ ] **Step 1: Create the release branch + worktree** (commands in Pre-flight). Confirm:

```bash
git -C D:/development/projects/de-braighter-substrate-ws8 status
git -C D:/development/projects/de-braighter-substrate-ws8 log --oneline -1   # = origin/main tip
```

Expected: clean worktree on `feat/ws8-subject-ontology`.

- [ ] **Step 2: Baseline gate is green** (so later failures are ours):

Run: `cd D:/development/projects/de-braighter-substrate-ws8 && npx vitest run libs/substrate-contracts libs/substrate-runtime/src/inference`
Expected: PASS (pre-change baseline).

### Task 2: Contract — `SubjectRefSchema` (3 structural variants + opaque role)

**Files:**

- Modify: `libs/substrate-contracts/src/primitives/subject-ref.ts`
- Create: `libs/substrate-contracts/src/primitives/subject-ref.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// primitives/subject-ref.spec.ts
import { describe, it, expect } from 'vitest';
import { SubjectRefSchema, type SubjectRef } from './subject-ref.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('SubjectRefSchema (WS-8 structural kind + opaque role)', () => {
  it('accepts individual with id + role', () => {
    const v = SubjectRefSchema.parse({ kind: 'individual', id: UUID, role: 'markets.crypto-asset' });
    expect(v).toEqual({ kind: 'individual', id: UUID, role: 'markets.crypto-asset' });
  });

  it('accepts cohort with ids + role', () => {
    expect(SubjectRefSchema.parse({ kind: 'cohort', ids: [UUID], role: 'football.player' }).kind).toBe('cohort');
  });

  it('accepts aggregate with id + role', () => {
    expect(SubjectRefSchema.parse({ kind: 'aggregate', id: UUID, role: 'football.team' }).kind).toBe('aggregate');
  });

  it('requires role on every variant', () => {
    expect(SubjectRefSchema.safeParse({ kind: 'individual', id: UUID }).success).toBe(false);
  });

  it('rejects the retired person/agent/world literals', () => {
    expect(SubjectRefSchema.safeParse({ kind: 'person', id: UUID }).success).toBe(false);
    expect(SubjectRefSchema.safeParse({ kind: 'world', id: UUID }).success).toBe(false);
  });

  it('rejects individual with a non-uuid id', () => {
    expect(SubjectRefSchema.safeParse({ kind: 'individual', id: 'nope', role: 'x' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run libs/substrate-contracts/src/primitives/subject-ref.spec.ts`
Expected: FAIL (current schema still has `person`, no `role`, no `individual`).

- [ ] **Step 3: Rewrite the schema + doc comment**

```ts
// primitives/subject-ref.ts
/**
 * SubjectRef — discriminated union over inference STRUCTURE (ADR-127 invariant 9;
 * ADR-198 aggregate; ADR-213 + WS-8 opaque-role generalization).
 *
 * `kind` encodes only the structure the inference engine needs:
 *   - `individual` — one identified subject (one `id`).
 *   - `cohort`     — a pooled set of subjects (`ids`).
 *   - `aggregate`  — a hierarchical twin over members partial-pooled toward a
 *                    shared hyperparameter (ADR-198).
 *
 * The DOMAIN meaning of a subject (a person, a crypto-asset, an animal, a team)
 * is carried in `role`: a REQUIRED, pack-namespaced, OPAQUE label the kernel
 * NEVER branches on (`'football.player'`, `'markets.crypto-asset'`,
 * `'herdbook.animal'`, `'football.team'`, …). The inference fast-paths select a
 * conjugate family off `conjugateHint` + the distribution family — never off the
 * subject. They constrain only STRUCTURE (e.g. a single-subject adapter rejects a
 * cohort) via the `subject-structure-not-supported` error envelope.
 *
 * WS-8 (ADR-213) retired the value-gated `person | agent | world` literals; a
 * non-person subject is now a first-class `individual` with its own `role`.
 */

import { z } from 'zod';

export const SubjectRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('individual'), id:  z.string().uuid(),                 role: z.string() }),
  z.object({ kind: z.literal('cohort'),     ids: z.array(z.string().uuid()).min(1), role: z.string() }),
  z.object({ kind: z.literal('aggregate'),  id:  z.string().uuid(),                 role: z.string() }),
]);

export type SubjectRef  = z.infer<typeof SubjectRefSchema>;
export type SubjectKind = SubjectRef['kind']; // 'individual' | 'cohort' | 'aggregate'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run libs/substrate-contracts/src/primitives/subject-ref.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-contracts/src/primitives/subject-ref.ts libs/substrate-contracts/src/primitives/subject-ref.spec.ts
git commit -m "feat(contracts)!: SubjectRef structural kind + opaque required role (WS-8/ADR-213)"
```

### Task 3: Contract — error envelope `subject-kind-not-supported` → `subject-structure-not-supported`

**Files:**

- Modify: `libs/substrate-contracts/src/primitives/error-envelope.ts:28`

- [ ] **Step 1: Write the failing test** (append to `subject-ref.spec.ts` or a new `error-envelope.spec.ts`):

```ts
import type { InferenceError } from './error-envelope.js';
it('envelope carries the structural variant', () => {
  const e: InferenceError = { kind: 'subject-structure-not-supported', received: 'cohort', supported: ['individual'] };
  expect(e.kind).toBe('subject-structure-not-supported');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run libs/substrate-contracts/src/primitives/`
Expected: FAIL (TS: variant `subject-structure-not-supported` does not exist).

- [ ] **Step 3: Rename the variant**

```ts
// error-envelope.ts — replace the line
//  | { kind: 'subject-kind-not-supported';    received: SubjectRef['kind']; supportedV1: readonly ['person'] }
   | { kind: 'subject-structure-not-supported'; received: SubjectRef['kind']; supported: readonly SubjectRef['kind'][] }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run libs/substrate-contracts/src/primitives/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-contracts/src/primitives/error-envelope.ts libs/substrate-contracts/src/primitives/subject-ref.spec.ts
git commit -m "feat(contracts)!: rename subject-kind-not-supported -> subject-structure-not-supported (WS-8)"
```

### Task 4: Contract — sweep contract specs + verify contracts package green

**Files:**

- Modify: `libs/substrate-contracts/src/inference/inference-zod.spec.ts` (7 refs)
- Modify: `libs/substrate-contracts/src/out-ports/member-resolution.port.spec.ts` (2 refs)

- [ ] **Step 1: Apply the transformation rules** (see top) to both files. Find every site:

```bash
git grep -n "kind: 'person'\|'agent'\|'world'\|subject-kind-not-supported\|supportedV1" -- libs/substrate-contracts/src/inference/inference-zod.spec.ts libs/substrate-contracts/src/out-ports/member-resolution.port.spec.ts
```

Replace `person`/`agent`/`world` fixtures with `{ kind:'individual', id, role:'test.subject' }`; rename any envelope assertion.

- [ ] **Step 2: Run the contracts suite**

Run: `npx vitest run libs/substrate-contracts`
Expected: PASS. (Also run `npx nx affected -t lint --base=release/1.0` to catch unused-import drift.)

- [ ] **Step 3: Verify no residual retired literal in contracts**

Run: `git grep -nE "kind: ?'person'|'agent'|'world'|subject-kind-not-supported|supportedV1" -- libs/substrate-contracts/src`
Expected: **no output**.

- [ ] **Step 4: Commit**

```bash
git add libs/substrate-contracts/src
git commit -m "test(contracts): migrate SubjectRef fixtures to individual+role (WS-8)"
```

### Task 5: Runtime — `normal-normal-fast-path` structural gate

**Files:**

- Modify: `libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.ts` (guards at `:105` posterior, `:226` counterfactual)
- Modify: `libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.spec.ts`

- [ ] **Step 1: Write/adjust the failing tests** — add a positive non-person case and a structural-rejection case:

```ts
// normal-normal-fast-path.adapter.spec.ts
it('accepts a non-person individual subject (role is opaque)', async () => {
  const res = await adapter.posterior({ ...validInput, subject: { kind: 'individual', id: UUID, role: 'markets.crypto-asset' } });
  expect(res.ok).toBe(true);
});

it('rejects a cohort subject with subject-structure-not-supported', async () => {
  const res = await adapter.posterior({ ...validInput, subject: { kind: 'cohort', ids: [UUID], role: 'x' } });
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toEqual({ kind: 'subject-structure-not-supported', received: 'cohort', supported: ['individual'] });
});
```

Also migrate the file's existing `{kind:'person'}` fixtures to `{kind:'individual', …, role:'test.subject'}` (3 refs).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.spec.ts`
Expected: FAIL (current guard rejects `individual` as non-person; envelope name mismatch).

- [ ] **Step 3: Convert both guards** (identical block at `:105` and `:226`):

```ts
// was:
//   if (input.subject.kind !== 'person') {
//     return err({ kind: 'subject-kind-not-supported', received: input.subject.kind, supportedV1: ['person'] as const });
//   }
    if (input.subject.kind !== 'individual') {
      return err({
        kind: 'subject-structure-not-supported',
        received: input.subject.kind,
        supported: ['individual'] as const,
      });
    }
```

(`input.subject.id` access just below stays valid — `individual` has `id`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.ts libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.spec.ts
git commit -m "feat(runtime)!: normal-normal structural gate (individual only) (WS-8)"
```

### Task 6: Runtime — `beta-binomial-fast-path` structural gate

**Files:**

- Modify: `libs/substrate-runtime/src/inference/adapters/beta-binomial-fast-path.adapter.ts` (guards at `:91`, `:210`)
- Modify: `libs/substrate-runtime/src/inference/adapters/beta-binomial-fast-path.adapter.spec.ts` (5 refs)

- [ ] **Step 1: Adjust the spec** — same positive/structural-rejection pair as Task 5 (use the adapter's existing `validInput`), migrate the 5 `person` fixtures.
- [ ] **Step 2: Run** → FAIL. `npx vitest run …/beta-binomial-fast-path.adapter.spec.ts`
- [ ] **Step 3: Convert both guards** — identical replacement to Task 5 Step 3.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/beta-binomial-fast-path.adapter.ts libs/substrate-runtime/src/inference/adapters/beta-binomial-fast-path.adapter.spec.ts
git commit -m "feat(runtime)!: beta-binomial structural gate (individual only) (WS-8)"
```

### Task 7: Runtime — `eb-hierarchical-beta-binomial` member gate (literal + message only)

**Files:**

- Modify: `libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.ts` (`:165`)
- Modify: `libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.spec.ts` (7 refs)

> **Distinct from Tasks 5/6:** this adapter accepts an `aggregate` *subject* whose *members* are single subjects, and uses `validation-failed` (NOT the envelope variant) to reject a member that has no own observation stream. Keep `validation-failed`; only change the literal and message.

- [ ] **Step 1: Adjust the spec** — the aggregate subject + members migrate to `{kind:'individual', …, role:'football.player'}`; assert an `aggregate`-member (nested) is rejected:

```ts
it('rejects a nested-aggregate member (Tier 5 deferral)', async () => {
  const res = await adapter.posterior({ ...aggInput, members: [{ subject: { kind: 'aggregate', id: UUID, role: 'football.team' }, /*…*/ }] });
  expect(res.ok).toBe(false);
  if (!res.ok) { expect(res.error.kind).toBe('validation-failed'); }
});
```

Migrate the file's 7 `person` refs (subject + members) to `individual`+role.

- [ ] **Step 2: Run** → FAIL. `npx vitest run …/eb-hierarchical-beta-binomial.adapter.spec.ts`
- [ ] **Step 3: Edit the member guard** (`:165`):

```ts
// comment + guard: replace 'person' with 'individual'
    const nonIndividual = members.find((m) => m.subject.kind !== 'individual');
    if (nonIndividual) {
      return err({
        kind: 'validation-failed',
        field: 'member.subject.kind',
        message: `EbHierarchicalBetaBinomialAdapter supports 'individual' members only this slice; got member kind '${nonIndividual.subject.kind}' (nested-aggregate recursion is deferred to Tier 5)`,
      });
    }
```

(Also update the explanatory comment above it: "A non-`individual` member (nested `aggregate` / `cohort`) has no own stream…".)

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.ts libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.spec.ts
git commit -m "feat(runtime)!: eb-hierarchical accepts individual members (WS-8)"
```

### Task 8: Runtime — `in-memory.adapter` structural gate

**Files:**

- Modify: `libs/substrate-runtime/src/adapters/inference/in-memory.adapter.ts` (`:83`)
- Modify: `libs/substrate-runtime/src/adapters/inference/in-memory.adapter.spec.ts` (3 refs)

- [ ] **Step 1: Adjust the spec** — positive non-person individual accepted; cohort rejected with the renamed variant; migrate 3 `person` refs. (Note this guard tests `subjectRef` which is **nullable** — keep a `null` subject accepted.)
- [ ] **Step 2: Run** → FAIL. `npx vitest run libs/substrate-runtime/src/adapters/inference/in-memory.adapter.spec.ts`
- [ ] **Step 3: Convert the guard** (`:83`):

```ts
    if (input.subjectRef !== null && input.subjectRef.kind !== 'individual') {
      return err({
        kind: 'subject-structure-not-supported',
        received: input.subjectRef.kind,
        supported: ['individual'] as const,
      });
    }
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/adapters/inference/in-memory.adapter.ts libs/substrate-runtime/src/adapters/inference/in-memory.adapter.spec.ts
git commit -m "feat(runtime)!: in-memory inference adapter structural gate (WS-8)"
```

### Task 9: Runtime — remaining spec sweeps + stale comment + full runtime green

**Files:**

- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.spec.ts` (13 refs)
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.posterior-event-log.integration.spec.ts` (2 refs)
- Modify: `libs/substrate-runtime/src/inference/testing/in-memory-inference-backbone.spec.ts` (7 refs)
- Modify: `libs/substrate-runtime/src/events/domain-event.schemas.ts` (`:14` comment)

- [ ] **Step 1: Apply the transformation rules** to the three router/testing specs (find sites with `git grep -n "kind: 'person'\|'agent'\|'world'\|subject-kind-not-supported\|supportedV1" -- <file>`). Router posterior tests that route by `conjugateHint` keep their flow; only the subject fixtures + any envelope assertions change.

- [ ] **Step 2: Fix the stale doc comment** in `events/domain-event.schemas.ts:14`:

```ts
//  *     `SubjectRef` kind (`person | agent | world | cohort`), so imposing the
   *     `SubjectRef` kind (`individual | cohort | aggregate`), so imposing the
```

- [ ] **Step 3: Verify no residual retired literal anywhere in runtime**

Run: `git grep -nE "kind: ?'person'|: ?'agent'|: ?'world'|subject-kind-not-supported|supportedV1" -- libs/substrate-runtime/src`
Expected: **no output** (the cohort cache-key branches at `*.adapter.ts:373/:395` use `=== 'cohort'`, not the retired literals — leave them).

- [ ] **Step 4: Full local gate green**

Run: `npx vitest run libs/substrate-contracts libs/substrate-runtime && npx nx affected -t lint --base=release/1.0`
Expected: PASS. Then `npm run ci:local` → PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src
git commit -m "test(runtime): migrate inference SubjectRef fixtures to individual+role (WS-8)"
```

### Task 10: WS-8 migration-guide section + verifier wave + PR into `release/1.0`

**Files:**

- Create: `docs/migration-substrate-1.0-ws8.md`

- [ ] **Step 1: Write the WS-8 migration section** — the consumer-facing breaking-change recipe (the Part-2 diffs below, plus: "any non-person subject becomes `{kind:'individual', id, role:'<pack>.<thing>'}`; catch `subject-structure-not-supported` not `subject-kind-not-supported`"). This folds into the unified `substrate@1.0` guide owned by substrate#92.

- [ ] **Step 2: Commit**

```bash
git add docs/migration-substrate-1.0-ws8.md
git commit -m "docs(migration): WS-8 SubjectRef section for the substrate@1.0 guide"
```

- [ ] **Step 3: Open PR `feat/ws8-subject-ontology` → `release/1.0`** with the PR body lines per cluster convention:
  - `Producer: <producer>/<model> [subagent-driven-development]`
  - `Effect: findings 0±1 expert` and `Effect: cycle-time <est> expert` (cross-repo PR — declare the self-observing indicators only).
  - Body links: ADR-213, ADR-218, spec `2026-06-06-ws8-subject-ontology-design.md`, epics substrate#92/#95.

- [ ] **Step 4: Run the verifier wave** (parallel, `isolation: "worktree"`): `local-ci` + `reviewer` + `charter-checker` + `qa-engineer`. `charter-checker` must confirm ADR-176 (no new kernel surface — change is removal). Resolve findings; re-run to green. **Do not merge to main; do not publish** — merge into `release/1.0` once green, then run the twin ritual (`drain` the wave, `backfill`, `reconcile`) for the PR.

---

## Part 2 — Consumer migration (exact diffs; applied & verified at the 1.0 cut, substrate#92)

> These cannot be green-gated by this plan: cluster domains consume the **published** `@de-braighter/substrate-contracts` (ADR-027), so they build against `substrate@1.0` only once substrate#92 publishes it (with WS-3 + WS-6 also landed). Apply + verify these when 1.0 publishes — or against a **local publish** of the `release/1.0` build for early verification. They are recorded here so the cut is mechanical.

### markets — `apps/markets-api/src/readout/readout.service.ts`

```ts
// :47–:50  remove the v1-workaround comment + the lie →
        subject: { kind: 'individual', id: ASSET_IDS[assetId], role: 'markets.crypto-asset' },
```

**Verify:** the BTC readout runs a Normal-Normal posterior with no `kind:'person'`; `git grep "kind: 'person'" apps/` → empty in inference calls. (markets has no Sonar gate; run `npm run build && npm test`.)

### exercir — `apps/pack-football-api/src/app/`

```ts
// pack-football.controller.ts:96,146  (player posterior)
    const subjectRef: SubjectRef       = { kind: 'individual', id: playerId, role: 'football.player' };
    const playerSubjectRef: SubjectRef = { kind: 'individual', id: playerId, role: 'football.player' };

// pack-football-player-match-day.controller.ts:103  (drop the local PersonSubjectRef at this boundary)
    const personRef: SubjectRef = { kind: 'individual', id: personId, role: 'football.player' };

// pack-football-team-twin.controller.ts:89  — already aggregate; confirm shape is { kind:'aggregate', id: teamId, role: 'football.team' } (field presence only; no behavior change)
```

**Out of scope (do NOT touch):** exercir's pack-local `PersonSubjectRef` type (`libs/pack-football/src/domain/subject-ref.ts`) and all `actorRef`/`playerRef`/`captainRef`/`playerOutRef` event-actor refs in `libs/pack-football/src/application/*` — they never cross the substrate inference port.
**Verify:** exercir builds green on 1.0; `git grep "kind: 'person'" apps/pack-football-api/src/app | grep -i subject` → empty.

---

## Self-review

**Spec coverage** (against `2026-06-06-ws8-subject-ontology-design.md`):

- §4.1 schema → Task 2. §4.2 envelope → Task 3. §5 four adapters → Tasks 5–8 (+ the `validation-failed` distinction for eb-hierarchical called out in Task 7). §6 consumers → Part 2. §7 invariants (aggregate kept, null kept, family-selection untouched) → preserved (no router dispatch edits; `Extract<…aggregate>` sites untouched). §8 release mechanics → Pre-flight + Task 10. §9 testing → the positive non-person + structural-rejection cases in Tasks 5–8 + the sweeps in 4/9. §10 ownership → Task 10 Step 4. §11 sub-decisions (`individual` / rename / required `role`) → Tasks 2–3.
- Gap check: none. All spec sections map to a task.

**Placeholder scan:** no TBD/TODO; every code step shows code; sweep tasks give the grep + transformation rule + verification grep (actionable, not vague).

**Type consistency:** `SubjectKind = 'individual'|'cohort'|'aggregate'` (Task 2) is the `received`/`supported` type in the envelope (Task 3) and the guard literal in Tasks 5–8; `subject-structure-not-supported` is used identically in Tasks 3,5,6,8; eb-hierarchical (Task 7) deliberately uses `validation-failed`, not that variant. Consistent.
