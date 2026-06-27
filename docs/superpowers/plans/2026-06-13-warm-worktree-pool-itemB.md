# Warm Worktree Pool (Item B / spec §C.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **TDD is mandatory for the foundry module (Part A).**

**Goal:** Ship the warm worktree pool — a per-repo pool of warm git worktrees at `<repo>/.claude/wt-pool/slot-<i>` with `node_modules` populated, reset-on-lease to a pristine tree — amortizing the brutal cold install (pnpm isolated-store linking + Windows MAX_PATH + `prisma generate` + postinstalls) that dominates per-item cost. **Throughput only; correctness never depends on it** — a lease failure falls back to a cold `git worktree add`.

**Architecture:** Two PRs. **Part A (`domains/foundry`, TDD + verifier wave):** a `wt-pool` module modeled on `store-lock.ts` — pure, individually-testable functions (`poolPaths`, `resetPlan`, `nextFreeSlot`) + side-effectful executors (`ensureSlot`, `resetSlot`, `leaseSlot`) that take an injected `run` so the integration test drives **real git against a temp repo** while stubbing `pnpm install`. The load-bearing risk surface — `git clean -fdx -e node_modules -e .npmrc` + `reset --hard` preserving `node_modules` on a pristine tree — gets a real-git integration test. A thin `wt-pool-cli.ts` (the side-effectful boot, excluded from coverage like `server.ts`) the worker invokes. **Part B (`workbench`, skill wiring):** `foundry-worker` Phase-2 ISOLATE gains a "lease a warm slot, else cold worktree-add" branch; `foundry-conduct` / `foundry-superconduct` note the pool.

**Tech Stack:** TypeScript (ESM, `.js` import extensions, `noUncheckedIndexedAccess`), vitest (`test/*.test.ts`, `mkdtempSync` temp dirs), `node:child_process` for the real-git integration test, `tsx` for the CLI. Markdown skill authoring for Part B.

---

## Part A — `domains/foundry`: the wt-pool module (TDD)

### Why this shape (the load-bearing constraints)

- **`store-lock.ts` is the template:** isolate the OS-level concern into pure functions + exported risky sub-steps, each with its own test, driven against `mkdtempSync` temp dirs. ESM imports use explicit `.js` extensions. Tests live in `test/*.test.ts` (not `src/`); `tsconfig` `include: ["src"]` so tests are vitest-typechecked, not tsc-built.
- **Correctness never depends on the pool** → every executor may `throw` on any anomaly; the caller (the worker, Part B) catches and cold-adds. So the module needs no recovery cleverness — just fail loud.
- **The reset-on-lease is the one risk surface** (§C.4 "must be the most-tested code"): a wrong `clean` flag silently corrupts every later build. So `resetPlan` is pure data (asserted exactly) AND `resetSlot` gets a real-git integration test proving `node_modules` survives.
- **`run` is injected** so the integration test executes real `git` but stubs `pnpm install` (no remote-store / no pnpm needed to verify the git reset).
- **Coverage:** `vitest.config.ts` covers `src/**/*.ts` minus `src/mcp/server.ts`. Add `src/wt-pool-cli.ts` to that exclude (it's the side-effectful boot, like `server.ts`); `src/wt-pool.ts` IS covered.

### File Structure (Part A)

- **Create** `domains/foundry/src/wt-pool.ts` — the module (pure fns + injected-`run` executors).
- **Create** `domains/foundry/src/wt-pool-cli.ts` — thin CLI (`lease <repoRoot> <branch>` → prints the slot path); excluded from coverage.
- **Create** `domains/foundry/test/wt-pool.test.ts` — unit tests (pure fns) + the real-git integration test (the risk surface).
- **Modify** `domains/foundry/vitest.config.ts` — add `src/wt-pool-cli.ts` to the coverage exclude.
- **Modify** `domains/foundry/package.json` — add a `"wt-pool": "tsx src/wt-pool-cli.ts"` script; amend the `description` to name the conductor worktree-pool tooling (it currently says "Arbitration + queue + gates, nothing else").

### Task A1: `resetPlan` — the reset sequence as data (pure, TDD)

**Files:** Create `src/wt-pool.ts`; Test `test/wt-pool.test.ts`

- [ ] **Step 1: Write the failing test** (`test/wt-pool.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { resetPlan } from '../src/wt-pool.js';

describe('resetPlan', () => {
  it('emits the exact node_modules-preserving reset sequence', () => {
    const steps = resetPlan('/slot', 'feat/x', 'origin/main');
    expect(steps.map((s) => `${s.cmd} ${s.args.join(' ')}`)).toEqual([
      'git fetch origin main',
      'git checkout -B feat/x origin/main',
      'git clean -fdx -e node_modules -e .npmrc',
      'git reset --hard origin/main',
      'pnpm install --frozen-lockfile',
    ]);
    // every step runs in the slot dir
    expect(steps.every((s) => s.cwd === '/slot')).toBe(true);
  });
  it('defaults baseRef to origin/main', () => {
    expect(resetPlan('/s', 'feat/y').some((s) => s.args.includes('origin/main'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run test/wt-pool.test.ts` → "resetPlan is not a function").

- [ ] **Step 3: Implement `resetPlan`** in `src/wt-pool.ts`

```ts
export interface ResetStep { cmd: string; args: string[]; cwd: string }

/** The reset-on-lease sequence as inspectable data (§C.4). The `-e node_modules
 *  -e .npmrc` excludes on `clean -fdx` are load-bearing: they preserve the warm
 *  install + the Windows MAX_PATH .npmrc while wiping every other untracked file,
 *  so the tree is pristine but the expensive node_modules survives. */
export function resetPlan(slotPath: string, branch: string, baseRef = 'origin/main'): ResetStep[] {
  const at = (cmd: string, ...args: string[]): ResetStep => ({ cmd, args, cwd: slotPath });
  return [
    at('git', 'fetch', 'origin', 'main'),
    at('git', 'checkout', '-B', branch, baseRef),
    at('git', 'clean', '-fdx', '-e', 'node_modules', '-e', '.npmrc'),
    at('git', 'reset', '--hard', baseRef),
    at('pnpm', 'install', '--frozen-lockfile'),
  ];
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/wt-pool.ts test/wt-pool.test.ts
git commit -m "feat(wt-pool): resetPlan — the node_modules-preserving reset sequence as data"
```

### Task A2: `poolPaths` + `nextFreeSlot` (pure, TDD)

**Files:** Modify `src/wt-pool.ts`; Modify `test/wt-pool.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { poolPaths, nextFreeSlot } from '../src/wt-pool.js';
import { join } from 'node:path';

describe('poolPaths', () => {
  it('computes the pool dir + slot paths under <repoRoot>/.claude/wt-pool', () => {
    const p = poolPaths('/repo');
    expect(p.poolDir).toBe(join('/repo', '.claude', 'wt-pool'));
    expect(p.slotPath(2)).toBe(join('/repo', '.claude', 'wt-pool', 'slot-2'));
  });
});
describe('nextFreeSlot', () => {
  it('returns the lowest free index within the pool', () => {
    expect(nextFreeSlot(new Set([0, 1]), 4)).toBe(2);
  });
  it('returns null when the pool is full', () => {
    expect(nextFreeSlot(new Set([0, 1, 2, 3]), 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { join } from 'node:path';

export interface PoolPaths { repoRoot: string; poolDir: string; slotPath: (i: number) => string }

export function poolPaths(repoRoot: string): PoolPaths {
  const poolDir = join(repoRoot, '.claude', 'wt-pool');
  return { repoRoot, poolDir, slotPath: (i) => join(poolDir, `slot-${i}`) };
}

/** Lowest free slot index, or null if the pool (size `poolSize`) is full.
 *  Single-coordinator lease: assigning a slot to each fanned-out worker IS the
 *  lease (§C.4); a multi-coordinator per-slot lease is the slice-3 follow-up. */
export function nextFreeSlot(leased: ReadonlySet<number>, poolSize: number): number | null {
  for (let i = 0; i < poolSize; i++) if (!leased.has(i)) return i;
  return null;
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/wt-pool.ts test/wt-pool.test.ts
git commit -m "feat(wt-pool): poolPaths + nextFreeSlot (slot addressing + single-coordinator lease)"
```

### Task A3: `runReset` — execute the plan, throw on any failed step (TDD, injected run)

**Files:** Modify `src/wt-pool.ts`; Modify `test/wt-pool.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { runReset } from '../src/wt-pool.js';
import type { RunStep } from '../src/wt-pool.js';

describe('runReset', () => {
  it('runs every plan step in order via the injected run', () => {
    const calls: string[] = [];
    const run: RunStep = (s) => { calls.push(`${s.cmd} ${s.args.join(' ')}`); return { ok: true, output: '' }; };
    runReset('/slot', 'feat/x', 'origin/main', run);
    expect(calls).toEqual([
      'git fetch origin main',
      'git checkout -B feat/x origin/main',
      'git clean -fdx -e node_modules -e .npmrc',
      'git reset --hard origin/main',
      'pnpm install --frozen-lockfile',
    ]);
  });
  it('throws on the first failing step (never proceeds with a half-reset tree)', () => {
    const run: RunStep = (s) => ({ ok: s.cmd !== 'git' || s.args[0] !== 'reset', output: 'boom' });
    expect(() => runReset('/slot', 'feat/x', 'origin/main', run)).toThrow(/reset/);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
export interface RunResult { ok: boolean; output: string }
export type RunStep = (step: ResetStep) => RunResult;

/** Execute the reset plan step-by-step; throw on the FIRST failure so a worker
 *  never builds on a half-reset tree (correctness-never-depends-on-the-pool: the
 *  caller catches + falls back to a cold worktree add). */
export function runReset(slotPath: string, branch: string, baseRef: string, run: RunStep): void {
  for (const step of resetPlan(slotPath, branch, baseRef)) {
    const r = run(step);
    if (!r.ok) throw new Error(`wt-pool reset failed at \`${step.cmd} ${step.args.join(' ')}\`: ${r.output}`);
  }
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/wt-pool.ts test/wt-pool.test.ts
git commit -m "feat(wt-pool): runReset — execute the plan, fail loud on any step"
```

### Task A4: the real-git integration test (THE risk surface) + `defaultRun`

**Files:** Modify `src/wt-pool.ts`; Modify `test/wt-pool.test.ts`

- [ ] **Step 1: Write the failing integration test** — real git, pnpm stubbed

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReset } from '../src/wt-pool.js';
import type { RunStep } from '../src/wt-pool.js';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

describe('runReset (real git — node_modules survives, tree pristine) [risk surface]', () => {
  it('preserves node_modules + .npmrc while wiping untracked junk and restoring tracked files', () => {
    const root = mkdtempSync(join(tmpdir(), 'wtpool-'));
    const upstream = join(root, 'upstream.git');
    const work = join(root, 'work');
    // bare upstream + a work clone with main
    git(root, 'init', '--bare', '-b', 'main', upstream);
    git(root, 'clone', upstream, work);
    git(work, 'config', 'user.email', 't@t'); git(work, 'config', 'user.name', 't');
    writeFileSync(join(work, 'app.ts'), 'export const x = 1;\n');
    writeFileSync(join(work, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    git(work, 'add', '.'); git(work, 'commit', '-m', 'init'); git(work, 'push', 'origin', 'main');
    // a warm slot worktree off origin/main
    const slot = join(work, '.claude', 'wt-pool', 'slot-0');
    git(work, 'worktree', 'add', slot, '-b', 'feat/seed', 'origin/main');
    // warm it: node_modules + .npmrc survive; dirty it: untracked junk + a tracked mod
    mkdirSync(join(slot, 'node_modules'), { recursive: true });
    writeFileSync(join(slot, 'node_modules', '.marker'), 'WARM');
    writeFileSync(join(slot, '.npmrc'), 'node-linker=isolated\n');
    writeFileSync(join(slot, 'untracked.txt'), 'JUNK');
    writeFileSync(join(slot, 'app.ts'), 'export const x = 999; // dirty\n');

    // real git for git steps; stub pnpm (no store / no pnpm needed to test the git reset)
    const run: RunStep = (s) => {
      if (s.cmd === 'pnpm') return { ok: true, output: 'stubbed' };
      try { return { ok: true, output: git(s.cwd, ...s.args) }; }
      catch (e) { return { ok: false, output: String((e as Error).message) }; }
    };

    runReset(slot, 'feat/new', 'origin/main', run);

    expect(readFileSync(join(slot, 'node_modules', '.marker'), 'utf8')).toBe('WARM'); // node_modules SURVIVED
    expect(existsSync(join(slot, '.npmrc'))).toBe(true);                              // .npmrc SURVIVED
    expect(existsSync(join(slot, 'untracked.txt'))).toBe(false);                      // untracked junk GONE
    expect(readFileSync(join(slot, 'app.ts'), 'utf8')).toBe('export const x = 1;\n'); // tracked file RESTORED
    expect(git(slot, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feat/new');   // on the new branch
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run → it should PASS once `runReset` (A3) is in place** (this test exercises the already-built `runReset` against real git). If it fails, the reset sequence is wrong — fix `resetPlan`, not the test. Run: `npx vitest run test/wt-pool.test.ts`.

- [ ] **Step 3: Add `defaultRun`** (the real executor the CLI uses) to `src/wt-pool.ts`

```ts
import { execFileSync } from 'node:child_process';

/** The real step executor: run the command in its cwd, capture output, never throw
 *  (runReset decides what a failure means). */
export const defaultRun: RunStep = (step) => {
  try {
    const output = execFileSync(step.cmd, step.args, { cwd: step.cwd, encoding: 'utf8' });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: err.stderr || err.stdout || err.message };
  }
};
```

- [ ] **Step 4: Commit**

```bash
git add src/wt-pool.ts test/wt-pool.test.ts
git commit -m "test(wt-pool): real-git integration — node_modules survives reset (the risk surface); defaultRun"
```

### Task A5: `ensureSlot` + `leaseSlot` (the lease entry point, TDD)

**Files:** Modify `src/wt-pool.ts`; Modify `test/wt-pool.test.ts`

- [ ] **Step 1: Write the failing integration test for `ensureSlot` + `leaseSlot`**

```ts
import { ensureSlot, leaseSlot } from '../src/wt-pool.js';

describe('leaseSlot (real git)', () => {
  it('creates a cold slot worktree on first lease, then resets it warm on the next', () => {
    const root = mkdtempSync(join(tmpdir(), 'wtlease-'));
    const upstream = join(root, 'up.git'); const work = join(root, 'work');
    git(root, 'init', '--bare', '-b', 'main', upstream);
    git(root, 'clone', upstream, work);
    git(work, 'config', 'user.email', 't@t'); git(work, 'config', 'user.name', 't');
    writeFileSync(join(work, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    git(work, 'add', '.'); git(work, 'commit', '-m', 'init'); git(work, 'push', 'origin', 'main');
    const run: RunStep = (s) => s.cmd === 'pnpm'
      ? { ok: true, output: 'stub' }
      : (() => { try { return { ok: true, output: git(s.cwd, ...s.args) }; } catch (e) { return { ok: false, output: String((e as Error).message) }; } })();

    const slot0 = leaseSlot(work, 'feat/a', 0, 'origin/main', run);  // cold-creates slot-0
    expect(existsSync(slot0)).toBe(true);
    mkdirSync(join(slot0, 'node_modules'), { recursive: true });
    writeFileSync(join(slot0, 'node_modules', '.m'), 'WARM');
    const slot0b = leaseSlot(work, 'feat/b', 0, 'origin/main', run);  // warm-resets slot-0
    expect(slot0b).toBe(slot0);
    expect(readFileSync(join(slot0, 'node_modules', '.m'), 'utf8')).toBe('WARM'); // stayed warm
    expect(git(slot0, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feat/b');
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`ensureSlot`/`leaseSlot` not defined).

- [ ] **Step 3: Implement `ensureSlot` + `leaseSlot`**

```ts
import { existsSync } from 'node:fs';

/** Idempotently ensure slot-i exists as a git worktree off baseRef (cold first
 *  fill pays one install — the caller warms it). A worktree that already exists
 *  is left for resetSlot to rebind. Throws if `git worktree add` fails (the caller
 *  falls back to a cold worktree add — correctness never depends on the pool). */
export function ensureSlot(repoRoot: string, slotIndex: number, baseRef: string, run: RunStep): string {
  const { slotPath } = poolPaths(repoRoot);
  const path = slotPath(slotIndex);
  if (existsSync(path)) return path;
  // a transient seed branch; resetSlot rebinds to the lease branch immediately after
  const seed = `wt-pool/slot-${slotIndex}-seed`;
  const r = run({ cmd: 'git', args: ['worktree', 'add', path, '-b', seed, baseRef], cwd: repoRoot });
  if (!r.ok) throw new Error(`wt-pool ensureSlot failed for slot-${slotIndex}: ${r.output}`);
  return path;
}

/** Lease slot-i for `branch`: ensure it exists, then reset-on-lease to a pristine
 *  tree (node_modules preserved). Returns the ready slot path. Throws on any
 *  failure — the caller catches and cold-adds a worktree instead. */
export function leaseSlot(repoRoot: string, branch: string, slotIndex: number, baseRef: string, run: RunStep): string {
  const path = ensureSlot(repoRoot, slotIndex, baseRef, run);
  runReset(path, branch, baseRef, run);
  return path;
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/wt-pool.ts test/wt-pool.test.ts
git commit -m "feat(wt-pool): ensureSlot + leaseSlot — cold-fill once, warm-reset on every lease"
```

### Task A6: the CLI + config/package wiring

**Files:** Create `src/wt-pool-cli.ts`; Modify `vitest.config.ts`, `package.json`

- [ ] **Step 1: Write `src/wt-pool-cli.ts`** (thin boot — excluded from coverage like `server.ts`)

```ts
// Thin CLI the foundry worker invokes to lease a warm slot. Prints the ready slot
// path on stdout (the worker cd's into it); exits non-zero on failure so the
// worker falls back to a cold `git worktree add`. Side-effectful boot — the logic
// + the risk surface live in wt-pool.ts and ARE covered.
import { leaseSlot, defaultRun } from './wt-pool.js';

const [, , cmd, repoRoot, branch, slotStr, baseRef] = process.argv;
if (cmd !== 'lease' || !repoRoot || !branch || slotStr == null) {
  console.error('usage: wt-pool lease <repoRoot> <branch> <slotIndex> [baseRef=origin/main]');
  process.exit(2);
}
try {
  const path = leaseSlot(repoRoot, branch, Number(slotStr), baseRef || 'origin/main', defaultRun);
  process.stdout.write(path);
} catch (e) {
  console.error(`wt-pool lease failed (fall back to a cold worktree add): ${(e as Error).message}`);
  process.exit(1);
}
```

- [ ] **Step 2: Add `src/wt-pool-cli.ts` to the coverage exclude** in `vitest.config.ts`

```ts
      exclude: ['src/mcp/server.ts', 'src/wt-pool-cli.ts'],
```

- [ ] **Step 3: Edit `package.json`** — add the script + amend the description

```json
  "description": "The Foundry control plane — claim-MCP server for the multi-product machine: event-sourced queue, atomic cross-session claims, founder gates, session prompts, plus the conductor's warm worktree-pool tooling (throughput-only, reset-on-lease). Arbitration + queue + gates + pool, nothing else.",
```
and under `scripts`, add: `"wt-pool": "tsx src/wt-pool-cli.ts",`

- [ ] **Step 4: Green the repo gate** — `npm run ci:local` (typecheck + test:coverage) in the worktree. All wt-pool tests pass; coverage holds (the CLI is excluded).

- [ ] **Step 5: Commit**

```bash
git add src/wt-pool-cli.ts vitest.config.ts package.json
git commit -m "feat(wt-pool): lease CLI + coverage exclude + package description (conductor pool tooling)"
```

### Task A7: PR A, verifier wave, land

- [ ] **Step 1: Push `feat/wt-pool` on `de-braighter/foundry`; open the PR** with `Producer:`/`Effort: standard`/`Effect: cycle-time 0.01±0.02 expert` + `Effect: findings` + `Refs: …design.md §C.4`. Open BEFORE the wave.
- [ ] **Step 2: Verifier wave** — `local-ci` + `reviewer` + `qa-engineer` + `charter-checker` in parallel, `isolation: 'worktree'`, read-only. `local-ci` runs the REAL `npm run ci:local` (this PR has actual tests). The wave checks: the reset sequence is correct (esp. the `-e node_modules` flag); the integration test genuinely exercises real git (not over-mocked); `throw`-on-anomaly + the caller-falls-back contract; ADR-176 (the pool adds no kernel concept — it's conductor tooling, not claim-plane); no coverage regression.
- [ ] **Step 3: Post findings BEFORE any fix** (`post-findings de-braighter/foundry#<pr> findings.json`).
- [ ] **Step 4: Fix blockers; re-review.**
- [ ] **Step 5: Admin-merge (freeze-merge):** gate = `npm run ci:local` green + `gh pr merge <pr> --repo de-braighter/foundry --squash --admin`. **Verify `state == MERGED` before cleanup.**
- [ ] **Step 6: Twin ritual** — drain → backfill → reconcile.
- [ ] **Step 7: Worktree cleanup (verified-merged only).**

---

## Part B — `workbench`: the skill wiring (after Part A merges)

### File Structure (Part B)

- **Modify** `.claude/skills/foundry-worker/SKILL.md` — Phase-2 ISOLATE gains the lease-or-cold-add branch.
- **Modify** `.claude/skills/foundry-conduct/SKILL.md` — a one-line note: workers lease warm pool slots (pool size = the conductor's per-repo worker cap); the warm pool is now implemented.
- **Modify** `.claude/skills/foundry-superconduct/SKILL.md` — update the "Deferred" line (the warm pool is shipped; it composes — conductors' workers lease slots).
- **Modify** `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` — mark §C.4 / slice 2.5 implemented (item B).

### Task B1: foundry-worker ISOLATE — lease-or-cold-add

**Files:** Modify `.claude/skills/foundry-worker/SKILL.md` (Phase 2 — ISOLATE)

- [ ] **Step 1** — Add a lease branch to Phase 2. After the existing cold recipe, insert: "**Warm pool (throughput; correctness never depends on it):** if the conductor maintains a warm pool, lease a slot instead of a cold `git worktree add` — `SLOT=$(cd domains/foundry && npm run -s wt-pool -- lease <repo-local-path> feat/<slug> <slotIndex> origin/main)`; on success `cd $SLOT` (already pristine + warm `node_modules`, on `feat/<slug>`); **on non-zero exit, fall back to the cold `git worktree add` recipe above** (the pool is a throughput layer, never a correctness dependency). The pool lives at `<repo>/.claude/wt-pool/slot-<i>` — add `.claude/wt-pool/` to `.git/info/exclude` (idempotent), like `.claude/worktrees/`." Keep the cold recipe as the default/fallback.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/foundry-worker/SKILL.md
git commit -m "feat(foundry-worker): ISOLATE leases a warm pool slot, falls back to cold worktree-add"
```

### Task B2: conductor + superconductor notes + spec

**Files:** Modify `foundry-conduct/SKILL.md`, `foundry-superconduct/SKILL.md`, the design spec

- [ ] **Step 1** — `foundry-conduct/SKILL.md` "## Deferred to the next increment": move the warm worktree pool out of deferred; add a one-line note in the concurrency-guards / pool area: "Workers lease warm pool slots (`<repo>/.claude/wt-pool/slot-<i>`, pool size = the per-repo worker cap); reset-on-lease keeps node_modules warm — see `domains/foundry` `wt-pool`."
- [ ] **Step 2** — `foundry-superconduct/SKILL.md` "## Deferred": update "the warm worktree pool (§C.4, item B) composes orthogonally" to "shipped — conductors' workers lease pool slots."
- [ ] **Step 3** — design spec: mark §C.4 / slice 2.5 implemented (item B); note the tested-module home (`domains/foundry/src/wt-pool.ts`) + the lease-or-cold-add fallback + the single-coordinator lease (multi-coordinator per-slot lease stays slice-3).
- [ ] **Step 4: Commit** (explicit paths)

```bash
git add .claude/skills/foundry-conduct/SKILL.md .claude/skills/foundry-superconduct/SKILL.md docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md
git commit -m "docs(foundry): wire warm pool into conductor/superconductor; mark §C.4 shipped (item B)"
```

### Task B3: PR B, verifier wave, land

- [ ] Push `feat/wt-pool-wiring` on `de-braighter/workbench`; open PR (Producer/Effort/Effect/Refs); verifier wave (reviewer + qa-engineer + charter-checker + local-ci, read-only); post-findings; fix; admin-merge; **verify MERGED**; twin ritual; worktree cleanup.

---

## Self-Review (run before execution)

- **Spec coverage:** §C.4 — warm pool per repo (poolPaths/ensureSlot), reset-on-lease preserving node_modules (resetPlan/runReset + the integration test), pool-size = cap (nextFreeSlot), slots persist across sessions (worktrees on disk), correctness-never-depends (throw + caller cold-add fallback, B1). ✓
- **Placeholder scan:** every step has real code/commands. ✓
- **Type consistency:** `ResetStep`/`RunStep`/`RunResult`/`PoolPaths` defined in A1/A2/A3, reused in A4–A6; `leaseSlot(repoRoot, branch, slotIndex, baseRef, run)` signature consistent across A5 + the CLI + B1. ✓
- **Scope:** two PRs (foundry code TDD; workbench wiring) — clean split per the "code in domains, skills in workbench" rule. ✓
