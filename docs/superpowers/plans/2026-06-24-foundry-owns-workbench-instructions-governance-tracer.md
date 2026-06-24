# Foundry Owns the Workbench Instructions — Governance Tracer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan is also the input to the foundry `/build-path`** — each Task below maps 1:1 to a foundry work item (D5-1 … D5-7) with the stated scope / dependsOn / quality obligations.

**Goal:** Prove the full "foundry owns the instructions" vertical — observe → calibrate → enforce → generate — on ONE artifact (the review-floor rule in `policies/git.md`), modeled as a governance node the foundry owns, surfaced in the Studio cockpit.

**Architecture:** A governance node is a `CascadeNodeSpec`/`PlanNode` carrying Axis-2 governance fields on `metadata` (zero new kernel shape, the ADR-263 precedent). Pure log-derived views observe its firings; the absorbed devloop twin calibrates it; the `ACTION_REGISTRY` declares its enforcement actuator; a new `markdown` `CompileTarget` regenerates the policy fragment (founder-gated). Engine code lives in `domains/foundry` + `domains/studio`; the workbench repo (`de-braighter/workbench`) receives only the generated fragment + drift tripwire.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), vitest, event-sourced foundry (`log → fold → derived state`), Angular 21 signals-first (Studio), `@de-braighter/design-system-css` tokens.

## Global Constraints

- **Zero new kernel shape.** Governance fields ride on `metadata` (the `Record<string, unknown>` cast convention — NO typed wrapper class). If a primitive genuinely forces a kernel/contract change, STOP and trip `AUTONOMY(1)` (substrate-architect + charter) — never auto-apply. (ADR-176.)
- **State is derived, never stored** (ADR-242). Firings, calibration, and the boundary predicate are pure functions over the event log — no new persisted state.
- **Declaration ⊥ actuation** (ADR-263). The node carries both the declared twin-effect (`findings ↓`) and the actuation kind (`dispatch-review`); they are independent.
- **Mechanics stay actuators.** `gh`, the real `/code-review` run, the merge hot-path never become foundry state. The `dispatch-review` handler records intent only.
- **Founder-gate the regenerate seam.** Task 4 (D5-5) regenerate writes the workbench's own instructions — it is **founder-gated even under the `system-builder-studio` T0 waiver**. The PR must `foundry_gate_request{ship}` and a conductor merges only after `foundry_gate_status` shows an `approved` gate whose `payloadRef` references THIS item.
- **ESM import discipline:** explicit `.js` extensions on relative imports (foundry convention).
- **Per-repo CI gate:** `domains/foundry` → `npm run ci:local`; `domains/foundry/twin` → `npm run ci:local`; `domains/studio` → `pnpm -r run build && pnpm -r run test` (run the studio-ui project tests for UI tasks).
- **Product home:** `system-builder-studio`, phase-key `D5`. Studio repo work stays disjoint from the live path-builder (`studio/**`) items.
- **Twin ritual** after each merge per `policies/git.md` (drain → backfill → reconcile); PR bodies carry `Producer:` + `Effort:` + (where defensible) `Effect: cycle-time …`.

## §10 Open Questions — resolved defaults (carried into the tasks)

- **OQ-1 fragment granularity → FRAGMENT-LEVEL.** Generate only the review-floor *fragment*, delimited by sentinel comments in `policies/git.md` (mirrors `build-agents.sh` fragment generation). Not the whole file.
- **OQ-2 calibration indicator → REUSE `findings`.** Use the existing twin `findings` indicator (`domains/foundry/twin/src/inference/findings.ts`); no new indicator.
- **OQ-3 actuator identity → NEW `dispatch-review` action** (thin declared-actuator; real mechanic external), exact-membership acid extended. (No existing foundry op to bind.)

---

## File Structure

**`domains/foundry` (engine):**
- Create `src/governance/node.ts` — governance-node field accessors + the seeded `REVIEW_FLOOR` node spec (Task 1).
- Create `src/governance/node.spec.ts` — model + boundary-predicate tests (Task 1).
- Create `src/governance/observe.ts` — `reviewFloorFirings` derived view (Task 2).
- Create `src/governance/observe.spec.ts` (Task 2).
- Modify `src/workflow/actions.ts` — add `dispatch-review` to `ACTION_REGISTRY` + acid (Task 3).
- Modify `src/workflow/actions.spec.ts` (or the existing acid test file) (Task 3).
- Create `src/compiler/target-markdown.ts` — markdown `CompileTarget` (Task 4).
- Modify `src/compiler/registry.ts` — register `markdownTarget` (Task 4).
- Create `src/compiler/target-markdown.spec.ts` — golden round-trip (Task 4).

**`domains/foundry/twin` (calibration):**
- Create `twin/src/inference/review-floor-calibration.ts` — predicted-vs-observed for the review-floor (Task 5).
- Create `twin/src/inference/review-floor-calibration.spec.ts` (Task 5).

**`domains/studio/apps/studio-ui` (cockpit face):**
- Create `src/app/governance/governance.page.ts` — the Governance surface (Task 6).
- Create `src/app/governance/governance-view-model.ts` (Task 6).
- Create `src/app/governance/governance-read.port.ts` — DI token + snapshot shape (Task 6).
- Create `src/app/governance/index.ts` — barrel (Task 6).
- Modify `src/app/app.routes.ts` — lazy `/governance` route (Task 6).
- Create `src/app/governance/governance.page.spec.ts` (Task 6).

**`de-braighter/workbench` (this repo — generated artifact only):**
- Modify `policies/git.md` — add sentinel comments around the review-floor fragment (Task 4).
- Create `tools/governance-drift-check.md` or a tripwire note + the generated fragment snapshot (Task 4).

**Integration:**
- Create `domains/foundry/src/governance/wedge.integration.spec.ts` — end-to-end + genericity acid (Task 7).

---

## Task 1 (D5-1): Governance-node model + boundary predicate

**Files:**
- Create: `domains/foundry/src/governance/node.ts`
- Test: `domains/foundry/src/governance/node.spec.ts`

**Scope:** `domains/foundry`, pathPrefix `src/governance/node`. **DependsOn:** none (root). **Quality:** wave-standard.

**Interfaces:**
- Produces:
  - `GovernanceKind = 'guardrail'` (string-union; only `'guardrail'` for the tracer).
  - `interface GovernanceFields { governanceKind: GovernanceKind; sourceArtifact: string; action: string; authoredContent: { title: string; body: string }; }`
  - `governanceFields(node: PlanNode): GovernanceFields | null` — reads `node.metadata` (cast convention), returns null if `governanceKind` absent.
  - `REVIEW_FLOOR_KEY = 'review-floor'` and `REVIEW_FLOOR_NODE: CascadeNodeSpec` — the seeded review-floor governance node.
  - `reviewFloorBoundaryHolds(firing: { hadReviewVerdict: boolean }): boolean` — the boundary predicate (the rule: a merge satisfies the floor iff it carried ≥1 review verdict).

**Mirror:** the metadata-cast convention in `src/workflow/actions.ts:128-136` (`const meta = node.metadata as Record<string, unknown>`) and the `CascadeNodeSpec` shape in `src/plan/cascade.ts:21`.

- [ ] **Step 1: Write the failing test** — `domains/foundry/src/governance/node.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildCascadeTree } from '../plan/cascade.js';
import {
  REVIEW_FLOOR_NODE,
  REVIEW_FLOOR_KEY,
  governanceFields,
  reviewFloorBoundaryHolds,
} from './node.js';

describe('governance node model', () => {
  it('REVIEW_FLOOR_NODE declares the guardrail governance fields', () => {
    const tree = buildCascadeTree([REVIEW_FLOOR_NODE]);
    const node = tree.find((n) => (n.metadata as Record<string, unknown>)['_cascadeKey'] === REVIEW_FLOOR_KEY);
    expect(node).toBeDefined();
    const f = governanceFields(node!);
    expect(f).not.toBeNull();
    expect(f!.governanceKind).toBe('guardrail');
    expect(f!.sourceArtifact).toBe('policies/git.md#review-floor');
    expect(f!.action).toBe('dispatch-review');
    expect(f!.authoredContent.title.length).toBeGreaterThan(0);
    expect(f!.authoredContent.body).toContain('no PR merges unreviewed');
  });

  it('governanceFields returns null for a non-governance node', () => {
    const tree = buildCascadeTree([{ key: 'plain', kind: 'work-item', parent: null, meta: { title: 'x' } }]);
    expect(governanceFields(tree[0])).toBeNull();
  });

  it('boundary predicate: merge satisfies the floor iff it carried a review verdict', () => {
    expect(reviewFloorBoundaryHolds({ hadReviewVerdict: true })).toBe(true);
    expect(reviewFloorBoundaryHolds({ hadReviewVerdict: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run src/governance/node.spec.ts`
Expected: FAIL — `Cannot find module './node.js'`.

- [ ] **Step 3: Write minimal implementation** — `domains/foundry/src/governance/node.ts`

```typescript
import type { PlanNode } from '../plan/cascade.js';
import type { CascadeNodeSpec } from '../plan/cascade.js';

export type GovernanceKind = 'guardrail';

export interface GovernanceFields {
  governanceKind: GovernanceKind;
  sourceArtifact: string;
  action: string;
  authoredContent: { title: string; body: string };
}

export const REVIEW_FLOOR_KEY = 'review-floor';

/** Canonical authored content for the review-floor rule (the R3 generate source). */
const REVIEW_FLOOR_BODY = [
  '**Review floor: no PR merges unreviewed.** Every PR gets at least a single `/code-review`',
  'pass (one agent, low effort); non-trivial PRs get the full verifier wave',
  '(`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, in parallel).',
].join(' ');

export const REVIEW_FLOOR_NODE: CascadeNodeSpec = {
  key: REVIEW_FLOOR_KEY,
  kind: 'guardrail',
  parent: null,
  meta: {
    title: 'Review floor',
    governanceKind: 'guardrail',
    sourceArtifact: 'policies/git.md#review-floor',
    action: 'dispatch-review',
    authoredContent: { title: 'Review floor', body: REVIEW_FLOOR_BODY },
  },
};

export function governanceFields(node: PlanNode): GovernanceFields | null {
  const m = node.metadata as Record<string, unknown>;
  if (m['governanceKind'] !== 'guardrail') return null;
  const ac = m['authoredContent'] as { title?: unknown; body?: unknown } | undefined;
  return {
    governanceKind: 'guardrail',
    sourceArtifact: String(m['sourceArtifact'] ?? ''),
    action: String(m['action'] ?? ''),
    authoredContent: { title: String(ac?.title ?? ''), body: String(ac?.body ?? '') },
  };
}

/** The boundary predicate: a merge satisfies the review floor iff it carried ≥1 review verdict. */
export function reviewFloorBoundaryHolds(firing: { hadReviewVerdict: boolean }): boolean {
  return firing.hadReviewVerdict;
}
```

> If `PlanNode`/`CascadeNodeSpec` are not both exported from `cascade.ts`, import each from its real location (the explore map cites both in `src/plan/cascade.ts`). Verify the `_cascadeKey` injection (ADR-249 §key-recovery) is how `buildCascadeTree` keys nodes; if the test can't find the node by `_cascadeKey`, match on `metadata.title` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run src/governance/node.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/governance/node.ts domains/foundry/src/governance/node.spec.ts
git commit -m "feat(foundry): governance-node model + review-floor seed (D5-1)"
```

---

## Task 2 (D5-2): Observe — `reviewFloorFirings` derived view

**Files:**
- Create: `domains/foundry/src/governance/observe.ts`
- Test: `domains/foundry/src/governance/observe.spec.ts`

**Scope:** `domains/foundry`, pathPrefix `src/governance/observe`. **DependsOn:** D5-1. **Quality:** wave-standard.

**Interfaces:**
- Consumes: `reviewFloorBoundaryHolds` (Task 1); the canonical event log envelopes + `EVENT` names from `src/events.ts` (`MERGE_RECORDED`, `GATE_REQUESTED`, `GATE_DECIDED`, `CLAIM_RELEASED`) and any twin `FindingRecorded` event present on the shared canonical log.
- Produces:
  - `interface ReviewFloorFiring { prRef: string; mergedAt: string; hadReviewVerdict: boolean; satisfied: boolean; }`
  - `reviewFloorFirings(envelopes: DomainEventEnvelope[]): ReviewFloorFiring[]` — one firing per `MERGE_RECORDED`; `hadReviewVerdict` = a review/findings/wave-verdict event for the same `prRef` occurred at/before the merge.

**Mirror:** the pure-log-derivation shape of `deriveSubstanceFromLog` (`src/metamodel/substance-log.ts:18-29`) and the fold in `src/state.ts:154`. **Read the real event payload shapes in `src/events.ts` before implementing** — the exact `prRef`/PR-identity field names must match the live events; do not guess them.

- [ ] **Step 1: Write the failing test** — `domains/foundry/src/governance/observe.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { reviewFloorFirings } from './observe.js';

// Minimal hand-built envelopes; adapt the eventType + payload keys to the REAL shapes in src/events.ts.
function env(eventType: string, payload: Record<string, unknown>, occurredAt: string) {
  return { eventType, payload, occurredAt, eventId: occurredAt + eventType } as any;
}

describe('reviewFloorFirings', () => {
  it('a merge WITH a prior review verdict satisfies the floor', () => {
    const envs = [
      env('foundry:FindingRecorded.v1', { prRef: 'repo#1', verifier: 'reviewer' }, '2026-06-24T10:00:00Z'),
      env('foundry:MergeRecorded.v1', { prRef: 'repo#1', itemId: 'x/E1' }, '2026-06-24T11:00:00Z'),
    ];
    const firings = reviewFloorFirings(envs);
    expect(firings).toHaveLength(1);
    expect(firings[0].prRef).toBe('repo#1');
    expect(firings[0].hadReviewVerdict).toBe(true);
    expect(firings[0].satisfied).toBe(true);
  });

  it('a merge with NO prior review verdict violates the floor', () => {
    const envs = [env('foundry:MergeRecorded.v1', { prRef: 'repo#2', itemId: 'x/E2' }, '2026-06-24T11:00:00Z')];
    const firings = reviewFloorFirings(envs);
    expect(firings).toHaveLength(1);
    expect(firings[0].satisfied).toBe(false);
  });

  it('a review verdict AFTER the merge does NOT count', () => {
    const envs = [
      env('foundry:MergeRecorded.v1', { prRef: 'repo#3', itemId: 'x/E3' }, '2026-06-24T11:00:00Z'),
      env('foundry:FindingRecorded.v1', { prRef: 'repo#3', verifier: 'reviewer' }, '2026-06-24T12:00:00Z'),
    ];
    expect(reviewFloorFirings(envs)[0].satisfied).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run src/governance/observe.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `domains/foundry/src/governance/observe.ts`

```typescript
import type { DomainEventEnvelope } from '../events.js';
import { reviewFloorBoundaryHolds } from './node.js';

const MERGE = 'foundry:MergeRecorded.v1';
// Review-verdict signals present on the shared canonical log. Confirm the exact eventType + pr field
// names against src/events.ts (foundry) and twin/src events before relying on these literals.
const VERDICT_TYPES = new Set(['foundry:FindingRecorded.v1']);

export interface ReviewFloorFiring {
  prRef: string;
  mergedAt: string;
  hadReviewVerdict: boolean;
  satisfied: boolean;
}

function prOf(payload: Record<string, unknown>): string | null {
  const p = payload['prRef'] ?? payload['pr'] ?? payload['prUrl'];
  return typeof p === 'string' ? p : null;
}

export function reviewFloorFirings(envelopes: DomainEventEnvelope[]): ReviewFloorFiring[] {
  const verdictsByPr = new Map<string, string[]>(); // prRef -> verdict occurredAt[]
  for (const e of envelopes) {
    if (!VERDICT_TYPES.has(e.eventType)) continue;
    const pr = prOf(e.payload as Record<string, unknown>);
    if (pr == null) continue;
    (verdictsByPr.get(pr) ?? verdictsByPr.set(pr, []).get(pr)!).push(e.occurredAt);
  }
  const firings: ReviewFloorFiring[] = [];
  for (const e of envelopes) {
    if (e.eventType !== MERGE) continue;
    const pr = prOf(e.payload as Record<string, unknown>);
    if (pr == null) continue;
    const mergedAt = e.occurredAt;
    const hadReviewVerdict = (verdictsByPr.get(pr) ?? []).some((t) => t <= mergedAt);
    firings.push({ prRef: pr, mergedAt, hadReviewVerdict, satisfied: reviewFloorBoundaryHolds({ hadReviewVerdict }) });
  }
  return firings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run src/governance/observe.spec.ts`
Expected: PASS (3 tests). **Mutation check:** temporarily change `t <= mergedAt` to `true` → the "AFTER the merge does NOT count" test must go RED. Revert.

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/governance/observe.ts domains/foundry/src/governance/observe.spec.ts
git commit -m "feat(foundry): reviewFloorFirings log-derived view (D5-2)"
```

---

## Task 3 (D5-4): Declare the enforcement actuator (`dispatch-review`)

**Files:**
- Modify: `domains/foundry/src/workflow/actions.ts`
- Test: `domains/foundry/src/workflow/actions.spec.ts` (extend the existing exact-membership acid; if the acid lives elsewhere, find it via `grep -r "reprioritize-product" domains/foundry/src` and extend that file).

**Scope:** `domains/foundry`, pathPrefix `src/workflow/actions`. **DependsOn:** D5-1. **Quality:** wave-standard.

**Interfaces:**
- Produces: a new `ACTION_REGISTRY` entry `['dispatch-review', dispatchReviewAction]`. The handler is a **thin declared-actuator**: it returns a dispatch descriptor `{ kind: 'dispatch-review', prRef, requestedAt }` and does NOT run `/code-review` (external mechanic). It must NOT call any store-locked mutating op (unlike the other handlers) — review dispatch produces no foundry state.

**Mirror:** `requestGateAction` arg-validation (`src/workflow/actions.ts:34-39`) and the registry shape (`:101`).

- [ ] **Step 1: Write the failing test** (extend the acid)

```typescript
import { describe, it, expect } from 'vitest';
import { ACTION_REGISTRY, actuate } from './actions.js';

describe('dispatch-review action (D5-4)', () => {
  it('ACTION_REGISTRY membership is exactly the four sanctioned kinds', () => {
    expect([...ACTION_REGISTRY.keys()].sort()).toEqual(
      ['build-path', 'dispatch-review', 'reprioritize-product', 'request-gate'].sort(),
    );
  });

  it('dispatch-review returns a dispatch descriptor and writes no foundry state', () => {
    const deps = { now: () => '2026-06-24T10:00:00Z' } as any;
    const out = actuate(deps, 'dispatch-review', { prRef: 'repo#1' }) as Record<string, unknown>;
    expect(out['kind']).toBe('dispatch-review');
    expect(out['prRef']).toBe('repo#1');
    expect(out['requestedAt']).toBe('2026-06-24T10:00:00Z');
  });

  it('a founder-governance op (gate-decide) is NOT seedable', () => {
    expect(ACTION_REGISTRY.has('gate-decide' as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run src/workflow/actions.spec.ts`
Expected: FAIL — membership has 3 keys; `dispatch-review` unknown.

- [ ] **Step 3: Write minimal implementation** — in `src/workflow/actions.ts`

```typescript
// Add ActionKind union member 'dispatch-review' (find the ActionKind type and add it).
// Add the handler near the others:
const dispatchReviewAction: ActionHandler = (deps, args) => {
  const prRef = args['prRef'];
  if (typeof prRef !== 'string') throw new Error('dispatch-review requires args.prRef (string)');
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  // Thin declared-actuator: record intent only. The real /code-review run is an EXTERNAL mechanic.
  return { kind: 'dispatch-review' as const, prRef, requestedAt: nowIso };
};

// Add to the registry map (keep the existing three):
//   ['dispatch-review', dispatchReviewAction],
```

> Verify `deps.now` exists on `FoundryDeps`; if not, mirror however the other handlers read the clock (the explore map shows `nowIso` derived from `deps.now` in `mcp/tools.ts:52`). Keep the handler side-effect-free.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run src/workflow/actions.spec.ts`
Expected: PASS. Then full file: `npx vitest run src/workflow` (no regressions in existing action tests).

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/src/workflow/actions.ts domains/foundry/src/workflow/actions.spec.ts
git commit -m "feat(foundry): declare dispatch-review actuator + extend membership acid (D5-4)"
```

---

## Task 4 (D5-5): Markdown compile target + drift tripwire  ⚠ FOUNDER-GATED

**Files:**
- Create: `domains/foundry/src/compiler/target-markdown.ts`
- Modify: `domains/foundry/src/compiler/registry.ts`
- Test: `domains/foundry/src/compiler/target-markdown.spec.ts`
- Modify (workbench, R3 OUTPUT): `policies/git.md` (add sentinel comments around the review-floor fragment).

**Scope:** `domains/foundry`, pathPrefix `src/compiler/target-markdown` + `src/compiler/registry`. **DependsOn:** D5-1. **Quality:** wave-standard + **push-actuator-review** (the regenerate seam). **Gate:** `foundry_gate_request{ship}` — founder-gated; a conductor merges only after `foundry_gate_status` shows `approved` for THIS item.

**Interfaces:**
- Consumes: `governanceFields` (Task 1); `CompileTarget<O>` (`src/compiler/compile-target.ts:7`); `ProductBlueprint`.
- Produces:
  - `markdownTarget: CompileTarget<string>` (`name: 'markdown'`) — walks the blueprint, emits the policy fragment for each governance node (`## <title>\n\n<body>`), joined by blank lines.
  - registered in the `registry.ts` `TARGETS` map.
  - `governanceFragment(body: string): string` helper producing the sentinel-wrapped block:
    `<!-- governance:review-floor:start -->\n…\n<!-- governance:review-floor:end -->`.

**Mirror:** `materializeHtml` text-emission (`src/compiler/materialize-html.ts:70-90`) and the registry entry pattern (`src/compiler/registry.ts:8-12`).

- [ ] **Step 1: Write the failing test** — `target-markdown.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { extractBlueprint } from '../metamodel/blueprint.js'; // confirm the real extractor name
import { buildCascadeTree } from '../plan/cascade.js';
import { REVIEW_FLOOR_NODE } from '../governance/node.js';
import { markdownTarget } from './target-markdown.js';
import { compile } from './registry.js';

function reviewFloorBlueprint() {
  // Build a minimal ProductBlueprint whose process tree contains the review-floor node.
  // Use the same construction the other target specs use; adapt to extractBlueprint's real signature.
  const process = buildCascadeTree([REVIEW_FLOOR_NODE]);
  return { productKey: 'gov', process, done: [] } as any;
}

describe('markdown compile target (D5-5)', () => {
  it('compiles the review-floor governance node to its policy fragment', () => {
    const md = markdownTarget.compile(reviewFloorBlueprint());
    expect(md).toContain('Review floor');
    expect(md).toContain('no PR merges unreviewed');
    expect(md).toContain('governance:review-floor:start');
    expect(md).toContain('governance:review-floor:end');
  });

  it('is registered in the target registry under "markdown"', () => {
    const md = compile(reviewFloorBlueprint(), 'markdown') as string;
    expect(md).toContain('Review floor');
  });

  it('round-trips: the generated fragment equals the canonical policies/git.md fragment', () => {
    const md = markdownTarget.compile(reviewFloorBlueprint());
    // The canonical body lives on REVIEW_FLOOR_NODE.authoredContent — this pins generate-fidelity.
    expect(md).toMatch(/Review floor[\s\S]*verifier wave/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run src/compiler/target-markdown.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `src/compiler/target-markdown.ts`

```typescript
import type { CompileTarget } from './compile-target.js';
import type { ProductBlueprint } from '../metamodel/blueprint.js';
import { governanceFields } from '../governance/node.js';

export function governanceFragment(key: string, title: string, body: string): string {
  return [`<!-- governance:${key}:start -->`, `## ${title}`, '', body, `<!-- governance:${key}:end -->`].join('\n');
}

export const markdownTarget: CompileTarget<string> = {
  name: 'markdown',
  compile(blueprint: ProductBlueprint): string {
    const frags: string[] = [];
    for (const node of blueprint.process) {
      const f = governanceFields(node);
      if (f == null) continue;
      const key = String((node.metadata as Record<string, unknown>)['_cascadeKey'] ?? 'governance');
      frags.push(governanceFragment(key, f.authoredContent.title, f.authoredContent.body));
    }
    return frags.join('\n\n');
  },
};
```

Then register in `src/compiler/registry.ts` (add to the `TARGETS` map + the import):
```typescript
import { markdownTarget } from './target-markdown.js';
// inside the Map literal, add:
//   [markdownTarget.name, markdownTarget as AnyTarget],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run src/compiler/target-markdown.spec.ts && npx vitest run src/compiler/registry.spec.ts`
Expected: PASS; the existing registry test (`listTargets()` membership) must now include `'markdown'` — update its expected list if it pins membership.

- [ ] **Step 5: Add the sentinel block to the workbench policy + a drift tripwire**

In `de-braighter/workbench` → `policies/git.md`, wrap the existing review-floor paragraph with the sentinels so the generated fragment maps to a real region:
```markdown
<!-- governance:review-floor:start -->
## Review floor
…existing review-floor prose…
<!-- governance:review-floor:end -->
```
Add a drift-tripwire test (in foundry, reading the workbench file via a relative path or a committed snapshot) asserting the sentinel block equals `markdownTarget.compile(reviewFloorBlueprint())`. If a cross-repo path read is brittle, commit the generated fragment as a fixture `src/compiler/__fixtures__/review-floor.md` and assert equality; the workbench-side check becomes a documented manual step in the PR.

- [ ] **Step 6: Commit (foundry) + open the FOUNDER-GATED PR**

```bash
git add domains/foundry/src/compiler/target-markdown.ts domains/foundry/src/compiler/registry.ts domains/foundry/src/compiler/target-markdown.spec.ts
git commit -m "feat(foundry): markdown compile target + review-floor drift tripwire (D5-5)"
```
Open the PR, then `foundry_gate_request{ gateType: 'ship', productKey: 'system-builder-studio', payloadRef: '<this PR + D5-5 itemId>' }`. **Do NOT merge** until `foundry_gate_status` shows `approved` for THIS item. The workbench `policies/git.md` edit is a separate PR on `de-braighter/workbench` (review-floor regenerate is the founder-gated act).

---

## Task 5 (D5-3): Calibrate — predicted-vs-observed for the review-floor

**Files:**
- Create: `domains/foundry/twin/src/inference/review-floor-calibration.ts`
- Test: `domains/foundry/twin/src/inference/review-floor-calibration.spec.ts`

**Scope:** `domains/foundry/twin`, pathPrefix `src/inference/review-floor-calibration`. **DependsOn:** D5-2. **Quality:** wave-standard.

**Interfaces:**
- Consumes: `reviewFloorFirings` (Task 2) — import across the `src ↔ twin` boundary (the twin already reads the same canonical log; if a direct import crosses the package boundary awkwardly, pass the firings in as a parameter). The twin `findings` indicator (`twin/src/inference/findings.ts`) + the posterior/seeded-PRNG conventions (`twin/src/inference/cycle-time.ts:82`, `calibration.ts:53`).
- Produces:
  - `interface ReviewFloorCalibration { firings: number; satisfiedRate: number; findingsWhenSatisfied: number; findingsWhenViolated: number; }`
  - `reviewFloorCalibration(firings: ReviewFloorFiring[], findingsByPr: Map<string, number>): ReviewFloorCalibration` — the predicted-vs-observed summary ("does satisfying the floor associate with fewer escaped findings?").

**Mirror:** `calibration()` pairing logic (`twin/src/inference/calibration.ts:53-95`); keep any random draw **seeded** (mulberry32) — the foundry-arc replay-stability lesson (unseeded `Math.random` was a CRITICAL caught in the foundry v0 review).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { reviewFloorCalibration } from './review-floor-calibration.js';

describe('reviewFloorCalibration (D5-3)', () => {
  const firings = [
    { prRef: 'r#1', mergedAt: 't1', hadReviewVerdict: true, satisfied: true },
    { prRef: 'r#2', mergedAt: 't2', hadReviewVerdict: true, satisfied: true },
    { prRef: 'r#3', mergedAt: 't3', hadReviewVerdict: false, satisfied: false },
  ];
  const findingsByPr = new Map([['r#1', 1], ['r#2', 0], ['r#3', 5]]);

  it('summarizes satisfied-rate and findings split', () => {
    const c = reviewFloorCalibration(firings as any, findingsByPr);
    expect(c.firings).toBe(3);
    expect(c.satisfiedRate).toBeCloseTo(2 / 3, 5);
    expect(c.findingsWhenSatisfied).toBeCloseTo(0.5, 5); // (1+0)/2
    expect(c.findingsWhenViolated).toBeCloseTo(5, 5);    // 5/1
  });

  it('is replay-stable (no unseeded randomness)', () => {
    const a = reviewFloorCalibration(firings as any, findingsByPr);
    const b = reviewFloorCalibration(firings as any, findingsByPr);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry/twin && npx vitest run src/inference/review-floor-calibration.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface ReviewFloorFiringLike { prRef: string; satisfied: boolean; }
export interface ReviewFloorCalibration {
  firings: number;
  satisfiedRate: number;
  findingsWhenSatisfied: number;
  findingsWhenViolated: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function reviewFloorCalibration(
  firings: ReviewFloorFiringLike[],
  findingsByPr: Map<string, number>,
): ReviewFloorCalibration {
  const sat = firings.filter((f) => f.satisfied);
  const vio = firings.filter((f) => !f.satisfied);
  const findingsOf = (f: ReviewFloorFiringLike) => findingsByPr.get(f.prRef) ?? 0;
  return {
    firings: firings.length,
    satisfiedRate: firings.length === 0 ? 0 : sat.length / firings.length,
    findingsWhenSatisfied: mean(sat.map(findingsOf)),
    findingsWhenViolated: mean(vio.map(findingsOf)),
  };
}
```

> If you extend this to a true posterior (Beta on satisfied-rate, or a findings-delta interval), seed the PRNG with mulberry32 — never `Math.random`. The deterministic summary above already satisfies replay-stability.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry/twin && npx vitest run src/inference/review-floor-calibration.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add domains/foundry/twin/src/inference/review-floor-calibration.ts domains/foundry/twin/src/inference/review-floor-calibration.spec.ts
git commit -m "feat(twin): review-floor predicted-vs-observed calibration (D5-3)"
```

---

## Task 6 (D5-6): Cockpit "Governance" surface (Studio)

**Files:**
- Create: `domains/studio/apps/studio-ui/src/app/governance/governance.page.ts`
- Create: `domains/studio/apps/studio-ui/src/app/governance/governance-view-model.ts`
- Create: `domains/studio/apps/studio-ui/src/app/governance/governance-read.port.ts`
- Create: `domains/studio/apps/studio-ui/src/app/governance/index.ts`
- Modify: `domains/studio/apps/studio-ui/src/app/app.routes.ts`
- Test: `domains/studio/apps/studio-ui/src/app/governance/governance.page.spec.ts`

**Scope:** `domains/studio`, pathPrefix `apps/studio-ui/src/app/governance` (+ the one shared `app.routes.ts` line). **DependsOn:** D5-1, D5-2, D5-3. **Quality:** wave-standard + a11y-battery (WCAG 2.2 AA).

**Interfaces:**
- Produces:
  - `GOVERNANCE_READ_PORT` (DI token) + `interface GovernanceSnapshot { node: { title: string; sourceArtifact: string; action: string }; firings: { prRef: string; satisfied: boolean }[]; calibration: { satisfiedRate: number; findingsWhenSatisfied: number; findingsWhenViolated: number }; }`
  - `GovernancePage` standalone component (selector `sbs-governance`, `embedded = input(false)`), `OnPush`, signals-first.
  - `buildGovernanceViewModel(snapshot): GovernanceViewModel` (pure).
  - a founder-gated **"Regenerate fragment"** button that calls a drive port action (stubbed — emits intent only; the real regenerate is the founder-gated D5-5 flow).

**Mirror:** `operate.page.ts` + `cockpit-view-model.ts` + `foundry-operate-read.port.ts` structure, and `calibration.page.ts:556` component conventions (input/computed signals, `data-skin="exercir"`, the `--ink`/`--bg`/`--accent` design-system tokens, `.glass-panel`/`.sr-only` utilities). Lazy-load route mirroring `operate` in `app.routes.ts:45`.

- [ ] **Step 1: Write the failing test** — `governance.page.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildGovernanceViewModel } from './governance-view-model.js';

describe('governance view-model (D5-6)', () => {
  it('projects the snapshot into display rows', () => {
    const vm = buildGovernanceViewModel({
      node: { title: 'Review floor', sourceArtifact: 'policies/git.md#review-floor', action: 'dispatch-review' },
      firings: [{ prRef: 'r#1', satisfied: true }, { prRef: 'r#2', satisfied: false }],
      calibration: { satisfiedRate: 0.5, findingsWhenSatisfied: 0.5, findingsWhenViolated: 5 },
    });
    expect(vm.title).toBe('Review floor');
    expect(vm.firingCount).toBe(2);
    expect(vm.satisfiedRatePct).toBe('50%');
    expect(vm.violations).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/studio && npx vitest run apps/studio-ui/src/app/governance/governance.page.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the view-model, port, component, barrel, route**

`governance-view-model.ts`:
```typescript
import type { GovernanceSnapshot } from './governance-read.port.js';

export interface GovernanceViewModel {
  title: string;
  sourceArtifact: string;
  action: string;
  firingCount: number;
  violations: number;
  satisfiedRatePct: string;
  findingsWhenSatisfied: number;
  findingsWhenViolated: number;
}

export function buildGovernanceViewModel(s: GovernanceSnapshot): GovernanceViewModel {
  return {
    title: s.node.title,
    sourceArtifact: s.node.sourceArtifact,
    action: s.node.action,
    firingCount: s.firings.length,
    violations: s.firings.filter((f) => !f.satisfied).length,
    satisfiedRatePct: `${Math.round(s.calibration.satisfiedRate * 100)}%`,
    findingsWhenSatisfied: s.calibration.findingsWhenSatisfied,
    findingsWhenViolated: s.calibration.findingsWhenViolated,
  };
}
```

`governance-read.port.ts`:
```typescript
import { InjectionToken } from '@angular/core';

export interface GovernanceSnapshot {
  node: { title: string; sourceArtifact: string; action: string };
  firings: { prRef: string; satisfied: boolean }[];
  calibration: { satisfiedRate: number; findingsWhenSatisfied: number; findingsWhenViolated: number };
}

export interface GovernanceReadPort {
  snapshot(): GovernanceSnapshot;
}

export const GOVERNANCE_READ_PORT = new InjectionToken<GovernanceReadPort>('GOVERNANCE_READ_PORT');
```

`governance.page.ts` — mirror `operate.page.ts` (standalone, `selector: 'sbs-governance'`, `embedded = input(false)`, `inject(GOVERNANCE_READ_PORT)`, `model = computed(() => buildGovernanceViewModel(port.snapshot()))`, OnPush). Render the node, a firings table (`prRef` + satisfied badge using `--color-ok`/`--color-risk`), the calibration summary, and a founder-gated "Regenerate fragment" `<button>` (a11y: real button, focus-visible, `aria-describedby` warning that it rewrites `policies/git.md`). Hide its own header/brand when `embedded()` (the single-header convention from CLEANUP-3). Provide a default in-memory `GOVERNANCE_READ_PORT` implementation in the route providers.

`index.ts`: `export { GovernancePage } from './governance.page.js';`

`app.routes.ts`: add (mirror the operate route):
```typescript
{ path: 'governance', loadComponent: () => import('./governance').then((m) => m.GovernancePage) },
```

- [ ] **Step 4: Run tests + a11y + build**

Run: `cd domains/studio && npx vitest run apps/studio-ui/src/app/governance/`
Expected: PASS. Then `pnpm -r run build` (studio) must stay green. Run the a11y-pro audit on the new surface (WCAG 2.2 AA: target size ≥24px, focus-visible, the regenerate button's `aria-describedby`).

- [ ] **Step 5: Browser-verify (mandatory — "tests green ≠ renders")**

`ng serve` the studio-ui, navigate to `/governance`, screenshot. Confirm the surface RENDERS (not blank) under `data-skin="exercir"` + the canonical `[data-theme]` tokens — this is the token-divergence trap from CLEANUP-1 (jsdom/a11y pass while the page renders blank). Attach the screenshot to the PR.

- [ ] **Step 6: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/governance domains/studio/apps/studio-ui/src/app/app.routes.ts
git commit -m "feat(studio): Governance cockpit surface for the review-floor guardrail (D5-6)"
```

---

## Task 7 (D5-7): Wedge proof + genericity acid

**Files:**
- Create: `domains/foundry/src/governance/wedge.integration.spec.ts`

**Scope:** `domains/foundry`, pathPrefix `src/governance/wedge`. **DependsOn:** D5-1, D5-2, D5-4, D5-5 (and conceptually D5-3/D5-6, but the integration acid runs in the foundry repo over the engine pieces). **Quality:** wave-standard.

**Interfaces:**
- Consumes: `REVIEW_FLOOR_NODE`, `governanceFields` (T1); `reviewFloorFirings` (T2); `ACTION_REGISTRY` (T3); `markdownTarget` (T4).

- [ ] **Step 1: Write the end-to-end + genericity test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildCascadeTree } from '../plan/cascade.js';
import { REVIEW_FLOOR_NODE, governanceFields } from './node.js';
import { reviewFloorFirings } from './observe.js';
import { ACTION_REGISTRY } from '../workflow/actions.js';
import { markdownTarget } from '../compiler/target-markdown.js';

describe('governance tracer wedge (D5-7)', () => {
  it('full vertical: model -> observe -> declared actuator -> generate', () => {
    const tree = buildCascadeTree([REVIEW_FLOOR_NODE]);
    const node = tree.find((n) => governanceFields(n) !== null)!;
    const f = governanceFields(node)!;

    // model: action references a registered actuator
    expect(ACTION_REGISTRY.has(f.action as any)).toBe(true);

    // observe: a violating merge is detected
    const envs = [{ eventType: 'foundry:MergeRecorded.v1', payload: { prRef: 'r#9' }, occurredAt: 't', eventId: 'e' }] as any;
    expect(reviewFloorFirings(envs)[0].satisfied).toBe(false);

    // generate: the fragment carries the canonical rule + sentinels
    const md = markdownTarget.compile({ productKey: 'gov', process: tree, done: [] } as any);
    expect(md).toContain('governance:review-floor:start');
    expect(md).toContain('no PR merges unreviewed');
  });

  it('GENERICITY ACID: a SECOND governance artifact re-expresses with ZERO new vocabulary', () => {
    // A different rule (e.g. the testing-policy "TDD" rule) modeled with the SAME fields + node-kind.
    const testingRule = {
      key: 'tdd-floor',
      kind: 'guardrail',
      parent: null,
      meta: {
        title: 'TDD floor',
        governanceKind: 'guardrail',
        sourceArtifact: 'policies/testing.md#tdd',
        action: 'dispatch-review',
        authoredContent: { title: 'TDD floor', body: 'Write the failing test before the implementation.' },
      },
    };
    const tree = buildCascadeTree([testingRule]);
    const f = governanceFields(tree[0]);
    expect(f).not.toBeNull();
    expect(f!.governanceKind).toBe('guardrail'); // NO new node-kind
    const md = markdownTarget.compile({ productKey: 'gov2', process: tree, done: [] } as any);
    expect(md).toContain('TDD floor'); // same compiler, different artifact — non-trivial (not a subset of review-floor)
    expect(md).not.toContain('no PR merges unreviewed');
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd domains/foundry && npx vitest run src/governance/wedge.integration.spec.ts`
Expected: PASS (2 tests). Then the full repo gate: `npm run ci:local`.

- [ ] **Step 3: Commit**

```bash
git add domains/foundry/src/governance/wedge.integration.spec.ts
git commit -m "test(foundry): governance tracer wedge proof + genericity acid (D5-7)"
```

---

## Self-Review

**Spec coverage:** R1 observe → Task 2; R1 calibrate → Task 5; R2 enforce → Task 3; R3 generate → Task 4; the governance-node model → Task 1; the cockpit face → Task 6; the wedge proof + genericity kill-criterion → Task 7. The §10 OQs are resolved in the header. Founder-gate on R3 → Task 4 gate step. Zero-kernel-change → Global Constraints + every task uses `metadata` only. **All spec sections map to a task.**

**Placeholder scan:** no "TBD/TODO/handle edge cases"; every code step has real code or a precise "mirror this precedent + read these real event shapes" instruction (Tasks 2 and 4 explicitly flag the event-payload + extractor names to confirm against live code rather than guess — an honesty requirement, not a placeholder).

**Type consistency:** `governanceFields` / `GovernanceFields` (T1) consumed identically in T4, T6, T7; `ReviewFloorFiring` (T2) consumed in T5/T7; `markdownTarget.name === 'markdown'` registered in T4 and used in T6/T7; `ACTION_REGISTRY` four-member set asserted identically in T3 and T7; `dispatch-review` is the `action` on `REVIEW_FLOOR_NODE` (T1) and the registry key (T3).

## Dependency / scope summary (for `/build-path`)

| Item | Scope (repo · pathPrefix) | DependsOn | Gate |
|---|---|---|---|
| D5-1 | foundry · `src/governance/node` | — | — |
| D5-2 | foundry · `src/governance/observe` | D5-1 | — |
| D5-4 | foundry · `src/workflow/actions` | D5-1 | — |
| D5-5 | foundry · `src/compiler/target-markdown` | D5-1 | **ship (founder)** |
| D5-3 | foundry/twin · `src/inference/review-floor-calibration` | D5-2 | — |
| D5-6 | studio · `apps/studio-ui/src/app/governance` | D5-1,2,3 | — |
| D5-7 | foundry · `src/governance/wedge` | D5-1,2,4,5 | — |

After D5-1 lands, D5-2 / D5-4 / D5-5 are a parallel frontier (disjoint paths); D5-3 follows D5-2; D5-6 follows D5-1/2/3; D5-7 is last.
