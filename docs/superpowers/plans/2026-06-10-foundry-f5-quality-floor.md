# Foundry F5 — Quality-Floor Battery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the deterministic quality floor into `@de-braighter/lint-kit` / `@de-braighter/test-kit` (layers/foundation), prove the new gates on real repos BEFORE they become defaults, wire the battery into `/new-domain` so every product is born with it, and turn the 7 AI-harness failure modes into explicit checklists in the `reviewer` / `qa-engineer` agent prompts (the quality "ceiling").

**Architecture:** Two PR streams. **PR-A (foundation, code):** dependency-light config factories — `auditConfig` (type-aware switch-exhaustiveness) + `knipDomainPreset` in lint-kit; `defineStrykerConfig` (tier thresholds) + `assertNonSuperuser`/`appRoleSql` in test-kit. Factories return plain objects; consumers install the tools (no stryker/knip/pg deps in the kits — no version lock-in). **Prove-itself (spec §8, between PR-A code and PR-B):** knip + Stryker on `domains/devloop` (no DB, fast signal), the non-superuser guard on `domains/conservation` (real RLS + `substrate_app` role); findings tune the defaults before they ship. **PR-B (workbench, declarative):** `/new-domain` template + skill upgrade (scaffolds currently have NO eslint and vitest 1.6.1 — this is a real upgrade), the UI a11y battery template, the agent-prompt checklists, and the prove-itself runbook with the real findings.

**Tech Stack:** TypeScript (tsc -b, npm workspaces), vitest 4, ESLint 9 flat config, typescript-eslint, knip, Stryker (`@stryker-mutator/core` + vitest runner), Postgres `pg_roles` introspection.

**Spec:** `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md` §5 (quality floor table + ceiling), §6 row F5, §8 (battery proves itself on devloop/conservation before becoming a default). Failure-mode source: memory `ai-harness-failure-modes-and-guardrails` + substrate prior art (`eslint.config.mjs:30-59`, `knip.json`, `libs/substrate-runtime/sql/app-roles.sql`).

---

## Gap-closure decisions (spec leaves open; ratified for this plan)

1. **Kits stay dependency-light.** Stryker/knip configs are plain-object factories; the consuming repo installs the tools. `assertNonSuperuser` takes an injected `SqlExecutor` (works with Prisma raw, pg, anything) — test-kit gains ZERO runtime deps.
2. **What lives where:** lint-kit (static analysis) gets the ESLint audit set + the knip preset; test-kit (test infra) gets the Stryker factory + the pg-role guard. Both bump 0.x → **0.2.0** (additive minor; `npm view <pkg> versions` before publish — memory lesson).
3. **Tier thresholds** (tunable by prove-itself findings, Task 10): `t0 = {high:80, low:60, break:null}` (report-only), `t1 = {high:80, low:65, break:60}` (the charter example `mutation>=60`), `t2 = {high:90, low:80, break:75}`.
4. **a11y battery ships as an Angular template spec, NOT a test-kit helper.** UI tiers run `ng test` (Karma/Jasmine), not vitest — a vitest-axe helper would serve nobody. The canonical player-surfaces patterns become `templates/ui/a11y.spec.example.ts` copied next to each page component, plus the qa-engineer dimension-2 checks that already exist.
5. **Coverage-delta needs no new code** — `defineBaseConfig` (test-kit) already emits the cluster-standard lcov; the gap is that `/new-domain` templates don't use it. Wiring it into the template vitest configs IS the coverage-delta floor for newborn repos.
6. **knip posture in scaffolds:** `ci:local` runs `knip --no-exit-code` (report mode — a fresh scaffold is never blocked by a config false-positive); `quality:knip` strict is the wave-time/obligation gate. Mirrors substrate's `ci:knip`/`knip` split. Mutation is NOT in `ci:local` (too slow) — it's the `quality:mutation` script, run per tier obligation.
7. **Stryker in the pnpm scaffold:** per-lib `stryker.config.mjs` (spine + pack — where domain logic lives), root devDeps for the stryker packages (pnpm puts the workspace-root `.bin` on script PATH), root script `quality:mutation` fans out via `pnpm -r --if-present`.
8. **Existing repos are NOT retrofitted in this arc** (spec: "retrofitted progressively") — prove-itself runs are scratch/no-commit; only newborn domains get the battery by default.
9. **Sequencing:** prove-itself runs use the foundation worktree's built dist (before PR-A merges), so findings can tune defaults inside PR-A. PR-B merges only after foundation 0.2.0 is published (its templates pin `^0.2.0`).

## File structure (lock-in)

```text
layers/foundation/ (PR-A — worktree .claude/worktrees/f5-quality-floor-kits, branch feat/f5-quality-floor-kits)
├── packages/lint-kit/src/eslint/audit.ts            # NEW  auditConfig + auditRuleIds
├── packages/lint-kit/src/eslint/audit.spec.ts       # NEW
├── packages/lint-kit/src/eslint/index.ts            # MODIFY  re-export audit
├── packages/lint-kit/src/knip/index.ts              # NEW  knipDomainPreset
├── packages/lint-kit/src/knip/index.spec.ts         # NEW
├── packages/lint-kit/package.json                   # MODIFY  version 0.2.0 + ./knip export
├── packages/test-kit/src/stryker.ts                 # NEW  defineStrykerConfig
├── packages/test-kit/src/stryker.spec.ts            # NEW
├── packages/test-kit/src/pg-roles.ts                # NEW  assertNonSuperuser + appRoleSql
├── packages/test-kit/src/pg-roles.spec.ts           # NEW
├── packages/test-kit/src/index.ts                   # MODIFY  re-export both
└── packages/test-kit/package.json                   # MODIFY  version 0.2.0 + subpath exports

de-braighter/ (PR-B — worktree .claude/worktrees/f5-quality-floor-wiring, branch feat/f5-quality-floor-wiring)
├── .claude/skills/new-domain/templates/foundation/package.json.tmpl        # MODIFY  battery deps/scripts
├── .claude/skills/new-domain/templates/foundation/eslint.config.mjs.tmpl   # NEW
├── .claude/skills/new-domain/templates/foundation/knip.ts.tmpl             # NEW
├── .claude/skills/new-domain/templates/foundation/libs/spine/stryker.config.mjs.tmpl  # NEW
├── .claude/skills/new-domain/templates/foundation/libs/pack/stryker.config.mjs.tmpl   # NEW
├── .claude/skills/new-domain/templates/foundation/libs/spine/package.json.tmpl  # MODIFY  quality:mutation
├── .claude/skills/new-domain/templates/foundation/libs/pack/package.json.tmpl   # MODIFY  quality:mutation
├── .claude/skills/new-domain/templates/foundation/{libs/spine,libs/pack,apps/api}/vitest.config.ts  # MODIFY  defineBaseConfig
├── .claude/skills/new-domain/templates/ui/a11y.spec.example.ts             # NEW
├── .claude/skills/new-domain/SKILL.md                                      # MODIFY  Step 2b quality floor + UI step
├── .claude/agents/reviewer.md                                              # MODIFY  7-failure-modes section
├── .claude/agents/qa-engineer.md                                           # MODIFY  pre-flight section
├── docs/superpowers/runbooks/2026-06-10-quality-floor-prove-itself.md      # NEW  real findings
└── docs/superpowers/plans/2026-06-10-foundry-f5-quality-floor.md           # this plan
```

---

### Task 1: Foundation worktree + branch

**Files:** none (git plumbing)

- [ ] **Step 1:**

```bash
cd D:/development/projects/de-braighter/layers/foundation
git fetch origin main
git worktree add .claude/worktrees/f5-quality-floor-kits -b feat/f5-quality-floor-kits origin/main
cd .claude/worktrees/f5-quality-floor-kits
npm install
```

All foundation tasks operate inside this worktree. Never run git checkout/stash/clean/reset in the shared clone at `layers/foundation`.

---

### Task 2: lint-kit — ESLint audit set (`auditConfig`)

**Files:**
- Test: `packages/lint-kit/src/eslint/audit.spec.ts`
- Create: `packages/lint-kit/src/eslint/audit.ts`
- Modify: `packages/lint-kit/src/eslint/index.ts` (append re-export)

- [ ] **Step 1: Write the failing test** — `packages/lint-kit/src/eslint/audit.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { auditConfig, auditRuleIds } from './audit.js';

describe('auditConfig', () => {
  const base = { project: ['libs/x/tsconfig.json'], tsconfigRootDir: '/repo' };

  it('returns a single type-aware flat-config block', () => {
    const configs = auditConfig(base);
    expect(configs).toHaveLength(1);
    const [cfg] = configs;
    expect(cfg.languageOptions?.parserOptions?.['project']).toEqual(['libs/x/tsconfig.json']);
    expect(cfg.languageOptions?.parserOptions?.['tsconfigRootDir']).toBe('/repo');
    expect(cfg.languageOptions?.parser).toBeDefined();
  });

  it('pins switch-exhaustiveness with default-masking disabled', () => {
    const [cfg] = auditConfig(base);
    expect(cfg.rules?.['@typescript-eslint/switch-exhaustiveness-check']).toEqual([
      'error',
      { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
    ]);
  });

  it('targets production sources and ignores specs by default', () => {
    const [cfg] = auditConfig(base);
    expect(cfg.files).toEqual(['libs/*/src/**/*.ts', 'apps/*/src/**/*.ts']);
    expect(cfg.ignores).toEqual(expect.arrayContaining(['**/*.spec.ts', '**/*.test.ts']));
  });

  it('honors files/ignores overrides', () => {
    const [cfg] = auditConfig({ ...base, files: ['src/**/*.ts'], ignores: ['**/legacy/**'] });
    expect(cfg.files).toEqual(['src/**/*.ts']);
    expect(cfg.ignores).toEqual(expect.arrayContaining(['**/legacy/**', '**/*.spec.ts']));
  });

  it('exposes the audit rule ids', () => {
    expect(auditRuleIds).toContain('@typescript-eslint/switch-exhaustiveness-check');
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run packages/lint-kit/src/eslint/audit.spec.ts` (from the worktree root). Expected: FAIL (cannot resolve `./audit.js`). Do NOT pipe through `2>$null` (PS 5.1 breaks vitest).

- [ ] **Step 3: Implement** — `packages/lint-kit/src/eslint/audit.ts`:

```typescript
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';

/**
 * The audit lint set — type-aware rules from the 2026-06-09 harness audit,
 * each killing a named failure mode. Currently: switch-exhaustiveness with
 * default-masking disabled (kills "unmapped reachable error → 500": a
 * `default:` branch on a discriminated union otherwise hides a newly added
 * member until it 500s in production).
 *
 * Type-aware rules need a TS program — pass the build tsconfigs (which include
 * src and exclude specs) via `project`.
 */

export interface AuditOptions {
  /** Build tsconfig paths providing type information (relative to `tsconfigRootDir`). */
  readonly project: readonly string[];
  /** The repo root the tsconfig paths resolve against (`import.meta.dirname`). */
  readonly tsconfigRootDir: string;
  /** File globs the audit rules apply to. Defaults to lib/app production sources. */
  readonly files?: readonly string[];
  /** Extra ignore globs merged with the spec/test defaults. */
  readonly ignores?: readonly string[];
}

const AUDIT_RULES: Linter.RulesRecord = {
  '@typescript-eslint/switch-exhaustiveness-check': [
    'error',
    {
      considerDefaultExhaustiveForUnions: false,
      requireDefaultForNonUnion: true,
    },
  ],
};

const DEFAULT_AUDIT_FILES = ['libs/*/src/**/*.ts', 'apps/*/src/**/*.ts'] as const;
const DEFAULT_AUDIT_IGNORES = ['**/*.spec.ts', '**/*.test.ts'] as const;

/** Build the type-aware audit flat-config block. Spread after `deBraighterPreset()`. */
export function auditConfig(options: AuditOptions): Linter.Config[] {
  return [
    {
      files: [...(options.files ?? DEFAULT_AUDIT_FILES)],
      ignores: [...DEFAULT_AUDIT_IGNORES, ...(options.ignores ?? [])],
      languageOptions: {
        parser: tseslint.parser as Linter.Parser,
        parserOptions: {
          project: [...options.project],
          tsconfigRootDir: options.tsconfigRootDir,
        },
      },
      rules: AUDIT_RULES,
    },
  ];
}

/** The rule ids the audit set enforces — exported for tests/diagnostics. */
export const auditRuleIds = Object.keys(AUDIT_RULES);
```

Append to `packages/lint-kit/src/eslint/index.ts` (bottom of file):

```typescript
export { auditConfig, auditRuleIds, type AuditOptions } from './audit.js';
```

- [ ] **Step 4: Run the test to verify it passes** — `npx vitest run packages/lint-kit/src/eslint/audit.spec.ts`. Expected: 5 passed. (If `parserOptions` typing fights `Linter.Config`, mirror how `deBraighterPreset` in the same folder handles casts — keep the cast local and commented.)

- [ ] **Step 5: Commit**

```bash
git add packages/lint-kit/src/eslint/audit.ts packages/lint-kit/src/eslint/audit.spec.ts packages/lint-kit/src/eslint/index.ts
git commit -m "feat(lint-kit): auditConfig — type-aware switch-exhaustiveness audit set (kills unmapped-error->500)"
```

---

### Task 3: lint-kit — knip preset (`knipDomainPreset`)

**Files:**
- Test: `packages/lint-kit/src/knip/index.spec.ts`
- Create: `packages/lint-kit/src/knip/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/lint-kit/src/knip/index.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { knipDomainPreset } from './index.js';

describe('knipDomainPreset', () => {
  it('builds the cluster-standard domain workspace layout', () => {
    const cfg = knipDomainPreset({ domain: 'agri' });
    expect(Object.keys(cfg.workspaces)).toEqual([
      '.',
      'libs/agri-spine',
      'libs/agri-pack',
      'apps/agri-api',
    ]);
    expect(cfg.workspaces['libs/agri-spine']).toEqual({
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
    });
    expect(cfg.workspaces['apps/agri-api']).toEqual({
      entry: ['src/main.ts'],
      project: ['src/**/*.ts'],
    });
  });

  it('merges extra workspaces (e.g. an Angular UI app)', () => {
    const cfg = knipDomainPreset({
      domain: 'agri',
      extraWorkspaces: { 'apps/agri-ui': { entry: ['src/main.ts'], project: ['src/**/*.ts'] } },
    });
    expect(cfg.workspaces['apps/agri-ui']).toEqual({
      entry: ['src/main.ts'],
      project: ['src/**/*.ts'],
    });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run packages/lint-kit/src/knip/index.spec.ts` → cannot resolve `./index.js`.

- [ ] **Step 3: Implement** — `packages/lint-kit/src/knip/index.ts`:

```typescript
/**
 * knip config presets.
 *
 * knip finds dead exports / unused files / unused deps — the deterministic
 * enforcement of ADR-176's demand-driven rule (kills the "speculative
 * generality" harness failure mode). Zero-dependency: returns a plain config
 * object the consuming repo default-exports from `knip.ts` (the repo installs
 * `knip` itself).
 */

export interface KnipWorkspaceConfig {
  readonly entry: readonly string[];
  readonly project: readonly string[];
}

export interface KnipConfig {
  readonly $schema?: string;
  readonly workspaces: Record<string, KnipWorkspaceConfig>;
}

export interface KnipDomainOptions {
  /** Kebab domain name (`agri` → `libs/agri-spine`, `libs/agri-pack`, `apps/agri-api`). */
  readonly domain: string;
  /** Additional workspaces (e.g. an Angular UI app) merged into the preset. */
  readonly extraWorkspaces?: Record<string, KnipWorkspaceConfig>;
}

const SRC_PROJECT = ['src/**/*.ts'] as const;

/**
 * The cluster-standard `/new-domain` pnpm-workspace layout (spine + pack libs
 * with `src/index.ts` barrels, NestJS api entered at `src/main.ts`).
 */
export function knipDomainPreset(options: KnipDomainOptions): KnipConfig {
  const { domain } = options;
  return {
    $schema: 'https://unpkg.com/knip@6/schema.json',
    workspaces: {
      '.': { entry: ['tools/**/*.{mjs,ts}'], project: ['tools/**/*.{mjs,ts}'] },
      [`libs/${domain}-spine`]: { entry: ['src/index.ts'], project: [...SRC_PROJECT] },
      [`libs/${domain}-pack`]: { entry: ['src/index.ts'], project: [...SRC_PROJECT] },
      [`apps/${domain}-api`]: { entry: ['src/main.ts'], project: [...SRC_PROJECT] },
      ...options.extraWorkspaces,
    },
  };
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run packages/lint-kit/src/knip/index.spec.ts` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/lint-kit/src/knip
git commit -m "feat(lint-kit): knipDomainPreset — dead-export gate preset for /new-domain layouts (enforces ADR-176)"
```

---

### Task 4: test-kit — Stryker tier factory (`defineStrykerConfig`)

**Files:**
- Test: `packages/test-kit/src/stryker.spec.ts`
- Create: `packages/test-kit/src/stryker.ts`

- [ ] **Step 1: Write the failing test** — `packages/test-kit/src/stryker.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { defineStrykerConfig, mutationTierThresholds } from './stryker.js';

describe('defineStrykerConfig', () => {
  it('t0 is report-only (never breaks the build)', () => {
    expect(defineStrykerConfig({ tier: 't0' }).thresholds).toEqual({
      high: 80,
      low: 60,
      break: null,
    });
  });

  it('t1 enforces the charter floor mutation>=60', () => {
    expect(defineStrykerConfig({ tier: 't1' }).thresholds.break).toBe(60);
  });

  it('t2 enforces the regulated floor 75', () => {
    expect(defineStrykerConfig({ tier: 't2' }).thresholds.break).toBe(75);
  });

  it('defaults to the vitest runner and excludes specs from mutation', () => {
    const cfg = defineStrykerConfig({ tier: 't0' });
    expect(cfg.testRunner).toBe('vitest');
    expect(cfg.mutate).toEqual(['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.test.ts']);
  });

  it('honors mutate/concurrency overrides', () => {
    const cfg = defineStrykerConfig({ tier: 't1', mutate: ['src/core/**/*.ts'], concurrency: 2 });
    expect(cfg.mutate).toEqual(['src/core/**/*.ts']);
    expect(cfg.concurrency).toBe(2);
  });

  it('exports the tier table for diagnostics', () => {
    expect(Object.keys(mutationTierThresholds)).toEqual(['t0', 't1', 't2']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run packages/test-kit/src/stryker.spec.ts`.

- [ ] **Step 3: Implement** — `packages/test-kit/src/stryker.ts`:

```typescript
/**
 * Tier-parameterized Stryker mutation-testing config factory.
 *
 * Mutation score measures whether tests CONSTRAIN behavior — the deterministic
 * answer to the "test theater" harness failure mode (coverage % cannot tell a
 * real assertion from one that asserts a mock). Tiers follow the Foundry risk
 * model: T0 demo (report-only), T1 product (charter floor `mutation>=60`),
 * T2 regulated (75).
 *
 * Zero-dependency by design: returns a plain config object — the consuming
 * repo installs `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`
 * and default-exports the result from `stryker.config.mjs`.
 */

export type MutationTier = 't0' | 't1' | 't2';

export interface StrykerThresholds {
  readonly high: number;
  readonly low: number;
  /** `null` = report-only: the run never fails on score. */
  readonly break: number | null;
}

const TIER_THRESHOLDS: Record<MutationTier, StrykerThresholds> = {
  t0: { high: 80, low: 60, break: null },
  t1: { high: 80, low: 65, break: 60 },
  t2: { high: 90, low: 80, break: 75 },
};

export interface StrykerConfigOptions {
  readonly tier: MutationTier;
  /** Mutation target globs. Default: package src minus specs. */
  readonly mutate?: readonly string[];
  /** Stryker test runner. Default `vitest`. */
  readonly testRunner?: string;
  /** Worker concurrency cap (omit to let Stryker decide). */
  readonly concurrency?: number;
}

export interface StrykerConfig {
  readonly testRunner: string;
  readonly mutate: readonly string[];
  readonly thresholds: StrykerThresholds;
  readonly reporters: readonly string[];
  readonly tempDirName: string;
  readonly concurrency?: number;
}

const DEFAULT_MUTATE = ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.test.ts'] as const;

export function defineStrykerConfig(options: StrykerConfigOptions): StrykerConfig {
  return {
    testRunner: options.testRunner ?? 'vitest',
    mutate: [...(options.mutate ?? DEFAULT_MUTATE)],
    thresholds: TIER_THRESHOLDS[options.tier],
    reporters: ['clear-text', 'progress'],
    tempDirName: '.stryker-tmp',
    ...(options.concurrency != null ? { concurrency: options.concurrency } : {}),
  };
}

/** The tier table — exported for diagnostics/tests. */
export const mutationTierThresholds = TIER_THRESHOLDS;
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run packages/test-kit/src/stryker.spec.ts` → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/test-kit/src/stryker.ts packages/test-kit/src/stryker.spec.ts
git commit -m "feat(test-kit): defineStrykerConfig — tier-parameterized mutation thresholds (kills test-theater)"
```

---

### Task 5: test-kit — non-superuser guard (`assertNonSuperuser` + `appRoleSql`)

**Files:**
- Test: `packages/test-kit/src/pg-roles.spec.ts`
- Create: `packages/test-kit/src/pg-roles.ts`

- [ ] **Step 1: Write the failing test** — `packages/test-kit/src/pg-roles.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { appRoleSql, assertNonSuperuser, SuperuserConnectionError } from './pg-roles.js';

const executorReturning =
  (row: Record<string, unknown> | undefined) =>
  async (_sql: string): Promise<ReadonlyArray<Record<string, unknown>>> =>
    row ? [row] : [];

describe('assertNonSuperuser', () => {
  it('passes for a NOSUPERUSER NOBYPASSRLS role', async () => {
    await expect(
      assertNonSuperuser(executorReturning({ is_superuser: false, bypasses_rls: false })),
    ).resolves.toBeUndefined();
  });

  it('throws when connected as a superuser', async () => {
    await expect(
      assertNonSuperuser(executorReturning({ is_superuser: true, bypasses_rls: false })),
    ).rejects.toBeInstanceOf(SuperuserConnectionError);
  });

  it('throws when the role bypasses RLS', async () => {
    await expect(
      assertNonSuperuser(executorReturning({ is_superuser: false, bypasses_rls: true })),
    ).rejects.toBeInstanceOf(SuperuserConnectionError);
  });

  it('handles text-mode driver booleans (t/f)', async () => {
    await expect(
      assertNonSuperuser(executorReturning({ is_superuser: 'f', bypasses_rls: 't' })),
    ).rejects.toBeInstanceOf(SuperuserConnectionError);
  });

  it('fails closed when the role row cannot be read', async () => {
    await expect(assertNonSuperuser(executorReturning(undefined))).rejects.toBeInstanceOf(
      SuperuserConnectionError,
    );
  });
});

describe('appRoleSql', () => {
  it('creates an idempotent NOSUPERUSER NOBYPASSRLS login role', () => {
    const sql = appRoleSql();
    expect(sql).toContain("WHERE rolname = 'app'");
    expect(sql).toContain('NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE');
    expect(sql).toContain('IF NOT EXISTS');
  });

  it('rejects role names that are not safe identifiers', () => {
    expect(() => appRoleSql({ role: 'app; DROP TABLE x' })).toThrow();
  });

  it('rejects passwords containing quotes', () => {
    expect(() => appRoleSql({ password: "a'b" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run packages/test-kit/src/pg-roles.spec.ts`.

- [ ] **Step 3: Implement** — `packages/test-kit/src/pg-roles.ts`:

```typescript
/**
 * Non-superuser Postgres test-role helpers.
 *
 * Superusers (and BYPASSRLS roles) silently bypass FORCE ROW LEVEL SECURITY —
 * an RLS/tenancy suite running as one proves nothing (the "isolation untested
 * by default" harness failure mode; the 2026-06-09 audit named making this a
 * default-gated check the single highest-leverage quality lift).
 * `assertNonSuperuser` is the fail-closed guard every DB-backed suite calls in
 * its global setup; `appRoleSql` provisions the canonical dev app role
 * (mirrors substrate `libs/substrate-runtime/sql/app-roles.sql`).
 */

/** Any raw-SQL runner: `(sql) => prisma.$queryRawUnsafe(sql)` or a pg client query. */
export type SqlExecutor = (sql: string) => Promise<ReadonlyArray<Record<string, unknown>>>;

export class SuperuserConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperuserConnectionError';
  }
}

const truthy = (v: unknown): boolean => v === true || v === 't' || v === 'true';

/**
 * Fails (closed) unless the CURRENT connection's role is NOSUPERUSER and
 * NOBYPASSRLS. Call once in the DB-suite global setup, with the same
 * connection the tests use.
 */
export async function assertNonSuperuser(query: SqlExecutor): Promise<void> {
  const rows = await query(
    'SELECT rolsuper AS is_superuser, rolbypassrls AS bypasses_rls FROM pg_roles WHERE rolname = current_user',
  );
  const row = rows[0];
  if (!row) {
    throw new SuperuserConnectionError(
      'could not read the current role from pg_roles — refusing to run RLS tests on an unverified connection',
    );
  }
  if (truthy(row['is_superuser']) || truthy(row['bypasses_rls'])) {
    throw new SuperuserConnectionError(
      'tests are connected as a superuser/BYPASSRLS role — FORCE RLS is bypassed and the suite proves nothing; connect with the NOBYPASSRLS app role',
    );
  }
}

export interface AppRoleSqlOptions {
  /** Role name. Default `app`. Must be a plain lowercase identifier. */
  readonly role?: string;
  /** Dev-only literal password. Default `app`. */
  readonly password?: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Idempotent SQL creating the dev app role (LOGIN, NOSUPERUSER, NOBYPASSRLS).
 * Dev/test tooling only — production roles come from real provisioning.
 */
export function appRoleSql(options: AppRoleSqlOptions = {}): string {
  const role = options.role ?? 'app';
  const password = options.password ?? 'app';
  if (!IDENTIFIER.test(role)) {
    throw new Error(`role must match ${String(IDENTIFIER)} — got ${JSON.stringify(role)}`);
  }
  if (password.includes("'")) {
    throw new Error('password must not contain single quotes');
  }
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;`;
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run packages/test-kit/src/pg-roles.spec.ts` → 8 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/test-kit/src/pg-roles.ts packages/test-kit/src/pg-roles.spec.ts
git commit -m "feat(test-kit): assertNonSuperuser + appRoleSql — fail-closed RLS-isolation guard (kills isolation-untested-by-default)"
```

---

### Task 6: Package exports, versions, READMEs, full gate

**Files:**
- Modify: `packages/lint-kit/package.json` (version `0.2.0`; add `./knip` export)
- Modify: `packages/test-kit/package.json` (version `0.2.0`; add `./stryker` + `./pg-roles` exports)
- Modify: `packages/test-kit/src/index.ts` (re-export stryker + pg-roles)
- Modify: `packages/lint-kit/README.md`, `packages/test-kit/README.md` (short new-surface sections)

- [ ] **Step 1: lint-kit package.json** — set `"version": "0.2.0"` and add to `"exports"` (after the `"./eslint"` entry):

```json
"./knip": {
  "types": "./dist/knip/index.d.ts",
  "import": "./dist/knip/index.js",
  "default": "./dist/knip/index.js"
}
```

- [ ] **Step 2: test-kit package.json** — set `"version": "0.2.0"` and add to `"exports"` (after the `"./vitest-base"` entry):

```json
"./stryker": {
  "types": "./dist/stryker.d.ts",
  "import": "./dist/stryker.js",
  "default": "./dist/stryker.js"
},
"./pg-roles": {
  "types": "./dist/pg-roles.d.ts",
  "import": "./dist/pg-roles.js",
  "default": "./dist/pg-roles.js"
}
```

- [ ] **Step 3: test-kit root barrel** — append to `packages/test-kit/src/index.ts`:

```typescript
export {
  defineStrykerConfig,
  mutationTierThresholds,
  type MutationTier,
  type StrykerConfig,
  type StrykerConfigOptions,
  type StrykerThresholds,
} from './stryker.js';
export {
  appRoleSql,
  assertNonSuperuser,
  SuperuserConnectionError,
  type AppRoleSqlOptions,
  type SqlExecutor,
} from './pg-roles.js';
```

- [ ] **Step 4: README sections** — append to each package README a short "Quality floor" section: lint-kit — `auditConfig` (usage snippet: spread after `deBraighterPreset()` with `project` + `tsconfigRootDir`) + `knipDomainPreset` (default-export from `knip.ts`); test-kit — `defineStrykerConfig({ tier })` (tier semantics t0/t1/t2 + the consumer-installs-stryker note) + `assertNonSuperuser` (global-setup usage with a Prisma raw executor) + `appRoleSql`. Each entry names the failure mode it kills (test-theater / speculative-generality / unmapped-error→500 / isolation-untested-by-default).

- [ ] **Step 5: Full gate** — from the worktree root: `npm run ci:local` (tsc -b build + eslint `--max-warnings=0` + vitest). Expected: green. Fix any lint findings on the new files mechanically (match the repo's existing style).

- [ ] **Step 6: Commit**

```bash
git add packages/lint-kit/package.json packages/test-kit/package.json packages/test-kit/src/index.ts packages/lint-kit/README.md packages/test-kit/README.md
git commit -m "feat(foundation): lint-kit 0.2.0 + test-kit 0.2.0 — quality-floor exports (knip/stryker/pg-roles subpaths)"
```

---

### Task 7: Prove-itself A — knip on devloop (spec §8)

**Files:** scratch only (a devloop worktree on a never-pushed local branch) — findings recorded for Task 17's runbook. NO commits to devloop.

- [ ] **Step 1: Scratch worktree**

```bash
cd D:/development/projects/de-braighter/domains/devloop
git fetch origin main
git worktree add .claude/worktrees/f5-prove -b scratch/f5-prove origin/main
cd .claude/worktrees/f5-prove
npm install
npm install --no-save knip@^6.16.1
```

(`--no-save` keeps package.json clean; the branch is local-only and removed afterwards. Never run git checkout/stash/clean in the shared devloop clone.)

- [ ] **Step 2: Author a scratch `knip.json`** in the worktree (devloop is a flat repo, not a pnpm workspace — the domain preset doesn't apply; this run proves the GATE, the preset is proven by scaffold use). First read `package.json` (`bin`, `scripts`) and `vitest.config.ts` to enumerate the REAL entry points (expected: `src/cli.ts`, the knowledge-graph MCP server entry, test files, config files), then e.g.:

```json
{
  "entry": [
    "src/cli.ts",
    "src/knowledge-graph/mcp/server.ts",
    "test/**/*.test.ts",
    "vitest.config.ts"
  ],
  "project": ["src/**/*.ts", "test/**/*.ts"]
}
```

Adjust to the discovered entries — a missing entry produces false "unused file" positives; the triage must distinguish those from real findings.

- [ ] **Step 3: Run + capture** — `npx knip --no-exit-code` (report mode). Capture the full output.

- [ ] **Step 4: Triage EVERY finding** into a table (finding → class: `true-positive dead export` / `false-positive: missing entry` / `config tweak needed` → action). Record: knip version, runtime (seconds), raw counts, the triage table, and a verdict line: is `knip --no-exit-code` in `ci:local` + strict `quality:knip` as a wave gate workable for this repo class? Keep the raw output for the runbook.

- [ ] **Step 5: Leave the worktree in place** (Task 8 reuses it).

---

### Task 8: Prove-itself B — Stryker mutation run on devloop (spec §8)

**Files:** scratch only (same worktree as Task 7). NO commits to devloop.

- [ ] **Step 1: Verify versions before installing** — `npm view @stryker-mutator/vitest-runner version` and `npm view @stryker-mutator/vitest-runner peerDependencies` (devloop is on vitest ^2.1 — pick the newest stryker major whose vitest peer range includes it; record the choice). Then:

```bash
cd D:/development/projects/de-braighter/domains/devloop/.claude/worktrees/f5-prove
npm install --no-save @stryker-mutator/core @stryker-mutator/vitest-runner
```

- [ ] **Step 2: Author a scratch `stryker.config.mjs`** — inline the t1 shape (test-kit 0.2.0 is not published yet; this mirrors `defineStrykerConfig({ tier: 't1' })` and says so in a comment), with a BOUNDED mutate set: pick 2–3 core pure-logic modules with strong unit coverage (read `test/` to find the best-covered ones — e.g. the reconcile/scoring/state modules):

```javascript
// Mirrors @de-braighter/test-kit defineStrykerConfig({ tier: 't1' }) — kit not yet published.
export default {
  testRunner: 'vitest',
  mutate: ['src/<chosen-module-1>.ts', 'src/<chosen-module-2>.ts'],
  thresholds: { high: 80, low: 65, break: 60 },
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp',
};
```

(The `<chosen-module-N>` placeholders are filled at execution time from the coverage map — record WHICH modules and WHY in the findings. If the run exceeds ~20 minutes, shrink the mutate set and SAY SO — no silent caps.)

- [ ] **Step 3: Run + capture** — `npx stryker run` (plain; no `2>$null`). Capture: mutation score, killed/survived/timeout/no-coverage counts, runtime.

- [ ] **Step 4: Triage** — classify the surviving mutants (missing assertion / untested branch / equivalent mutant / test-theater instance) with 1-line examples. Verdict lines: (a) is the t1 `break: 60` threshold realistic against a real repo's strong modules? — propose tuning if not; (b) what would a FULL-repo run cost (extrapolate runtime)? Record everything for the runbook.

- [ ] **Step 5: Clean up the devloop worktree**

```bash
cd D:/development/projects/de-braighter/domains/devloop
git worktree remove .claude/worktrees/f5-prove --force
git branch -D scratch/f5-prove
```

---

### Task 9: Prove-itself C — non-superuser guard on conservation (spec §8)

**Files:** scratch script only (in the foundation worktree `tmp/` — not committed). NO commits to conservation; read-only + docker against the existing compose file.

- [ ] **Step 1: Build the kits** — in the foundation worktree: `npm run build` (emits `packages/test-kit/dist/pg-roles.js` for direct import).

- [ ] **Step 2: Get conservation Postgres up** — read `domains/conservation/.env.example` + `docker-compose.yml` (main clone, READ-ONLY — no git operations) for the port + credentials of both the superuser and the `substrate_app` role (`docker/postgres-init/01-create-app-role.sql` documents the app role). Then `docker compose up -d` from `domains/conservation` (compose alone needs no git change) and wait for healthy; if migrations are required for the DB to accept connections, run conservation's documented `db:setup`. If the DB cannot be brought up, STOP and record the blocker honestly — do not fake the run.

- [ ] **Step 3: Scratch verification script** — `<foundation-worktree>/tmp/prove-pg-guard.mjs` (install `pg` into the worktree with `npm install --no-save pg`):

```javascript
import pg from 'pg';
import { assertNonSuperuser } from '../packages/test-kit/dist/pg-roles.js';

const probe = async (label, url, expectThrow) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const executor = async (sql) => (await client.query(sql)).rows;
  try {
    await assertNonSuperuser(executor);
    console.log(`${label}: PASSED guard${expectThrow ? '  <-- UNEXPECTED (guard failed to discriminate)' : ' (expected)'}`);
  } catch (err) {
    console.log(`${label}: REJECTED by guard (${err.name})${expectThrow ? ' (expected)' : '  <-- UNEXPECTED'}`);
  } finally {
    await client.end();
  }
};

await probe('superuser connection', process.env.SUPERUSER_URL, true);
await probe('substrate_app connection', process.env.APP_URL, false);
```

Run with both URLs from conservation's env (PowerShell: `$env:SUPERUSER_URL='...'; $env:APP_URL='...'; node tmp/prove-pg-guard.mjs`).

- [ ] **Step 4: Record** — expected result: superuser REJECTED, substrate_app PASSED — the guard discriminates on a real RLS-bearing database. Record both outputs verbatim + the Postgres version for the runbook. Delete `tmp/` afterwards (it must not enter the PR).

---

### Task 10: Tune defaults from the findings (conditional)

**Files:**
- Possibly modify: `packages/test-kit/src/stryker.ts` + `packages/test-kit/src/stryker.spec.ts` (tier table)
- Possibly modify: `packages/lint-kit/src/knip/index.ts` + spec (preset entries)

- [ ] **Step 1:** If Task 8's verdict proposes different tier thresholds, or Task 7 revealed preset blind spots: update the table/preset AND the corresponding spec assertions together, run the package tests, commit as `fix(test-kit): tune mutation tier thresholds from the devloop prove-itself run` (or equivalent). If no tuning is warranted, record "defaults confirmed by prove-itself" for the runbook and skip.

---

### Task 11: Foundation push + PR (orchestrator: wave → post-findings → merge → publish → ritual)

- [ ] **Step 1: Push + PR** (body via `--body-file` — PS 5.1 mangles multi-line `--body`):

```bash
cd D:/development/projects/de-braighter/layers/foundation/.claude/worktrees/f5-quality-floor-kits
git push -u origin feat/f5-quality-floor-kits
gh pr create --repo de-braighter/foundation --title "feat(kits): F5 quality-floor battery — auditConfig, knipDomainPreset, defineStrykerConfig, assertNonSuperuser" --body-file <temp file>
```

PR body:

```text
## F5 — Quality-floor battery, kit layer (Foundry spec §5/§6)

Dependency-light config factories; each kills a named AI-harness failure mode (2026-06-09 audit):

- lint-kit 0.2.0: `auditConfig` (type-aware switch-exhaustiveness, default-masking off) → kills unmapped-error→500; `knipDomainPreset` (./knip subpath) → kills speculative generality (enforces ADR-176).
- test-kit 0.2.0: `defineStrykerConfig` (tier thresholds t0 report-only / t1 break 60 / t2 break 75) → kills test-theater; `assertNonSuperuser` + `appRoleSql` → kills isolation-untested-by-default (suites running as superuser bypass FORCE RLS).
- Prove-itself runs (spec §8) executed against domains/devloop (knip + Stryker) and domains/conservation (guard discriminates superuser vs substrate_app on a real RLS DB) — findings summarized below, full runbook lands with the workbench wiring PR.

<one-paragraph findings summary from Tasks 7-9>

Plan: docs/superpowers/plans/2026-06-10-foundry-f5-quality-floor.md (workbench)

Producer: orchestrator/claude-fable-5 [superpowers:writing-plans, superpowers:subagent-driven-development, superpowers:test-driven-development]
Effort: <declare what the PR actually got>
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then the orchestrator: foreground wave (**local-ci + reviewer + qa-engineer + charter-checker** — code repo; each prompt FORBIDS git checkout/stash/clean/reset in shared clones — inspect via `git -C <repo> fetch origin pull/N/head` + diff/show or own worktree), `post-findings` (FULL `de-braighter/foundation#<pr>`, severities `blocking|should-fix|nit|note`, paths anchored IN the diff) BEFORE pushing fix commits, merge, then:

- [ ] **Step 2: Publish** — `npm view @de-braighter/lint-kit versions` + `npm view @de-braighter/test-kit versions` (confirm 0.2.0 is new), then from the merged main: `npm run publish:lint-kit && npm run publish:test-kit`.
- [ ] **Step 3: Twin ritual** — `npm run dev -- drain de-braighter/foundation#<pr>` (devloop), backfill (FULL owner/repo), reconcile.
- [ ] **Step 4: Remove the foundation worktree.**

---

### Task 12: Workbench worktree + branch

- [ ] **Step 1:**

```bash
cd D:/development/projects/de-braighter
git fetch origin main
git worktree add .claude/worktrees/f5-quality-floor-wiring -b feat/f5-quality-floor-wiring origin/main
```

Never `git add -A` in the workbench (untracked WIP present). Explicit paths only.

---

### Task 13: `/new-domain` foundation-tier templates — born-with battery

**Files (all under the worktree):**
- Modify: `.claude/skills/new-domain/templates/foundation/package.json.tmpl`
- Create: `.claude/skills/new-domain/templates/foundation/eslint.config.mjs.tmpl`
- Create: `.claude/skills/new-domain/templates/foundation/knip.ts.tmpl`
- Create: `.claude/skills/new-domain/templates/foundation/libs/spine/stryker.config.mjs.tmpl`
- Create: `.claude/skills/new-domain/templates/foundation/libs/pack/stryker.config.mjs.tmpl`
- Modify: `.claude/skills/new-domain/templates/foundation/libs/spine/package.json.tmpl` + `libs/pack/package.json.tmpl` (add script)
- Modify: `.claude/skills/new-domain/templates/foundation/libs/spine/vitest.config.ts`, `libs/pack/vitest.config.ts`, `apps/api/vitest.config.ts`

- [ ] **Step 1: Verify version pins live** — `npm view knip version`, `npm view @stryker-mutator/vitest-runner version` + its `peerDependencies` (must accept vitest 4 — if not, pin the newest combination that works together and record it). Adjust the pins below if reality differs.

- [ ] **Step 2: Replace `templates/foundation/package.json.tmpl`** with:

```json
{
  "name": "@de-braighter/{{DOMAIN}}-workspace",
  "version": "0.0.0",
  "private": true,
  "description": "{{PURPOSE}}",
  "type": "module",
  "scripts": {
    "build":     "pnpm -r run build",
    "test":      "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "lint":      "eslint . --max-warnings=0",
    "quality:knip": "knip",
    "quality:knip:report": "knip --no-exit-code",
    "quality:mutation": "pnpm -r --if-present run quality:mutation",
    "ci:local":  "pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run quality:knip:report"
  },
  "devDependencies": {
    "@de-braighter/lint-kit": "^0.2.0",
    "@de-braighter/test-kit": "^0.2.0",
    "@stryker-mutator/core": "^9.0.0",
    "@stryker-mutator/vitest-runner": "^9.0.0",
    "@types/node": "^20.12.0",
    "@vitest/coverage-v8": "^4.0.9",
    "eslint": "^9.8.0",
    "knip": "^6.16.1",
    "typescript": "^5.6.0",
    "vitest": "^4.0.9"
  },
  "engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" },
  "packageManager": "pnpm@9.1.0"
}
```

(vitest 1.6.1 → ^4.0.9 is deliberate: test-kit's peer is `vitest ^4`, and newborn domains should be born current. The scaffold's live `ci:local` run in `/new-domain` Step 2 verifies the combination on first use.)

- [ ] **Step 3: Create `templates/foundation/eslint.config.mjs.tmpl`:**

```javascript
import { auditConfig, deBraighterPreset } from '@de-braighter/lint-kit/eslint';

export default [
  ...deBraighterPreset(),
  ...auditConfig({
    project: [
      'libs/{{DOMAIN}}-spine/tsconfig.json',
      'libs/{{DOMAIN}}-pack/tsconfig.json',
      'apps/{{DOMAIN}}-api/tsconfig.json',
    ],
    tsconfigRootDir: import.meta.dirname,
  }),
];
```

- [ ] **Step 4: Create `templates/foundation/knip.ts.tmpl`:**

```typescript
import { knipDomainPreset } from '@de-braighter/lint-kit/knip';

export default knipDomainPreset({ domain: '{{DOMAIN}}' });
```

- [ ] **Step 5: Create the two `stryker.config.mjs.tmpl`** (identical content, one under `libs/spine/`, one under `libs/pack/`):

```javascript
import { defineStrykerConfig } from '@de-braighter/test-kit/stryker';

// Tier comes from the product charter (docs/foundry/<key>/charter.md).
// t0 = report-only; t1 = break<60 fails; t2 = break<75 fails.
export default defineStrykerConfig({ tier: 't0' });
```

- [ ] **Step 6: Add the mutation script to both lib package.json.tmpl files** — Read each, add to its `"scripts"` object: `"quality:mutation": "stryker run"`.

- [ ] **Step 7: Replace the three template `vitest.config.ts` files** (spine, pack, api — identical content):

```typescript
import { defineConfig } from 'vitest/config';
import { defineBaseConfig } from '@de-braighter/test-kit/vitest-base';

export default defineConfig(defineBaseConfig());
```

- [ ] **Step 8: Commit**

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f5-quality-floor-wiring
git add .claude/skills/new-domain/templates/foundation
git commit -m "feat(new-domain): foundation templates carry the born-with quality floor (lint audit + knip + stryker tiers + coverage-wired vitest)"
```

---

### Task 14: `/new-domain` UI a11y template + SKILL.md wiring

**Files:**
- Create: `.claude/skills/new-domain/templates/ui/a11y.spec.example.ts`
- Modify: `.claude/skills/new-domain/SKILL.md`

- [ ] **Step 1: Create `templates/ui/a11y.spec.example.ts`** (Jasmine/Karma — what `ng test` runs; canonical patterns from the player-surfaces arc):

```typescript
// Canonical a11y battery (player-surfaces arc patterns) — copy next to each page
// component as `a11y.spec.ts` and adapt the imports/selectors. Kills the
// inaccessible-by-default failure mode. Structural checks only — color contrast
// and reduced-motion need a real browser pass (qa-engineer dimension 2).
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('a11y battery: AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('every label points at an existing control (label/for)', () => {
    for (const label of Array.from(root.querySelectorAll('label'))) {
      const forId = label.getAttribute('for');
      expect(forId)
        .withContext(`<label> "${label.textContent?.trim()}" needs a for attribute`)
        .toBeTruthy();
      expect(root.querySelector(`#${CSS.escape(forId ?? '')}`))
        .withContext(`label for="${forId}" has no matching control`)
        .toBeTruthy();
    }
  });

  it('anything acting as a button IS a button or link', () => {
    for (const el of Array.from(root.querySelectorAll('[role="button"]'))) {
      expect(['BUTTON', 'A'].includes(el.tagName))
        .withContext(`role="button" on <${el.tagName.toLowerCase()}> — use <button type="button">`)
        .toBeTrue();
    }
  });

  it('icon-only buttons carry an accessible name', () => {
    for (const btn of Array.from(root.querySelectorAll('button'))) {
      const hasText = (btn.textContent ?? '').trim().length > 0;
      const hasLabel = btn.hasAttribute('aria-label') || btn.hasAttribute('aria-labelledby');
      expect(hasText || hasLabel).withContext('icon-only <button> needs aria-label').toBeTrue();
    }
  });

  it('nothing autofocuses', () => {
    expect(root.querySelector('[autofocus]')).toBeNull();
  });

  it('interactive targets meet the 24px minimum (SC 2.5.8)', () => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a[href]'))) {
      const { height, width } = el.getBoundingClientRect();
      if (height === 0 && width === 0) continue; // not rendered in this fixture
      expect(height)
        .withContext(`<${el.tagName.toLowerCase()}> height ${height}px < 24px`)
        .toBeGreaterThanOrEqual(24);
      expect(width)
        .withContext(`<${el.tagName.toLowerCase()}> width ${width}px < 24px`)
        .toBeGreaterThanOrEqual(24);
    }
  });
});
```

- [ ] **Step 2: SKILL.md — "What this produces" upgrade.** Edit (old → new):

OLD:
```text
PRODUCES: workspace structure, substrate wiring, `GET /health` (+ `GET /readout` if
inference), green `ci:local`, workbench registration.
```
NEW:
```text
PRODUCES: workspace structure, substrate wiring, `GET /health` (+ `GET /readout` if
inference), the born-with quality floor (lint audit set + knip + tier-parameterized
Stryker + coverage-wired vitest base + a11y battery template — see Step 2b), green
`ci:local`, workbench registration.
```

- [ ] **Step 3: SKILL.md — Step 2 gate line.** Edit (old → new):

OLD:
```text
5. The shipped placeholder smoke tests are already green; run `pnpm run ci:local` — build +
   typecheck + test must pass.
```
NEW:
```text
5. The shipped placeholder smoke tests are already green; run `pnpm run ci:local` — build +
   typecheck + lint + test + knip report must pass (the quality floor ships with the
   foundation tier — see Step 2b).
```

- [ ] **Step 4: SKILL.md — insert Step 2b** (between the end of Step 2 and `### Step 3 — DB persistence tier (if selected)`):

```markdown
### Step 2b — Quality floor (always; born with the foundation tier)

The foundation templates ship the deterministic quality floor (Foundry spec §5) — every
product is born with it. Each gate kills a named AI-harness failure mode:

| Gate | Kills | Where |
|---|---|---|
| ESLint audit set (`auditConfig`: switch-exhaustiveness, no default-masking on unions) | unmapped-error→500 | `eslint.config.mjs` |
| knip (dead exports / unused deps) | speculative generality (ADR-176) | `knip.ts` + `quality:knip` |
| Stryker mutation testing, tier thresholds | test-theater | `libs/*/stryker.config.mjs` + `quality:mutation` |
| test-kit vitest base (lcov coverage) | silent coverage erosion | `*/vitest.config.ts` |
| Non-superuser DB tests (`assertNonSuperuser`) | broken-but-passing RLS / isolation-untested | DB tier (Step 3 gotchas) |
| a11y battery template | inaccessible-by-default UI | UI tier (Step 5) |

After scaffolding:
1. **Set the mutation tier from the product charter** (`docs/foundry/<key>/charter.md`
   risk tier): edit each `libs/*/stryker.config.mjs` → `defineStrykerConfig({ tier: 't0'|'t1'|'t2' })`.
   t0 is report-only (`break: null`); t1 breaks under 60; t2 under 75. No charter
   (non-Foundry domain) → t0 until the owner decides.
2. `quality:knip` (strict) is the wave-time / `qualityObligations` gate; `ci:local` runs
   the report mode (`--no-exit-code`) so a fresh scaffold is never blocked by a config
   false-positive — triage findings, don't suppress them.
3. **DB tier:** any DB-backed spec's global setup MUST call `assertNonSuperuser` from
   `@de-braighter/test-kit` on the same connection the tests use — superusers bypass
   FORCE RLS, so a suite running as superuser proves nothing:

   ```ts
   import { assertNonSuperuser } from '@de-braighter/test-kit';
   await assertNonSuperuser((sql) => appPrisma.$queryRawUnsafe(sql));
   ```
4. **UI tier:** copy the a11y battery next to each page component (Step 5 item 6).
```

- [ ] **Step 5: SKILL.md — Step 5 UI list gains item 6** (after item 5 `pnpm install at the root; npx ng build; live-verify the page in a browser.`):

```text
6. Copy `templates/ui/a11y.spec.example.ts` to `apps/{{DOMAIN}}-ui/src/app/a11y.spec.ts`
   (adapt the component import if renamed) — the canonical a11y battery
   (player-surfaces patterns); it runs with `ng test` in the workspace gate. Copy it
   again next to every page component you add later.
```

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/new-domain/templates/ui/a11y.spec.example.ts .claude/skills/new-domain/SKILL.md
git commit -m "feat(new-domain): Step 2b quality floor + UI a11y battery template"
```

---

### Task 15: reviewer.md — the seven failure modes, falsification mandate

**Files:**
- Modify: `.claude/agents/reviewer.md`

- [ ] **Step 1:** Insert a new section between `## Architecture drift — scan every kernel- or pack-touching diff` (after its last bullet, "**Convenience shortcut** …") and `## Constraints`:

```markdown
## The seven harness failure modes — falsify each (2026-06-09 audit)

Systematic failure modes of AI-harness-produced code that a 6-auditor audit proved
this wave MISSES when reviewers trust comments, coverage, and green tests. Walk all
seven on every code diff. REPRODUCE before you report: a concurrency/safety finding
you did not reproduce with a scratch script is a hypothesis, not a finding.

1. **Test theater** — a test that mocks the thing it asserts, or snapshots trivia.
   Ask: would this test FAIL on a real defect in the code under test? If the
   asserted SQL/string/behavior comes from a `vi.fn()`, the test asserts the mock,
   not the code → BLOCKING.
2. **Isolation untested by default** — DB/RLS/tenancy specs skipped without env, or
   running as a superuser (superusers bypass FORCE RLS — the suite proves nothing).
   Check which role the test connection uses; an RLS-touching suite without
   `assertNonSuperuser` (test-kit) or equivalent → BLOCKING.
3. **Unmapped reachable error → 500** — a reachable union member with no mapping
   case, masked by a `default:` branch. Where the audit lint
   (`switch-exhaustiveness`) isn't enabled, walk every `switch` over a
   discriminated union in the diff yourself.
4. **Lying / overclaiming comments** — treat EVERY comment as a claim to falsify
   against the code ("never throws", "total over the union", "used by X").
   False comment → SHOULD-FIX minimum; BLOCKING when it hides a safety gap.
5. **Broken-but-passing primitive** — tests pass but the operational semantics are
   wrong (e.g. a session-scoped `set_config` outside the transaction it must
   survive). Trace the runtime path, not the test path.
6. **Non-atomic security ops** — check-then-act on auth/token/credential state
   without a transaction or conditional update (TOCTOU). Trace adversarial
   interleavings on every concurrency/pooling/txn surface; reproduce, then report
   → BLOCKING when real.
7. **Speculative generality** — new public surface with zero consumers and no
   consuming story (violates ADR-176's demand-driven rule). knip output is
   evidence → SHOULD-FIX.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/reviewer.md
git commit -m "feat(agents): reviewer carries the 7 harness failure modes with a falsification + reproduction mandate"
```

---

### Task 16: qa-engineer.md — failure-mode pre-flight

**Files:**
- Modify: `.claude/agents/qa-engineer.md`

- [ ] **Step 1:** Insert a new section between the end of dimension 9 (after the last bullet "**Migration & versioning are safe.** …") and `## Output template`:

```markdown
## Harness failure-mode pre-flight (before the dimensions)

Seven systematic failure modes of AI-produced code (2026-06-09 audit) and the
deterministic gate that kills each. Verify the gate RAN for this change (output in
the PR, or reproduce locally) — a green wave without these gates has known blind
spots:

| # | Failure mode | Deterministic gate | Folds into |
|---|---|---|---|
| 1 | Test theater | Stryker mutation score per tier (`quality:mutation`) | dim 1 |
| 2 | Isolation untested by default | DB suite under a NOBYPASSRLS role (`assertNonSuperuser` in setup) | dim 1/9 |
| 3 | Unmapped error → 500 | `auditConfig` switch-exhaustiveness lint | dim 1 |
| 4 | Lying comments | reviewer falsification pass (no deterministic gate — confirm reviewer ran it) | dim 6 |
| 5 | Broken-but-passing primitive | integration tier exercises the real runtime path | dim 1/9 |
| 6 | Non-atomic security ops | reviewer adversarial-interleaving pass with reproduction | dim 9 |
| 7 | Speculative generality | knip (`quality:knip`) | dim 6/9 |

For repos not yet carrying the battery (no `quality:*` scripts), say so in
"What I did NOT check" — name the missing gates rather than silently passing.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/agents/qa-engineer.md
git commit -m "feat(agents): qa-engineer failure-mode pre-flight mapping the 7 modes to their deterministic gates"
```

---

### Task 17: Prove-itself runbook (REAL findings from Tasks 7–9)

**Files:**
- Create: `docs/superpowers/runbooks/2026-06-10-quality-floor-prove-itself.md`

- [ ] **Step 1: Write the runbook** from the captured Task 7/8/9 material — structure (every number REAL, no invented data; if a run was blocked, the blocker is the finding):

```markdown
# Quality-floor prove-itself — 2026-06-10 (Foundry F5, spec §8)

The battery ran against real repos BEFORE becoming a /new-domain default.

## A. knip on domains/devloop
- Tool/version, config used, runtime.
- Raw counts; triage table (finding → true-positive / false-positive: missing entry / config tweak → action).
- Verdict: report-mode-in-ci:local + strict-gate-as-obligation — workable? caveats?

## B. Stryker on domains/devloop
- Version pair chosen (vitest peer constraint), modules mutated + why, runtime.
- Score, killed/survived/timeout counts; surviving-mutant classes with examples.
- Verdict: t1 break=60 realistic? full-repo cost extrapolation; tuning applied (or "defaults confirmed").

## C. assertNonSuperuser on domains/conservation
- Postgres version; both probe outputs VERBATIM (superuser → rejected, substrate_app → passed).
- Verdict: guard discriminates on a real RLS DB.

## What changed because of this
<threshold/preset tuning, or "nothing — defaults confirmed">

## What this does NOT prove
<honest list: e.g. no Angular-repo knip run, no T2-scale mutation run, guard not yet wired into any existing repo's suite>
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/2026-06-10-quality-floor-prove-itself.md
git commit -m "docs(runbook): quality-floor prove-itself findings (knip+stryker on devloop, RLS guard on conservation)"
```

---

### Task 18: Plan copy + push + PR (workbench)

- [ ] **Step 1: Copy + commit the plan**

```powershell
Copy-Item "D:/development/projects/de-braighter/docs/superpowers/plans/2026-06-10-foundry-f5-quality-floor.md" "D:/development/projects/de-braighter/.claude/worktrees/f5-quality-floor-wiring/docs/superpowers/plans/"
```

```bash
cd D:/development/projects/de-braighter/.claude/worktrees/f5-quality-floor-wiring
git add docs/superpowers/plans/2026-06-10-foundry-f5-quality-floor.md
git commit -m "docs(plan): F5 quality-floor battery — gap decisions + 18-task plan"
```

- [ ] **Step 2: Push + PR** (after foundation 0.2.0 is published — the templates pin `^0.2.0`):

```bash
git push -u origin feat/f5-quality-floor-wiring
gh pr create --repo de-braighter/workbench --title "feat(new-domain+agents): F5 quality floor — born-with battery wiring + 7-failure-mode checklists" --body-file <temp file>
```

PR body:

```text
## F5 — Quality-floor battery, wiring layer (Foundry spec §5/§6)

- /new-domain: scaffolds are now BORN with the deterministic floor — lint audit set (auditConfig), knip (report in ci:local, strict as obligation gate), per-lib tier-parameterized Stryker, coverage-wired vitest base (was: NO eslint, vitest 1.6.1), UI a11y battery template, DB-tier assertNonSuperuser mandate. New Step 2b maps each gate to the failure mode it kills.
- Ceiling: reviewer.md gets the 7 harness failure modes with a falsification + reproduction mandate; qa-engineer.md gets the failure-mode→deterministic-gate pre-flight.
- Prove-itself runbook (spec §8): real findings from knip+Stryker on domains/devloop and the RLS-role guard on domains/conservation — gates proved BEFORE becoming defaults.
- Companion kit PR: de-braighter/foundation#<pr> (lint-kit 0.2.0 / test-kit 0.2.0, published).
- Plan: docs/superpowers/plans/2026-06-10-foundry-f5-quality-floor.md

Producer: orchestrator/claude-fable-5 [superpowers:writing-plans, superpowers:subagent-driven-development]
Effort: <declare what the PR actually got>
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then the orchestrator: foreground wave (reviewer + qa-engineer + charter-checker; prompts forbid git ops in shared clones), `post-findings` BEFORE fix commits, merge, twin ritual, worktree removal.

---

## Self-review notes (run during plan-writing)

- **Spec coverage:** §5 floor table — mutation/Stryker (Tasks 4, 13), knip (Tasks 3, 13), switch-exhaustiveness audit set (Tasks 2, 13), non-superuser role tests (Tasks 5, 14-Step-4-item-3), a11y battery for UI tiers (Task 14), coverage-delta + Sonar (gap decision 5: `defineBaseConfig` wired in Task 13 Step 7) → all present. §5 ceiling — reviewer/qa-engineer checklists (Tasks 15, 16; the devloop precision-feedback half of the ceiling is F6 territory, deliberately out of scope here). §6 row F5 deliverables — "lint-kit/test-kit extensions, /new-domain upgrade, audit checklists into verifier agents" → Tasks 2–6, 13–14, 15–16. §8 — battery proves itself on devloop/conservation BEFORE defaults (Tasks 7–10 run before the PRs land; runbook Task 17).
- **Placeholder scan:** the only intentionally-open values are execution-time facts (stryker/knip version pins verified live via `npm view`, the chosen devloop mutate modules, the real findings) — each marked with explicit record-it instructions; no "TBD"/"add validation" anywhere.
- **Type consistency:** `auditConfig`/`auditRuleIds`/`AuditOptions`, `knipDomainPreset`/`KnipConfig`/`KnipWorkspaceConfig`/`KnipDomainOptions`, `defineStrykerConfig`/`mutationTierThresholds`/`MutationTier`/`StrykerConfig(_Options)`/`StrykerThresholds`, `assertNonSuperuser`/`appRoleSql`/`SqlExecutor`/`SuperuserConnectionError`/`AppRoleSqlOptions` — identical across specs, impls, barrels, exports maps, templates, and skill snippets. Tier values `'t0'|'t1'|'t2'` lowercase everywhere (templates + SKILL.md included).
- **Risk register:** (a) stryker-vitest peer-range mismatch with vitest 4 → Task 13 Step 1 verifies live and adjusts pins; (b) template vitest 1.6→4 jump → scaffold-time `ci:local` live-verify catches it (and templates are only consumed at scaffold time); (c) conservation DB may not come up → Task 9 stops and records the blocker honestly (the runbook says so).
