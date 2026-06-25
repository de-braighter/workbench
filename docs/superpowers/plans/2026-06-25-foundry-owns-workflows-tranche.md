# Foundry Owns the Workflows — Tranche 2 (D5.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **This plan is the input to the foundry `/build-path`** — each Task maps 1:1 to a foundry work item (W1/W2/W3).

**Goal:** Extend foundry R3-generate ownership to the 3 workflow files (`verifier-wave.md`, `designer-first.md`, `story-tracker.md`).

**Architecture:** Add `governanceKind: 'workflow'` + tighten the heading gate to `kind === 'guardrail'` (so all whole-file kinds are body-only), author 3 workflow nodes, sentinel-wrap the files (founder-gated), extend the cockpit list. Reuses the D5/D5.2 engine; zero kernel change.

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest, Angular 21 signals (Studio).

## Global Constraints

- **Read the MERGED D5.2 code first** (`domains/foundry/src/governance/node.ts`, `src/governance/policies.ts`, `src/compiler/target-markdown.ts` — esp. `governanceFragmentsByFile` + the `headed` param from foundry#47, and the `__fixtures__/policy-*.md`). Match real exports; the plan's signatures are illustrative.
- **Behavior-preserving:** the D5 review-floor fixture + the 4 D5.2 policy fixtures + all their tests stay byte-identical (the heading-gate change `kind !== 'policy'` → `kind === 'guardrail'` is equivalent for guardrail+policy and only adds correct body-only handling for the new workflow kind — verify).
- **Zero kernel change** (ADR-176 pack-level). **W2 is FOUNDER-GATED** (rewrites workbench instruction files). **Non-destructive:** W2 adds only sentinels + note, no prose/heading edits.
- **Per-repo CI:** foundry → `NX_DAEMON=false npm run ci:local`; studio → `pnpm -r run build` + governance vitest + `ng serve` browser-verify.
- **Product home:** `system-builder-studio`, keys `W1`/`W2`/`W3`.

---

## Task W1: Engine kind + 3 workflow nodes (foundry)

**Files:** Modify `src/governance/node.ts` (add `'workflow'` to `GovernanceKind`); Modify `src/compiler/target-markdown.ts` (heading gate → `kind === 'guardrail'`); Create `src/governance/workflows.ts` (`WORKFLOW_NODES`); Create `src/compiler/__fixtures__/workflow-*.md`; Modify `src/governance/policies.spec.ts`/`test/target-markdown.spec.ts`/`src/governance/wedge.integration.spec.ts`.

**Scope:** `domains/foundry`, pathPrefix `src/governance`. **DependsOn:** none. **Quality:** wave-standard.

**Interfaces:** Produces `WORKFLOW_NODES: CascadeNodeSpec[]` (3 nodes, `governanceKind: 'workflow'`, `sourceArtifact: 'workflows/<name>.md'`, `authoredContent.body` = verbatim file body); the heading gate now `headed: governanceFields(node).governanceKind === 'guardrail'`.

- [ ] **Step 1: Read the merged D5.2 code** (node.ts, policies.ts, target-markdown.ts incl. the `headed` param + `governanceFragmentsByFile`, the policy fixtures). Find where `headed: kind !== 'policy'` is set.

- [ ] **Step 2: Write the failing test** — `src/governance/workflows.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCascadeTree } from '../plan/cascade.js';
import { governanceFields } from './node.js';
import { WORKFLOW_NODES } from './workflows.js';

describe('workflow governance nodes (W1)', () => {
  it('models the 3 workflow files as workflow-kind nodes', () => {
    const arts = WORKFLOW_NODES.map((n) => String(n.meta?.['sourceArtifact'])).sort();
    expect(arts).toEqual(['workflows/designer-first.md', 'workflows/story-tracker.md', 'workflows/verifier-wave.md']);
  });
  it('governanceFields recognizes the workflow kind', () => {
    const tree = buildCascadeTree([WORKFLOW_NODES[0]]);
    const f = governanceFields(tree[0]);
    expect(f?.governanceKind).toBe('workflow');
    expect(f!.authoredContent.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run red** — `cd domains/foundry && NX_DAEMON=false npx vitest run src/governance/workflows.spec.ts`.

- [ ] **Step 4: Add `'workflow'`** to the `GovernanceKind` union in `node.ts`. Change the heading gate in `target-markdown.ts` from `headed: <kind> !== 'policy'` to `headed: <kind> === 'guardrail'` (so policy + workflow are both body-only; guardrail stays headed).

- [ ] **Step 5: Author `src/governance/workflows.ts`** — `WORKFLOW_NODES`: 3 nodes mirroring `policies.ts`. READ the live files `D:/development/projects/de-braighter/workflows/{verifier-wave,designer-first,story-tracker}.md`, capture each body (everything BELOW the frontmatter + `# Title` line) VERBATIM byte-for-byte into `authoredContent.body`; `title` = the `# Title` text; `key` = `workflow-<name>`; `governanceKind: 'workflow'`; `sourceArtifact: 'workflows/<name>.md'`.

- [ ] **Step 6: Run green**, then add per-file fixtures `src/compiler/__fixtures__/workflow-{verifier-wave,designer-first,story-tracker}.md` (body-only output) + drift tripwires; extend `test/target-markdown.spec.ts` for the 3 workflow files in `governanceFragmentsByFile`; extend the genericity acid (`wedge.integration.spec.ts`) to assert guardrail=headed + policy/workflow=body-only in one multi-file pass (mutation flipping the gate is RED). **Verify the review-floor + 4 policy fixtures are byte-unchanged.**

- [ ] **Step 7: Gate + commit** — `NX_DAEMON=false npm run ci:local` green (D5 + D5.2 tests stay green).

```bash
git add domains/foundry/src/governance domains/foundry/src/compiler domains/foundry/test
git commit -m "feat(foundry): own the 3 workflows + generalize heading gate to guardrail-only (W1)"
```

---

## Task W2: Capstone — own the 3 workflow files (workbench)  ⚠ FOUNDER-GATED

**Files:** Modify `workflows/verifier-wave.md`, `workflows/designer-first.md`, `workflows/story-tracker.md` (in `de-braighter/workbench`).

**Scope:** `de-braighter/workbench`, pathPrefix `workflows`. **DependsOn:** W1. **Quality:** wave-standard + founder-ship-gate.

- [ ] **Step 1: For each workflow file**, sentinel-wrap the BODY (everything BELOW the frontmatter + `# Title` line, keeping the `# Title` h1 UNTOUCHED above the region) with `<!-- governance:workflow-<name>:start -->` … `<!-- governance:workflow-<name>:end -->`, then the note after the end sentinel (mirror the D5.2 `policies/coding.md` note: cite the `workflow-<name>` node + `domains/foundry/src/compiler/__fixtures__/workflow-<name>.md` + the design `docs/superpowers/specs/2026-06-25-foundry-owns-workflows-tranche-design.md`). The wrapped body MUST equal the file's current body verbatim.

- [ ] **Step 2: Verify non-destructive** — `git diff` shows ONLY added sentinels + note (zero prose/heading edits; `# Title` untouched). Cross-check each region byte-equals its W1 fixture.

- [ ] **Step 3: Commit + open the FOUNDER-GATED PR** (do NOT self-merge):

```bash
git add workflows/verifier-wave.md workflows/designer-first.md workflows/story-tracker.md
git commit -m "docs(workflow): foundry owns verifier-wave/designer-first/story-tracker (D5.3 capstone)"
```
Open the workbench PR; the orchestrator lands it under the founder's directive after a `/code-review` pass.

---

## Task W3: Cockpit lists the workflows too (studio)

**Files:** Modify `apps/studio-ui/src/app/governance/governance-read.port.ts` (+ the view-model/page if needed); Test: `governance.page.spec.ts`.

**Scope:** `domains/studio`, pathPrefix `apps/studio-ui/src/app/governance`. **DependsOn:** W1. **Quality:** wave-standard + a11y-battery + browser-verify.

- [ ] **Step 1: Read the merged G3 surface** (`governance-read.port.ts` `GovernanceSnapshot.artifacts[]`, `buildGovernanceViewModel`, the page table). The list is generic; this task only extends the default fixture.

- [ ] **Step 2: Write the failing test** — extend `governance.page.spec.ts`:

```typescript
it('lists the 3 workflows alongside the policies + review-floor (8 owned artifacts)', () => {
  const vm = buildGovernanceViewModel(/* the default snapshot from the port */ defaultGovernanceSnapshot());
  expect(vm.ownedCount).toBe(8);
  expect(vm.artifacts.filter((a) => a.governanceKind === 'workflow')).toHaveLength(3);
});
```

> If the port's default snapshot isn't exported as a helper, assert via the port's `snapshot()` directly. Match the real shape.

- [ ] **Step 3: Run red**, then add the 3 workflow artifacts (`{ title, sourceArtifact: 'workflows/<name>.md', governanceKind: 'workflow' }`) to the port's default in-memory snapshot. The view-model + page render them generically (a `workflow` kind chip; regenerate stub per row). Run green.

- [ ] **Step 4: Gate + browser-verify** — `cd apps/studio-ui && NX_DAEMON=false npm run build` + governance vitest; `ng serve`, navigate `/governance`, screenshot — confirm the 8-row table renders under the canonical tokens (not blank). Wave (reviewer + qa + charter + a11y-pro, foreground, read return-values). Fix blocking, re-verify.

- [ ] **Step 5: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/governance
git commit -m "feat(studio): cockpit lists the 3 owned workflows (W3)"
```

---

## Self-Review

**Spec coverage:** §2 engine (workflow kind + heading-gate generalization) → W1 Step 4; §3 W1/W2/W3 → Tasks W1/W2/W3; §5 acids (3-kind genericity, regression, round-trip) → W1 Step 6. All mapped.

**Placeholder scan:** the verbatim-body capture (W1 Step 5) is an explicit read-the-live-file instruction, not a TODO. No other placeholders.

**Type consistency:** `WORKFLOW_NODES` (W1) · `governanceKind: 'workflow'` consistent across W1/W3 · `headed: kind === 'guardrail'` (W1) · `GovernanceSnapshot.artifacts[]` reused from G3 (W3).

## Dependency / scope summary (for `/build-path`)

| Item | Scope (repo · pathPrefix) | DependsOn | Gate |
|---|---|---|---|
| W1 | foundry · `src/governance` + `src/compiler` | — | — |
| W2 | workbench · `workflows` | W1 | **ship (founder)** |
| W3 | studio · `apps/studio-ui/src/app/governance` | W1 | — |

After W1 lands, W2 + W3 are a parallel disjoint frontier.
