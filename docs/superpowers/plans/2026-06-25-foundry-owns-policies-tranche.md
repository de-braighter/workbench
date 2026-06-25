# Foundry Owns the Policies — Tranche 1 (D5.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **This plan is the input to the foundry `/build-path`** — each Task maps 1:1 to a foundry work item (G1/G2/G3).

**Goal:** Generalize the D5 R3-generate ownership to the 4 remaining policy files (`coding.md`, `testing.md`, `docs.md`, `voice.md`) so the foundry owns all of `policies/`.

**Architecture:** Two behavior-preserving extensions to the merged D5 governance engine — `governanceFields` accepts any non-empty `governanceKind` (not just `'guardrail'`), and a new `governanceFragmentsByFile(blueprint)` groups governance nodes by their `sourceArtifact` file so multiple files can be generated in one pass. Four new `governanceKind: 'policy'` nodes (one per file, `authoredContent` = current file body) make the policies foundry-owned; a founder-gated workbench capstone sentinel-wraps the live files (content-preserving); the Studio cockpit lists all owned artifacts.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), vitest, event-sourced foundry, Angular 21 signals-first (Studio), `@de-braighter/design-system-css` tokens.

## Global Constraints

- **Read the MERGED D5 code, NOT this plan's illustrative signatures** (the recurring drift lesson — every D5 worker hit it). Before writing, read `domains/foundry/src/governance/node.ts`, `src/compiler/target-markdown.ts`, `src/compiler/registry.ts`, `src/compiler/__fixtures__/review-floor.md`, and the D5 tests (`test/target-markdown.spec.ts`, `src/governance/wedge.integration.spec.ts`). Match the real exports.
- **Behavior-preserving for D5.** A single-node review-floor blueprint must still produce the identical string `markdownTarget.compile` produces today (the D5 tests + the drift tripwire must stay green). Generalize by *adding* `governanceFragmentsByFile` and deriving the string from it — do not change the existing string output for the single-file case.
- **Zero kernel change** (ADR-176 pack-level). `governanceKind: 'policy'` is a metadata string value; the generate generalization is pack code. If a primitive forces a kernel touch, STOP → `AUTONOMY(1)`.
- **Non-destructive (G2).** The capstone changes NO policy text — it only sentinel-wraps existing bodies; the generated fragment must equal the current file body verbatim.
- **G2 is FOUNDER-GATED** — it rewrites the workbench's own instruction files. Open the workbench PR; do not merge without the founder's go (the orchestrator handles it under the "generalize the ownership" directive).
- **Per-repo CI:** foundry → `NX_DAEMON=false npm run ci:local`; studio → `pnpm -r run build` + the studio-ui vitest + a mandatory `ng serve` browser-verify.
- **Product home:** `system-builder-studio`, keys `G1`/`G2`/`G3`.

---

## File Structure

**`domains/foundry`:**
- Modify `src/governance/node.ts` — generalize `governanceFields`; add `POLICY_NODES` (4 nodes) (Task G1).
- Create `src/governance/policies.ts` — the 4 policy node specs with verbatim bodies (Task G1) [keeps `node.ts` focused].
- Modify `src/compiler/target-markdown.ts` — add `governanceFragmentsByFile`; derive `compile` from it (Task G1).
- Create `src/compiler/__fixtures__/policy-{coding,testing,docs,voice}.md` (Task G1).
- Modify the D5 specs (`test/target-markdown.spec.ts`, `src/governance/wedge.integration.spec.ts`) — extend for multi-file + any-kind (Task G1).

**`de-braighter/workbench`:**
- Modify `policies/{coding,testing,docs,voice}.md` — sentinel-wrap bodies (Task G2).

**`domains/studio/apps/studio-ui`:**
- Modify `src/app/governance/governance-read.port.ts` + `governance-view-model.ts` + `governance.page.ts` — list multiple governance nodes (Task G3).

---

## Task G1: Generalize the engine + author the 4 policy nodes (foundry)

**Files:**
- Modify: `domains/foundry/src/governance/node.ts`
- Create: `domains/foundry/src/governance/policies.ts`
- Modify: `domains/foundry/src/compiler/target-markdown.ts`
- Create: `domains/foundry/src/compiler/__fixtures__/policy-{coding,testing,docs,voice}.md`
- Test: `domains/foundry/src/governance/policies.spec.ts`, extend `test/target-markdown.spec.ts`

**Scope:** `domains/foundry`, pathPrefix `src/governance` + `src/compiler`. **DependsOn:** none. **Quality:** wave-standard.

**Interfaces:**
- Produces:
  - `governanceFields(node)` returns fields for ANY node whose `metadata.governanceKind` is a non-empty string (returns the actual kind, not hardcoded `'guardrail'`); still `null` when absent/empty.
  - `POLICY_NODES: CascadeNodeSpec[]` — 4 nodes, `governanceKind: 'policy'`, `sourceArtifact: 'policies/<name>.md'`, `authoredContent: { title, body }` where `body` is the **verbatim current body** of each policy file.
  - `governanceFragmentsByFile(blueprint): Record<string, string>` — groups governance nodes by `sourceArtifact` with any `#anchor` stripped (`'policies/git.md#review-floor'` → `'policies/git.md'`); each value is the sentinel-wrapped fragment for that file. `markdownTarget.compile` derives its string output from this (join the values), so the single-file case is unchanged.

- [ ] **Step 1: Read the merged D5 code.** Read `node.ts` (`governanceFields`, `GovernanceFields`, `REVIEW_FLOOR_NODE`, the `governanceKind` check), `target-markdown.ts` (`markdownTarget`, `governanceFragment`, how it walks `blueprint.process.nodes`), and the D5 specs. Note the exact `GovernanceKind` type and the `governanceFields` null-guard.

- [ ] **Step 2: Write the failing test** — `src/governance/policies.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildCascadeTree } from '../plan/cascade.js';
import { governanceFields } from './node.js';
import { POLICY_NODES } from './policies.js';

describe('policy governance nodes (G1)', () => {
  it('models all 4 remaining policy files as policy-kind governance nodes', () => {
    const arts = POLICY_NODES.map((n) => String(n.meta?.['sourceArtifact']));
    expect(arts.sort()).toEqual(
      ['policies/coding.md', 'policies/docs.md', 'policies/testing.md', 'policies/voice.md'].sort(),
    );
  });

  it('governanceFields recognizes the policy kind (generalized beyond guardrail)', () => {
    const tree = buildCascadeTree([POLICY_NODES[0]]);
    const f = governanceFields(tree[0]);
    expect(f).not.toBeNull();
    expect(f!.governanceKind).toBe('policy');
    expect(f!.authoredContent.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run red** — `cd domains/foundry && NX_DAEMON=false npx vitest run src/governance/policies.spec.ts` → FAIL (module/kind not found).

- [ ] **Step 4: Generalize `governanceFields`** in `node.ts`. Change the guard from `if (m['governanceKind'] !== 'guardrail') return null;` to accept any non-empty string, and return the actual kind:

```typescript
export type GovernanceKind = 'guardrail' | 'policy';
// ...
export function governanceFields(node: PlanNode): GovernanceFields | null {
  const m = node.metadata as Record<string, unknown>;
  const kind = m['governanceKind'];
  if (typeof kind !== 'string' || kind === '') return null;
  const ac = m['authoredContent'] as { title?: unknown; body?: unknown } | undefined;
  return {
    governanceKind: kind as GovernanceKind,
    sourceArtifact: String(m['sourceArtifact'] ?? ''),
    action: String(m['action'] ?? ''),
    authoredContent: { title: String(ac?.title ?? ''), body: String(ac?.body ?? '') },
  };
}
```

- [ ] **Step 5: Author the 4 policy nodes** — `src/governance/policies.ts`. Read each workbench policy file (`D:/development/projects/de-braighter/policies/{coding,testing,docs,voice}.md`), and capture each file's **body verbatim** (everything BELOW the frontmatter `---...---` and the `# Title` line) into `authoredContent.body`; `title` = the `# Title` text. Shape (one per file):

```typescript
import type { CascadeNodeSpec } from '../plan/cascade.js';

const CODING_BODY = `…verbatim body of policies/coding.md (below frontmatter + # title)…`;

const codingNode: CascadeNodeSpec = {
  key: 'policy-coding',
  kind: 'governance',
  parent: null,
  meta: {
    title: 'Coding standards',
    governanceKind: 'policy',
    sourceArtifact: 'policies/coding.md',
    authoredContent: { title: 'Coding standards', body: CODING_BODY },
  },
};
// …testingNode, docsNode, voiceNode the same way…
export const POLICY_NODES: CascadeNodeSpec[] = [codingNode, testingNode, docsNode, voiceNode];
```

> Capture bodies EXACTLY (whitespace, blank lines, list markers) — G2's non-destructive proof depends on `authoredContent.body` equalling the file's current body byte-for-byte.

- [ ] **Step 6: Run green** — `NX_DAEMON=false npx vitest run src/governance/policies.spec.ts` → PASS.

- [ ] **Step 7: Add `governanceFragmentsByFile` + derive `compile`** in `target-markdown.ts`.

```typescript
function fileOf(sourceArtifact: string): string {
  return sourceArtifact.split('#')[0]; // strip the optional #anchor → the target FILE
}

export function governanceFragmentsByFile(blueprint: ProductBlueprint): Record<string, string> {
  const out: Record<string, string> = {};
  for (const node of blueprint.process.nodes) {           // confirm: process is a PlanTree (.nodes)
    const f = governanceFields(node);
    if (f == null) continue;
    const key = String((node.metadata as Record<string, unknown>)['_cascadeKey'] ?? 'governance');
    const file = fileOf(f.sourceArtifact);
    out[file] = (out[file] ? out[file] + '\n\n' : '') + governanceFragment(key, f.authoredContent.title, f.authoredContent.body);
  }
  return out;
}

export const markdownTarget: CompileTarget<string> = {
  name: 'markdown',
  compile(blueprint: ProductBlueprint): string {
    return Object.values(governanceFragmentsByFile(blueprint)).join('\n\n'); // derive: single-file unchanged
  },
};
```

> Adapt to the REAL `blueprint.process` shape + the real `governanceFragment` signature you read in Step 1. Verify the existing D5 `target-markdown.spec.ts` + the review-floor fixture still pass unchanged (single-node → identical string).

- [ ] **Step 8: Write the multi-file + fixture tests** — extend `test/target-markdown.spec.ts`:

```typescript
import { governanceFragmentsByFile } from '../src/compiler/target-markdown.js';
import { POLICY_NODES } from '../src/governance/policies.js';
import { REVIEW_FLOOR_NODE } from '../src/governance/node.js';
import { buildCascadeTree } from '../src/plan/cascade.js';

it('groups governance nodes by their sourceArtifact FILE (multi-file, mixed kinds)', () => {
  const tree = buildCascadeTree([REVIEW_FLOOR_NODE, ...POLICY_NODES]);
  const byFile = governanceFragmentsByFile({ productKey: 'gov', process: tree, done: [] } as any);
  expect(Object.keys(byFile).sort()).toEqual(
    ['policies/coding.md', 'policies/docs.md', 'policies/git.md', 'policies/testing.md', 'policies/voice.md'].sort(),
  );
  expect(byFile['policies/coding.md']).toContain('governance:policy-coding:start');
  expect(byFile['policies/git.md']).toContain('governance:review-floor:start'); // guardrail still works
});
```

Then commit each policy fragment as a fixture `src/compiler/__fixtures__/policy-{coding,testing,docs,voice}.md` (the `governanceFragmentsByFile` output per file) and add a per-file drift-tripwire assertion (fixture equals the generated fragment), mirroring the D5 review-floor tripwire.

- [ ] **Step 9: Extend the genericity acid** in `src/governance/wedge.integration.spec.ts` — assert the engine generates BOTH a `policy`-kind node (whole file) AND the `guardrail`-kind review-floor (region) in one pass to distinct files, and that re-narrowing `governanceFields` to `=== 'guardrail'` would drop the policy files (mutation check: temporarily narrow → the policy-file keys vanish → RED).

- [ ] **Step 10: Gate + commit** — `NX_DAEMON=false npm run ci:local` green.

```bash
git add domains/foundry/src/governance domains/foundry/src/compiler domains/foundry/test
git commit -m "feat(foundry): generalize governance engine to any kind + own the 4 policies (G1)"
```

---

## Task G2: Capstone — own the 4 policy files (workbench)  ⚠ FOUNDER-GATED

**Files:**
- Modify: `policies/coding.md`, `policies/testing.md`, `policies/docs.md`, `policies/voice.md` (in `de-braighter/workbench`)

**Scope:** `de-braighter/workbench`, pathPrefix `policies`. **DependsOn:** G1. **Quality:** wave-standard + **founder-ship-gate**.

**Interfaces:**
- Consumes: the committed fixtures `domains/foundry/src/compiler/__fixtures__/policy-*.md` (the generated regions, from G1).

- [ ] **Step 1: For each of the 4 policy files**, sentinel-wrap the file BODY (everything below the frontmatter + `# Title`) so it becomes a foundry-owned region. The wrapped content MUST equal the file's current body verbatim (non-destructive). Pattern (e.g. `policies/coding.md`):

```markdown
---
title: Coding standards
last_updated: …
---

# Coding standards

<!-- governance:policy-coding:start -->
…the existing body, UNCHANGED…
<!-- governance:policy-coding:end -->

> ⚙️ The region above is **generated by the foundry** from the `policy-coding` governance node (the markdown `CompileTarget`). Edit the node's `authoredContent` via the Studio `/governance` cockpit, not this file; the drift tripwire (`domains/foundry/src/compiler/__fixtures__/policy-coding.md`) pins the foundry output. Part of the Unified Cockpit D5.2 policy-ownership tranche (design: `docs/superpowers/specs/2026-06-25-foundry-owns-policies-tranche-design.md`).
```

- [ ] **Step 2: Verify non-destructive** — `git diff` must show ONLY added sentinel comments + the note (zero changes to the policy prose). Confirm each wrapped body byte-matches the `policy-<name>` fixture's inner content.

- [ ] **Step 3: Commit + open the FOUNDER-GATED PR** (do NOT self-merge):

```bash
git add policies/coding.md policies/testing.md policies/docs.md policies/voice.md
git commit -m "docs(policy): foundry owns coding/testing/docs/voice policies (D5.2 capstone)"
```
Open the workbench PR; the orchestrator lands it under the founder's standing authorization after a `/code-review` pass.

---

## Task G3: Cockpit — list all owned governance artifacts (studio)

**Files:**
- Modify: `domains/studio/apps/studio-ui/src/app/governance/governance-read.port.ts`
- Modify: `domains/studio/apps/studio-ui/src/app/governance/governance-view-model.ts`
- Modify: `domains/studio/apps/studio-ui/src/app/governance/governance.page.ts`
- Test: `domains/studio/apps/studio-ui/src/app/governance/governance.page.spec.ts`

**Scope:** `domains/studio`, pathPrefix `apps/studio-ui/src/app/governance`. **DependsOn:** G1. **Quality:** wave-standard + a11y-battery + browser-verify.

**Interfaces:**
- Consumes: the merged D5-6 `GovernanceSnapshot`/`GOVERNANCE_READ_PORT`/`buildGovernanceViewModel` (read them first).
- Produces: a `GovernanceSnapshot` that carries a **list** of governance artifacts (each `{ title, sourceArtifact, governanceKind }`), with the review-floor's firings/calibration retained as the one node that has them; policy rows show ownership + source only.

- [ ] **Step 1: Read the merged D5-6 surface** (`governance.page.ts`, `governance-view-model.ts`, `governance-read.port.ts`) for the real shapes + conventions.

- [ ] **Step 2: Write the failing view-model test** — extend `governance.page.spec.ts`:

```typescript
import { buildGovernanceViewModel } from './governance-view-model.js';

it('lists all owned governance artifacts (policies + the review-floor guardrail)', () => {
  const vm = buildGovernanceViewModel({
    artifacts: [
      { title: 'Review floor', sourceArtifact: 'policies/git.md#review-floor', governanceKind: 'guardrail' },
      { title: 'Coding standards', sourceArtifact: 'policies/coding.md', governanceKind: 'policy' },
      { title: 'Testing discipline', sourceArtifact: 'policies/testing.md', governanceKind: 'policy' },
    ],
    firings: [{ prRef: 'r#1', satisfied: true }],
    calibration: { satisfiedRate: 1, findingsWhenSatisfied: 0, findingsWhenViolated: 0 },
  } as any);
  expect(vm.artifacts).toHaveLength(3);
  expect(vm.artifacts.filter((a) => a.governanceKind === 'policy')).toHaveLength(2);
  expect(vm.ownedCount).toBe(3);
});
```

> Adapt to the real `GovernanceSnapshot` shape — extend it with an `artifacts[]` list (back-compat: the existing single `node` becomes the first/guardrail artifact). Match the merged field names.

- [ ] **Step 3: Run red**, then extend the port (default in-memory snapshot now carries `artifacts[]` = the 4 policies + review-floor), the view-model (`artifacts` rows + `ownedCount`), and the page (render a table of owned artifacts: title · sourceArtifact · kind · regenerate **stub** per row; the review-floor row keeps its firings/calibration detail). Run green.

- [ ] **Step 4: Gate + browser-verify** — `cd apps/studio-ui && NX_DAEMON=false npm run build` + the governance vitest; then `ng serve`, navigate `/governance`, screenshot. Confirm the artifact list RENDERS under the canonical `[data-theme]`/`data-skin` tokens (the token-divergence trap). Wave (reviewer + qa + charter + a11y-pro, foreground, read return-values). Fix blocking, re-verify.

- [ ] **Step 5: Commit**

```bash
git add domains/studio/apps/studio-ui/src/app/governance
git commit -m "feat(studio): cockpit lists all owned governance artifacts (G3)"
```

---

## Self-Review

**Spec coverage:** §2 generalization (governanceFields any-kind + group-by-file) → G1 Steps 4/7; §3 G1 (engine + 4 nodes) → Task G1; §3 G2 (capstone) → Task G2; §3 G3 (cockpit list) → Task G3; §5 acids (genericity, round-trip, multi-file) → G1 Steps 8/9. All spec sections map to a task.

**Placeholder scan:** the `CODING_BODY = \`…verbatim body…\`` placeholder is an explicit instruction to capture real content (Step 5 says read the file + embed verbatim) — not a TODO; flagged because the body is too long to inline and MUST be the live file content. No other placeholders.

**Type consistency:** `governanceFields`/`GovernanceFields`/`governanceKind` consistent across G1; `governanceFragmentsByFile(blueprint): Record<string,string>` consumed by G2's fixtures; `GovernanceSnapshot.artifacts[]` consistent across G3 steps; `POLICY_NODES` defined in G1 Step 5, asserted in G1 Step 2/8.

## Dependency / scope summary (for `/build-path`)

| Item | Scope (repo · pathPrefix) | DependsOn | Gate |
|---|---|---|---|
| G1 | foundry · `src/governance` + `src/compiler` | — | — |
| G2 | workbench · `policies` | G1 | **ship (founder)** |
| G3 | studio · `apps/studio-ui/src/app/governance` | G1 | — |

After G1 lands, G2 + G3 are a parallel disjoint frontier (different repos).
