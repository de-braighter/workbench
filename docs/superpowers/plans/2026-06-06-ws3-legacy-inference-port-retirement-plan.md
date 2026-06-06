# WS-3 — Retire the legacy INFERENCE_BACKBONE_PORT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the tenant-blind legacy `INFERENCE_BACKBONE_PORT` so substrate has exactly one inference contract (the tenant-scoped `INFERENCE_BACKBONE`, required `tenantPackId`), and migrate the single exercir consumer onto it.

**Architecture:** Two-part, like WS-8. **Part 1 (substrate — green-gated now):** delete the legacy port file, drop the barrel re-export, remove the `InMemoryInferenceBackbone` binding + override from the composition root, on the shared `release/1.0` branch. **Part 2 (consumer — at the 1.0 cut):** re-point `exercir`'s one `engine-player-projection.service.ts` onto the scoped port + thread `tenantPackId`; green-gated when `substrate@1.0` publishes.

**Tech Stack:** TypeScript (ESM, `.js` extensions), Zod, NestJS DI (`Symbol.for` tokens), Nx + vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-06-ws3-legacy-inference-port-retirement-design.md`.

---

## Pre-flight

All Part-1 work is in the **substrate** repo on the shared `release/1.0` branch (created off `origin/main` by whichever of WS-3/WS-6/WS-8 runs first — see the WS-8 plan's Pre-flight for the `release/1.0` + worktree commands; reuse the same branch). Gate per the WS-8 plan: `npx vitest run`, `npx nx affected -t lint --base=release/1.0`, `npm run ci:local`. Never bypass pre-push hooks.

## File-structure map

**Part 1 — substrate:**

| File | Change |
|---|---|
| `libs/substrate-contracts/src/out-ports/inference.port.ts` | **Delete** (the legacy `INFERENCE_BACKBONE_PORT` token + `InferenceBackbone`/`PosteriorInput` shapes). |
| `libs/substrate-contracts/src/index.ts` | Drop the legacy-port re-export + its "legacy compatibility until retired" comment. |
| `libs/substrate-runtime/src/composition-root/substrate.module.ts` | Remove the `INFERENCE_BACKBONE_PORT` import (`:40`), the `InMemoryInferenceBackbone` provider/bindings (`:1203`, `:1377`), and the override method (`:172`). |
| `libs/substrate-runtime/src/**/in-memory-inference-backbone*.ts` | Delete the legacy `InMemoryInferenceBackbone` adapter if it is no longer referenced (grep first). |

**Part 2 — consumer (exercir):**

| File | Change |
|---|---|
| `domains/exercir/libs/pack-football/src/application/engine-player-projection.service.ts` | Re-point `@Inject(INFERENCE_BACKBONE_PORT)` → the scoped `INFERENCE_BACKBONE`; change the type import; add `tenantPackId` to the `posterior(...)` input. |
| `domains/exercir/libs/pack-football/src/inference/inference-backbone.providers.ts` | Ensure the scoped backbone is the bound provider (it imports `@de-braighter/substrate-runtime` already at `:59`). |

---

## Part 1 — Substrate (green-gated)

### Task 1: Inventory the legacy-token references (no edits yet)

**Files:** none.

- [ ] **Step 1: List every legacy reference so removal is complete**

Run:

```bash
SUB=D:/development/projects/de-braighter/layers/substrate
git -C "$SUB" grep -n "INFERENCE_BACKBONE_PORT\|InMemoryInferenceBackbone" -- 'libs/**/*.ts'
```

Expected: the contracts token def + barrel, the runtime composition-root bindings, the `InMemoryInferenceBackbone` adapter + its specs. Record the exact set — the removal must leave **zero** matches (outside historical comments you choose to keep).

### Task 2: Read the scoped port signatures (so the consumer migration is exact)

**Files:** none.

- [ ] **Step 1: Capture the scoped `posterior` + `sample` input shapes**

Run:

```bash
SUB=D:/development/projects/de-braighter/layers/substrate
git -C "$SUB" show release/1.0:libs/substrate-contracts/src/inference/inference-types.ts | sed -n '1,140p'
```

Confirm: scoped `PosteriorInput` requires `tenantPackId` (ADR-205); `sample` takes `{ handleId, replicas, horizonDays, seed }` (matches the legacy call). Note any field renames for Part 2.

### Task 3: Remove the legacy port from contracts (TDD)

**Files:**

- Delete: `libs/substrate-contracts/src/out-ports/inference.port.ts`
- Modify: `libs/substrate-contracts/src/index.ts`

- [ ] **Step 1: Write the failing guard test**

Create `libs/substrate-contracts/src/inference/no-legacy-port.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as barrel from '../index.js';

describe('WS-3: legacy inference port retired', () => {
  it('does not export INFERENCE_BACKBONE_PORT', () => {
    expect((barrel as Record<string, unknown>).INFERENCE_BACKBONE_PORT).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run libs/substrate-contracts/src/inference/no-legacy-port.spec.ts`
Expected: FAIL (the barrel still re-exports the token).

- [ ] **Step 3: Delete the port file + drop the barrel re-export**

Delete `out-ports/inference.port.ts`. In `index.ts`, remove the `export … from './out-ports/inference.port.js'` line and its preceding "legacy compatibility until retired" comment block.

- [ ] **Step 4: Run to verify it passes + contracts build**

Run: `npx vitest run libs/substrate-contracts && npx tsc -p libs/substrate-contracts/tsconfig.lib.json --noEmit`
Expected: PASS; no dangling-import TS errors.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-contracts/src
git commit -m "feat(contracts)!: remove legacy INFERENCE_BACKBONE_PORT (WS-3/ADR-212)"
```

### Task 4: Remove the legacy binding from the runtime composition root (TDD)

**Files:**

- Modify: `libs/substrate-runtime/src/composition-root/substrate.module.ts`
- Delete (if now unreferenced): the `InMemoryInferenceBackbone` adapter + its specs (paths from Task 1).

- [ ] **Step 1: Adjust the composition-root spec** — assert the module no longer provides the legacy token. In the relevant `substrate.module.spec.ts`, add:

```ts
it('does not provide the legacy INFERENCE_BACKBONE_PORT', () => {
  // resolving the legacy token should throw / be undefined after WS-3
  expect(() => moduleRef.get('@de-braighter/substrate-contracts/INFERENCE_BACKBONE_PORT' as never, { strict: false })).toBeDefined();
});
```

(Adapt to the spec's existing harness; the intent is "legacy token unbound.")

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run libs/substrate-runtime/src/composition-root`
Expected: FAIL (token still bound).

- [ ] **Step 3: Remove the import, provider, bindings, override method**

In `substrate.module.ts`: delete the `INFERENCE_BACKBONE_PORT` import (`:40`), the two `provide: INFERENCE_BACKBONE_PORT` bindings (`:1203`, `:1377`), the `InMemoryInferenceBackbone` provider wiring, and the override method (`:172`). Then delete the `InMemoryInferenceBackbone` adapter file(s) if Task 1 showed no remaining references.

- [ ] **Step 4: Run to verify it passes + full runtime suite green**

Run: `npx vitest run libs/substrate-runtime && npx nx affected -t lint --base=release/1.0`
Expected: PASS; lint clean.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src
git commit -m "feat(runtime)!: drop legacy InMemoryInferenceBackbone binding (WS-3/ADR-212)"
```

### Task 5: WS-3 migration-guide section

**Files:**

- Modify/Create: `docs/migration-substrate-1.0.md` (append a WS-3 section, or create alongside the WS-8 section).

- [ ] **Step 1: Document the consumer migration recipe** — "replace `@Inject(INFERENCE_BACKBONE_PORT)` with the scoped `INFERENCE_BACKBONE`; import from `@de-braighter/substrate-contracts/inference`; add `tenantPackId` to every posterior/counterfactual input." Commit.

```bash
git add docs/migration-substrate-1.0.md
git commit -m "docs(migration): WS-3 legacy-port removal section"
```

---

## Part 2 — Consumer (exercir; applied & verified at the 1.0 cut)

> Cannot be green-gated here — exercir builds against the **published** `substrate@1.0` (ADR-027). Apply + verify at the cut (or against a local publish of `release/1.0`).

### exercir — `engine-player-projection.service.ts`

```ts
// imports: from '@de-braighter/substrate-contracts' (legacy) →
import { INFERENCE_BACKBONE, type InferenceBackbone } from '@de-braighter/substrate-contracts/inference';

// constructor:
//   @Inject(INFERENCE_BACKBONE_PORT) private readonly inference: InferenceBackbone  →
    @Inject(INFERENCE_BACKBONE) private readonly inference: InferenceBackbone,

// posterior call (:71) — add tenantPackId (required by the scoped PosteriorInput, ADR-205):
    const posterior = await this.inference.posterior({
      tenantPackId,                       // NEW — from the request tenant context
      /* …existing fields, policy: { strategy: 'conjugate-fast-path', … } */
    });

// sample call (:81) — verify shape unchanged ({ handleId, replicas, horizonDays, seed }); no tenant needed (operates on a handle).
```

Wire `tenantPackId` from the pack's tenant context (the existing `tenant-pack-id-resolver.ts` already resolves it for the squad/plan-tree adapters). Confirm `inference-backbone.providers.ts` binds the scoped `INFERENCE_BACKBONE`.

**Verify:** `git grep "INFERENCE_BACKBONE_PORT" domains/exercir` → only historical comments; exercir builds green on `1.0`; the player-projection posterior+sample run with a real `tenantPackId`.

---

## Self-review

**Spec coverage:** §2 surface → Tasks 1/3/4 (substrate) + Part 2 (exercir). §3 decision (skip standalone deprecation publish; remove at 1.0) → Tasks 3/4 (no separate publish task). §4 invariants (scoped port untouched, singleton, no new surface) → preserved (only deletions). §5 release mechanics → Pre-flight + Part 2 cut. §6 testing → the guard tests in Tasks 3/4 + Part-2 verify. §7 ownership → headers.

**Placeholder scan:** Task 4 Step 1's spec assertion is intentionally "adapt to the existing harness" — the *intent* (legacy token unbound) is explicit; the exact NestJS `Test` harness call is the executing engineer's to match against the file. All deletions name exact files/lines.

**Type consistency:** `INFERENCE_BACKBONE` (scoped token) + `InferenceBackbone` (scoped type, from `/inference`) are used consistently in Part 2; the legacy `INFERENCE_BACKBONE_PORT` appears only as the thing being deleted/grepped-to-zero.
