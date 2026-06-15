# Substrate Typed DI Binding (`definePort` / `bindPort`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace untyped `Symbol`/`Symbol.for` DI tokens with a typed `definePort<T>()` + `bindPort()` API so a wrong implementation is a compile error and a missing binding is a named boot error, then migrate all ~27 `pack-kids-football` pack-owned tokens onto it.

**Architecture:** Two homes (ADR-236). A framework-free `definePort<T>` + branded `Port<T>` ship from `@de-braighter/substrate-contracts` (new `src/di/`); the NestJS helpers `bindPort` / `@InjectPort` / `assertPortsBound` ship from `@de-braighter/substrate-runtime/kit` (the Phase-1 barrel). `Port<T>` *is* a `symbol` (phantom brand), so existing `@Inject`/`{provide}`/`moduleRef.get` sites keep working and the full sweep is safe. A publish boundary separates the substrate build (Part A) from the consumer migration (Part B).

**Tech Stack:** TypeScript (ESM, `nodenext`, explicit `.js` imports), NestJS 10.4, Vitest, Nx, GitHub Packages.

**Reference docs:**
- Design spec: `docs/superpowers/specs/2026-06-15-substrate-dx-phase2-typed-di-binding-design.md`
- ADR: `layers/specs/adr/adr-236-typed-di-port-binding.md` (status `proposed`)
- Program roadmap: `docs/superpowers/plans/2026-06-14-substrate-dx-paved-road-program.md` (Phase 2)

---

## Execution prerequisites (read before Task A1)

- **Worktree isolation for Part A (binding — Phase-1 lesson).** A concurrent foundry/debt session can collide on the shared `layers/substrate` working tree. Run Part A in a dedicated worktree (`superpowers:using-git-worktrees`) with its own `npm ci`. Do NOT build Part A in the primary `layers/substrate` checkout if any other session might touch it.
- **Two repos, two PRs, a publish between them.** Part A lands + publishes `substrate-contracts@2.6.0` and `substrate-runtime@2.7.0` BEFORE Part B (exercir consumes substrate only via published packages — no `file:` link). Do not start Part B until the Part-A versions are on GitHub Packages.
- **Dual-identity test rule.** Assert DI resolution with `toBeDefined()`, NEVER `instanceof` (`Symbol.for` tokens match across the local-src↔published boundary; classes do not). Same-package imports stay relative with `.js`; cross-package imports use the bare specifier `@de-braighter/substrate-contracts` (no `.js`).
- **`nx lint` is whole-project on pre-push.** New code must add 0 lint errors.

## File structure

**Part A — `layers/substrate` (isolated worktree):**
- Create `libs/substrate-contracts/src/di/port.ts` — `Port<T>`, `definePort<T>`.
- Create `libs/substrate-contracts/src/di/port.spec.ts` — unit + type tests.
- Create `libs/substrate-contracts/src/di/index.ts` — barrel.
- Modify `libs/substrate-contracts/src/index.ts` — add `export * from './di/index.js';`.
- Modify `libs/substrate-contracts/package.json` — add `./di` subpath export; bump `version` → `2.6.0`.
- Create `libs/substrate-runtime/src/kit/bind-port.ts` — `bindPort<T>`.
- Create `libs/substrate-runtime/src/kit/bind-port.spec.ts`.
- Create `libs/substrate-runtime/src/kit/inject-port.ts` — `InjectPort<T>`.
- Create `libs/substrate-runtime/src/kit/assert-ports-bound.ts` — `assertPortsBound`.
- Create `libs/substrate-runtime/src/kit/assert-ports-bound.spec.ts`.
- Modify `libs/substrate-runtime/src/kit/index.ts` — add the three exports.
- Modify `libs/substrate-runtime/package.json` — bump `version` → `2.7.0`, dep `@de-braighter/substrate-contracts` → `^2.6.0`.

**Part B — `domains/exercir`:**
- Modify each `libs/pack-kids-football/src/out-ports/*.repository.ts` (6 files) + `libs/pack-kids-football/src/out-ports/tenant-runner.port.ts` — token def → `definePort`.
- Modify each `libs/pack-kids-football/src/in-ports/*.use-case.ts` (20 files) — token def → `definePort`.
- Modify `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` — bindings → `bindPort`.
- Modify the 5 controllers + `onboarding.service.ts` + the in-lib application services + Prisma repos — `@Inject` → `@InjectPort` (pack-defined tokens only).
- Modify `apps/pack-kids-football-api/src/main.ts` — add `assertPortsBound`.
- Modify `domains/exercir/package.json` — bump substrate dep ranges to the published Phase-2 versions.

---

# PART A — Substrate primitives (isolated worktree)

### Task A1: `definePort` / `Port<T>` in `substrate-contracts`

**Files:**
- Create: `libs/substrate-contracts/src/di/port.ts`
- Create: `libs/substrate-contracts/src/di/port.spec.ts`
- Create: `libs/substrate-contracts/src/di/index.ts`
- Modify: `libs/substrate-contracts/src/index.ts`
- Modify: `libs/substrate-contracts/package.json`

- [ ] **Step 1: Write the failing test**

Create `libs/substrate-contracts/src/di/port.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { definePort, type Port } from './port.js';

interface Greeter {
  greet(): string;
}

describe('definePort', () => {
  it('returns a symbol from the GLOBAL registry (same name → same symbol)', () => {
    const a = definePort<Greeter>('@de-braighter/test/GREETER');
    const b = definePort<Greeter>('@de-braighter/test/GREETER');
    expect(typeof a).toBe('symbol');
    expect(a).toBe(b); // Symbol.for global registry — dual-identity safe
    expect(a).toBe(Symbol.for('@de-braighter/test/GREETER'));
  });

  it('recovers the human name from the symbol description', () => {
    const p = definePort<Greeter>('@de-braighter/test/NAMED');
    expect(p.description).toBe('@de-braighter/test/NAMED');
  });

  it('is assignable to symbol (drops into @Inject / {provide} / moduleRef.get untouched)', () => {
    const p: Port<Greeter> = definePort<Greeter>('@de-braighter/test/ASSIGN');
    const asSymbol: symbol = p; // must compile — Port<T> IS a symbol
    expect(asSymbol).toBe(p);
  });

  it('carries the value type at the type level (compile-only brand)', () => {
    // Type assertion: a Port<Greeter> must NOT be assignable to Port<number>.
    const greeterPort = definePort<Greeter>('@de-braighter/test/BRAND');
    // @ts-expect-error — brands differ, so the assignment must fail to compile
    const wrong: Port<number> = greeterPort;
    expect(typeof greeterPort).toBe('symbol');
    void wrong;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd <worktree> && npx vitest run --config libs/substrate-contracts/vitest.config.ts src/di/port.spec.ts`
Expected: FAIL — `Cannot find module './port.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `libs/substrate-contracts/src/di/port.ts`:

```typescript
/**
 * Typed DI port primitive (ADR-236, substrate DX paved-road Phase 2).
 *
 * A `Port<T>` co-locates a DI token with the type of the value bound under it.
 * It IS a `symbol` (a phantom brand carries `T` only in the type system, never
 * at runtime), so every existing `@Inject` / `{ provide }` / `moduleRef.get`
 * site keeps working untouched — the NestJS helpers in
 * `@de-braighter/substrate-runtime/kit` (`bindPort` / `InjectPort` /
 * `assertPortsBound`) add the safety on top.
 *
 * Framework-free by construction (no NestJS, no new dependency) — it is DX
 * infrastructure, not a kernel concept (ADR-236 §kernel-orthogonality), so it
 * lives in the dependency-free contracts package where the kernel's own ports
 * are declared and where non-Nest consumers can reach it.
 */

declare const PORT_BRAND: unique symbol;

/** A DI token that carries the type `T` of the value bound under it. IS a `symbol`. */
export type Port<T> = symbol & { readonly [PORT_BRAND]: T };

/**
 * Define a typed DI token.
 *
 * Uses the GLOBAL symbol registry (`Symbol.for`), NOT `Symbol(name)`, so the
 * token matches across the local-src ↔ published-copy boundary (two `Symbol()`
 * calls never `===`). Because that registry is keyed by string, `name` MUST be
 * package-qualified — e.g. `'@de-braighter/pack-kids-football/DRILL_REPOSITORY'`
 * — or two ports alias the same symbol (ADR-236 D3; a candidate Phase-4 lint).
 */
export function definePort<T>(name: string): Port<T> {
  return Symbol.for(name) as Port<T>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config libs/substrate-contracts/vitest.config.ts src/di/port.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the barrel + subpath export**

Create `libs/substrate-contracts/src/di/index.ts`:

```typescript
export * from './port.js';
```

Add to `libs/substrate-contracts/src/index.ts` (after the existing `// Field encryption` block):

```typescript
// Typed DI port primitive (ADR-236)
export * from './di/index.js';
```

In `libs/substrate-contracts/package.json`, add a `./di` entry to `exports` (after `./reproducibility`, mirroring the existing subpath shape):

```json
    "./di": {
      "types": "./dist/di/index.d.ts",
      "import": "./dist/di/index.js",
      "default": "./dist/di/index.js"
    },
```

- [ ] **Step 6: Build contracts and verify it compiles + exports**

Run: `npx nx build substrate-contracts`
Expected: build succeeds; `dist/di/index.js` and `dist/di/index.d.ts` exist.

- [ ] **Step 7: Commit**

```bash
git add libs/substrate-contracts/src/di libs/substrate-contracts/src/index.ts libs/substrate-contracts/package.json
git commit -m "feat(contracts): definePort/Port<T> typed DI primitive (ADR-236)"
```

---

### Task A2: `bindPort` in the kit (compile-time impl check)

**Files:**
- Create: `libs/substrate-runtime/src/kit/bind-port.ts`
- Create: `libs/substrate-runtime/src/kit/bind-port.spec.ts`
- Modify: `libs/substrate-runtime/src/kit/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/substrate-runtime/src/kit/bind-port.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { definePort } from '@de-braighter/substrate-contracts';
import { bindPort } from './bind-port.js';

interface Greeter {
  greet(): string;
}
const GREETER = definePort<Greeter>('@de-braighter/test/kit/GREETER');

class RealGreeter implements Greeter {
  greet(): string {
    return 'hi';
  }
}
class NotAGreeter {
  nope(): number {
    return 1;
  }
}

describe('bindPort', () => {
  it('produces a provider whose `provide` is the port symbol', () => {
    const p = bindPort(GREETER, { useClass: RealGreeter }) as { provide: unknown };
    expect(p.provide).toBe(GREETER);
  });

  it('resolves the bound value through Nest DI (toBeDefined — no instanceof, dual identity)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [bindPort(GREETER, { useClass: RealGreeter })],
    }).compile();
    expect(moduleRef.get(GREETER)).toBeDefined();
  });

  it('rejects an implementation that does not satisfy the port type (COMPILE proof)', () => {
    // @ts-expect-error — NotAGreeter is not a Greeter, so useClass must not type-check
    bindPort(GREETER, { useClass: NotAGreeter });
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/bind-port.spec.ts`
Expected: FAIL — `Cannot find module './bind-port.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `libs/substrate-runtime/src/kit/bind-port.ts`:

```typescript
import type { Provider, Scope, Type } from '@nestjs/common';
import type { Port } from '@de-braighter/substrate-contracts';

/**
 * The binding spec for {@link bindPort}. The `useClass` / `useValue` /
 * `useFactory` / `useExisting` variant is constrained to the port's type `T`,
 * so a drifted implementation is a TYPE ERROR at the binding site (ADR-236 D4).
 * `scope` / `durable` flow through for request-scoped providers (the
 * kids-football repos are request-scoped in both modes).
 */
export type BindSpec<T> = (
  | { useClass: Type<T> }
  | { useValue: T }
  | { useFactory: (...args: never[]) => T | Promise<T>; inject?: unknown[] }
  | { useExisting: Type<T> | symbol }
) & { scope?: Scope; durable?: boolean };

/**
 * Bind a typed port to an implementation, returning a NestJS `Provider`. The
 * compile-time win: `useClass: Type<T>` / `useValue: T` / `useFactory => T`
 * force the implementation to satisfy the port's interface.
 */
export function bindPort<T>(port: Port<T>, spec: BindSpec<T>): Provider {
  return { provide: port, ...spec } as Provider;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/bind-port.spec.ts`
Expected: PASS (3 tests). The `@ts-expect-error` test passes only because the wrong-impl line genuinely fails to type-check.

- [ ] **Step 5: Export from the kit barrel**

Add to `libs/substrate-runtime/src/kit/index.ts`:

```typescript
export * from './bind-port.js';
```

- [ ] **Step 6: Commit**

```bash
git add libs/substrate-runtime/src/kit/bind-port.ts libs/substrate-runtime/src/kit/bind-port.spec.ts libs/substrate-runtime/src/kit/index.ts
git commit -m "feat(kit): bindPort — compile-checked typed DI binding (ADR-236)"
```

---

### Task A3: `@InjectPort` in the kit

**Files:**
- Create: `libs/substrate-runtime/src/kit/inject-port.ts`
- Append tests to: `libs/substrate-runtime/src/kit/bind-port.spec.ts` (same DI fixture)
- Modify: `libs/substrate-runtime/src/kit/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/substrate-runtime/src/kit/bind-port.spec.ts` (add the import at top: `import { InjectPort } from './inject-port.js';` and `import { Injectable } from '@nestjs/common';`):

```typescript
describe('InjectPort', () => {
  it('injects the bound value (resolves through Nest DI)', async () => {
    @Injectable()
    class Consumer {
      constructor(@InjectPort(GREETER) readonly greeter: Greeter) {}
    }
    const moduleRef = await Test.createTestingModule({
      providers: [bindPort(GREETER, { useClass: RealGreeter }), Consumer],
    }).compile();
    expect(moduleRef.get(Consumer).greeter).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/bind-port.spec.ts`
Expected: FAIL — `Cannot find module './inject-port.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `libs/substrate-runtime/src/kit/inject-port.ts`:

```typescript
import { Inject } from '@nestjs/common';
import type { Port } from '@de-braighter/substrate-contracts';

/**
 * Inject a typed port. Equivalent to `@Inject(port)` with a port-typed
 * signature. NOTE (ADR-236 D4): a TS parameter decorator CANNOT rewrite the
 * declared param type, so `repo: DrillRepository` is still hand-written and
 * could drift from the port's `T` — that gap is closed by a Phase-4 lint rule
 * (`param type === port T`), not here.
 */
export function InjectPort<T>(port: Port<T>): ParameterDecorator {
  return Inject(port);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/bind-port.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the kit barrel + commit**

Add to `libs/substrate-runtime/src/kit/index.ts`: `export * from './inject-port.js';`

```bash
git add libs/substrate-runtime/src/kit/inject-port.ts libs/substrate-runtime/src/kit/bind-port.spec.ts libs/substrate-runtime/src/kit/index.ts
git commit -m "feat(kit): InjectPort — typed @Inject wrapper (ADR-236)"
```

---

### Task A4: `assertPortsBound` in the kit (named boot error + scoped-provider tolerance)

**Files:**
- Create: `libs/substrate-runtime/src/kit/assert-ports-bound.ts`
- Create: `libs/substrate-runtime/src/kit/assert-ports-bound.spec.ts`
- Modify: `libs/substrate-runtime/src/kit/index.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/substrate-runtime/src/kit/assert-ports-bound.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { Injectable, Scope } from '@nestjs/common';
import { definePort } from '@de-braighter/substrate-contracts';
import { bindPort } from './bind-port.js';
import { assertPortsBound } from './assert-ports-bound.js';

interface Repo {
  find(): string;
}
const REPO = definePort<Repo>('@de-braighter/test/assert/REPO');
const MISSING = definePort<Repo>('@de-braighter/test/assert/MISSING');
const SCOPED = definePort<Repo>('@de-braighter/test/assert/SCOPED');

@Injectable()
class RealRepo implements Repo {
  find(): string {
    return 'x';
  }
}

describe('assertPortsBound', () => {
  it('passes when every listed port is bound', async () => {
    const app = await Test.createTestingModule({
      providers: [bindPort(REPO, { useClass: RealRepo })],
    }).compile();
    expect(() => assertPortsBound(app, [REPO])).not.toThrow();
  });

  it('throws a NAMED error for an unbound port', async () => {
    const app = await Test.createTestingModule({
      providers: [bindPort(REPO, { useClass: RealRepo })],
    }).compile();
    expect(() => assertPortsBound(app, [REPO, MISSING])).toThrowError(
      /@de-braighter\/test\/assert\/MISSING/,
    );
  });

  it('treats a REQUEST-scoped provider as bound (does not false-positive)', async () => {
    const app = await Test.createTestingModule({
      providers: [bindPort(SCOPED, { useClass: RealRepo, scope: Scope.REQUEST })],
    }).compile();
    expect(() => assertPortsBound(app, [SCOPED])).not.toThrow();
  });

  it('treats a provider bound to `undefined` as missing', async () => {
    const app = await Test.createTestingModule({
      providers: [bindPort(REPO, { useValue: undefined as unknown as Repo })],
    }).compile();
    expect(() => assertPortsBound(app, [REPO])).toThrowError(/REPO/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/assert-ports-bound.spec.ts`
Expected: FAIL — `Cannot find module './assert-ports-bound.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `libs/substrate-runtime/src/kit/assert-ports-bound.ts`:

```typescript
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception.js';
import type { INestApplicationContext } from '@nestjs/common';
import type { Port } from '@de-braighter/substrate-contracts';

/**
 * Boot-time assertion that every listed port resolves. Call once in `main.ts`
 * after `NestFactory.create(AppModule)` with the app's REQUIRED ports.
 *
 * The rule (ADR-236 D5): only `UnknownElementException` (no provider for the
 * token) means MISSING. A resolved value means bound; ANY OTHER throw — notably
 * the request-scoped-provider error from `.get()` on a `Scope.REQUEST` provider
 * — means the provider IS registered (just scoped), so it counts as bound. This
 * is essential because the kids-football repos are request-scoped. A provider
 * explicitly bound to `undefined`/`null` counts as missing.
 *
 * Throws a single aggregated, NAMED error listing every unbound port. Designed
 * to compose into Phase 4's `assertSubstrateSafety()`.
 */
export function assertPortsBound(
  app: INestApplicationContext,
  ports: readonly Port<unknown>[],
): void {
  const missing: string[] = [];
  for (const port of ports) {
    try {
      const resolved = app.get(port, { strict: false });
      if (resolved === undefined || resolved === null) {
        missing.push(String(port.description ?? port.toString()));
      }
    } catch (err: unknown) {
      if (err instanceof UnknownElementException) {
        missing.push(String(port.description ?? port.toString()));
      }
      // any other throw (e.g. scoped-provider) → registered → bound → skip
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Substrate: ${missing.length} required port(s) not bound:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\nDid you forget bindPort(<port>, { useClass | useValue | useFactory }) in your module?`,
    );
  }
}
```

> **Implementer note:** if the deep import path `@nestjs/core/errors/exceptions/unknown-element.exception.js` does not resolve under this NestJS 10.4 build, fall back to a name check: `(err as { constructor?: { name?: string } })?.constructor?.name === 'UnknownElementException'`. Verify which resolves before finalizing; keep the `instanceof` form if it works (it is the robust one).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/kit/assert-ports-bound.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the kit barrel + commit**

Add to `libs/substrate-runtime/src/kit/index.ts`: `export * from './assert-ports-bound.js';`

```bash
git add libs/substrate-runtime/src/kit/assert-ports-bound.ts libs/substrate-runtime/src/kit/assert-ports-bound.spec.ts libs/substrate-runtime/src/kit/index.ts
git commit -m "feat(kit): assertPortsBound — named boot error, scoped-provider tolerant (ADR-236)"
```

---

### Task A5: version bumps + whole-repo green

**Files:**
- Modify: `libs/substrate-contracts/package.json` (`version` → `2.6.0`)
- Modify: `libs/substrate-runtime/package.json` (`version` → `2.7.0`; dep `@de-braighter/substrate-contracts` → `^2.6.0`)

- [ ] **Step 1: Apply the version bumps** (contracts `2.5.0`→`2.6.0`; runtime `2.6.0`→`2.7.0`; runtime's contracts dep `^2.5.0`→`^2.6.0`). All changes are additive → minor bumps; no migration doc needed.

- [ ] **Step 2: Run the full local gate**

Run: `npm run ci:local`
Expected: `nx run-many -t build lint` green for both packages, then `nx run-many -t test --parallel=1` green (includes the 4 new specs). Fix any whole-project lint errors (pre-push `nx lint` is whole-project).

- [ ] **Step 3: Commit**

```bash
git add libs/substrate-contracts/package.json libs/substrate-runtime/package.json
git commit -m "chore(substrate): bump contracts 2.6.0 + runtime 2.7.0 for typed-DI (ADR-236)"
```

- [ ] **Step 4: PR + verifier wave + merge (orchestrator-driven, outside the worktree task loop)**
  - Open the PR FIRST (per the twin ritual), body carrying `Producer:` / `Effort: standard` / `Effect: cycle-time …` / `Effect: findings …`.
  - Run the verifier wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, all `isolation: "worktree"`). **`charter-checker` MUST adjudicate the ADR-236 kernel-orthogonality claim** (the `contracts` addition is framework-free / dependency-free / stores nothing / authors no kernel concept).
  - `drain substrate#<pr>`, write findings JSON, `post-findings` before merge; merge; `backfill` + `reconcile`.

### Task A6: publish (after Part-A merge to `main`)

- [ ] **Step 1:** Ensure `GITHUB_TOKEN` (classic PAT, `write:packages`) is set.
- [ ] **Step 2:** `npm run publish:contracts` (guard-version → build → publish `@de-braighter/substrate-contracts@2.6.0`).
- [ ] **Step 3:** `npm run publish:runtime` (publish `@de-braighter/substrate-runtime@2.7.0`).
- [ ] **Step 4:** Confirm both versions resolve: `npm view @de-braighter/substrate-runtime@2.7.0 version`.

> **GATE:** Do not begin Part B until A6 confirms both versions are published.

---

# PART B — `pack-kids-football` full token sweep (`domains/exercir`)

> Work on a branch in `domains/exercir`. Every transformation below preserves the symbol identity of each token, so the lib keeps building between steps.

### Task B1: bump exercir's substrate deps to the published Phase-2 versions

**Files:** Modify `domains/exercir/package.json`.

- [ ] **Step 1:** Set `@de-braighter/substrate-contracts` → `^2.6.0` and `@de-braighter/substrate-runtime` → `^2.7.0` (match the current range style; these are the versions A6 published).
- [ ] **Step 2:** Run `GITHUB_TOKEN=… npm install` (the `@de-braighter` scope needs the token).
- [ ] **Step 3:** Verify nothing broke before any code change: `npx nx build pack-kids-football && npx nx build pack-kids-football-api`. Expected: both green.
- [ ] **Step 4:** Commit. `git commit -am "chore(kids-football): adopt substrate-contracts 2.6.0 + runtime 2.7.0"`

### Task B2: migrate the 6 repository token definitions to `definePort`

**Files (one edit each):**
- `libs/pack-kids-football/src/out-ports/member.repository.ts:60`
- `libs/pack-kids-football/src/out-ports/team.repository.ts:59`
- `libs/pack-kids-football/src/out-ports/resource.repository.ts:60`
- `libs/pack-kids-football/src/out-ports/slot.repository.ts:73`
- `libs/pack-kids-football/src/out-ports/club.repository.ts:43`
- `libs/pack-kids-football/src/out-ports/drill.repository.ts:64`

- [ ] **Step 1: Apply the identical transformation to each.** For each file, the interface (e.g. `DrillRepository`) is declared just above the token. Add the import and replace the token line. Example for `drill.repository.ts` — apply the same shape to all 6, substituting the interface name and the qualified token string:

```typescript
// at the top of the file (with the other imports)
import { definePort } from '@de-braighter/substrate-contracts';

// replace: export const DRILL_REPOSITORY = Symbol('DRILL_REPOSITORY');
export const DRILL_REPOSITORY = definePort<DrillRepository>(
  '@de-braighter/pack-kids-football/DRILL_REPOSITORY',
);
```

Mapping (token → interface → qualified name):
| File | Token | Interface | Qualified name |
|---|---|---|---|
| member.repository.ts | `MEMBER_REPOSITORY` | `MemberRepository` | `@de-braighter/pack-kids-football/MEMBER_REPOSITORY` |
| team.repository.ts | `TEAM_REPOSITORY` | `TeamRepository` | `@de-braighter/pack-kids-football/TEAM_REPOSITORY` |
| resource.repository.ts | `RESOURCE_REPOSITORY` | `ResourceRepository` | `@de-braighter/pack-kids-football/RESOURCE_REPOSITORY` |
| slot.repository.ts | `SLOT_REPOSITORY` | `SlotRepository` | `@de-braighter/pack-kids-football/SLOT_REPOSITORY` |
| club.repository.ts | `CLUB_REPOSITORY` | `ClubRepository` | `@de-braighter/pack-kids-football/CLUB_REPOSITORY` |
| drill.repository.ts | `DRILL_REPOSITORY` | `DrillRepository` | `@de-braighter/pack-kids-football/DRILL_REPOSITORY` |

- [ ] **Step 2: Build the lib.** Run `npx nx build pack-kids-football`. Expected: green (tokens are still symbols; nothing downstream breaks yet).
- [ ] **Step 3: Commit.** `git commit -am "refactor(kids-football): repository tokens → definePort (ADR-236)"`

### Task B3: migrate the 20 use-case token definitions to `definePort`

**Files:** the 20 `libs/pack-kids-football/src/in-ports/*.use-case.ts` files (lines per the inventory below).

- [ ] **Step 1: Apply the identical transformation to each** (same shape as B2, substituting interface + qualified name). Pattern:

```typescript
import { definePort } from '@de-braighter/substrate-contracts';
// replace: export const LIST_DRILLS_USE_CASE = Symbol('LIST_DRILLS_USE_CASE');
export const LIST_DRILLS_USE_CASE = definePort<ListDrillsUseCase>(
  '@de-braighter/pack-kids-football/LIST_DRILLS_USE_CASE',
);
```

Full list (token / interface / file): `LIST_MEMBERS_USE_CASE`·`ListMembersUseCase`·`list-members.use-case.ts`; `CREATE_MEMBER_USE_CASE`·`CreateMemberUseCase`·`create-member.use-case.ts`; `UPDATE_MEMBER_USE_CASE`·`UpdateMemberUseCase`·`update-member.use-case.ts`; `DELETE_MEMBER_USE_CASE`·`DeleteMemberUseCase`·`delete-member.use-case.ts`; `LIST_TEAMS_USE_CASE`·`ListTeamsUseCase`·`list-teams.use-case.ts`; `CREATE_TEAM_USE_CASE`·`CreateTeamUseCase`·`create-team.use-case.ts`; `UPDATE_TEAM_USE_CASE`·`UpdateTeamUseCase`·`update-team.use-case.ts`; `DELETE_TEAM_USE_CASE`·`DeleteTeamUseCase`·`delete-team.use-case.ts`; `LIST_RESOURCES_USE_CASE`·`ListResourcesUseCase`·`list-resources.use-case.ts`; `CREATE_RESOURCE_USE_CASE`·`CreateResourceUseCase`·`create-resource.use-case.ts`; `UPDATE_RESOURCE_USE_CASE`·`UpdateResourceUseCase`·`update-resource.use-case.ts`; `DELETE_RESOURCE_USE_CASE`·`DeleteResourceUseCase`·`delete-resource.use-case.ts`; `LIST_SLOTS_USE_CASE`·`ListSlotsUseCase`·`list-slots.use-case.ts`; `CREATE_SLOT_USE_CASE`·`CreateSlotUseCase`·`create-slot.use-case.ts`; `UPDATE_SLOT_USE_CASE`·`UpdateSlotUseCase`·`update-slot.use-case.ts`; `DELETE_SLOT_USE_CASE`·`DeleteSlotUseCase`·`delete-slot.use-case.ts`; `LIST_DRILLS_USE_CASE`·`ListDrillsUseCase`·`list-drills.use-case.ts`; `CREATE_DRILL_USE_CASE`·`CreateDrillUseCase`·`create-drill.use-case.ts`; `UPDATE_DRILL_USE_CASE`·`UpdateDrillUseCase`·`update-drill.use-case.ts`; `DELETE_DRILL_USE_CASE`·`DeleteDrillUseCase`·`delete-drill.use-case.ts`.

- [ ] **Step 2: Build the lib.** `npx nx build pack-kids-football`. Expected: green.
- [ ] **Step 3: Commit.** `git commit -am "refactor(kids-football): use-case tokens → definePort (ADR-236)"`

### Task B4: migrate the `TENANT_RUNNER` token definition

**File:** `libs/pack-kids-football/src/out-ports/tenant-runner.port.ts:494`.

- [ ] **Step 1:** Replace `export const TENANT_RUNNER = Symbol('TENANT_RUNNER');` (or `Symbol.for(...)`) with:

```typescript
import { definePort } from '@de-braighter/substrate-contracts';
export const TENANT_RUNNER = definePort<TenantRunner>(
  '@de-braighter/pack-kids-football/TENANT_RUNNER',
);
```

> If `TENANT_RUNNER` turns out to be re-exported from substrate rather than truly pack-defined, STOP and leave it as-is (substrate tokens are out of scope) — verify by checking whether the interface `TenantRunner` is declared in this file vs. imported from `@de-braighter/substrate-*`.

- [ ] **Step 2: Build + commit.** `npx nx build pack-kids-football` (green) → `git commit -am "refactor(kids-football): TENANT_RUNNER token → definePort (ADR-236)"`

### Task B5: rewrite the provider bindings to `bindPort`

**File:** `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (provider array ~lines 595–694; Prisma branch ~471–522; DB module `forRoot` ~570–589).

- [ ] **Step 1: Add the import.** `import { bindPort } from '@de-braighter/substrate-runtime/kit';`

- [ ] **Step 2: Rewrite each binding.** Transformations (preserve `scope`/`inject` exactly):
  - Repository (in-memory, request-scoped) `{ provide: DRILL_REPOSITORY, useFactory: () => new InMemoryDrillRepository(...), scope: Scope.REQUEST, inject: [...] }` → `bindPort(DRILL_REPOSITORY, { useFactory: () => new InMemoryDrillRepository(...), scope: Scope.REQUEST, inject: [...] })`. Apply to all 6 repos.
  - Repository (Prisma branch) `{ provide: DRILL_REPOSITORY, useExisting: PrismaDrillRepository }` → `bindPort(DRILL_REPOSITORY, { useExisting: PrismaDrillRepository })`. Apply to all 6.
  - Use-case `{ provide: LIST_DRILLS_USE_CASE, useExisting: ListDrillsService }` → `bindPort(LIST_DRILLS_USE_CASE, { useExisting: ListDrillsService })`. Apply to all 20.
  - `TENANT_RUNNER` factory in `PackKidsFootballDbModule.forRoot()` → `bindPort(TENANT_RUNNER, { useFactory: …, scope: Scope.REQUEST, inject: [...] })`.

  > If any `useClass`/`useExisting` now produces a TYPE ERROR, that is `bindPort` doing its job — the implementation drifted from the port interface. Fix the implementation (or the port), do not cast it away.

- [ ] **Step 3: Build + test.** `npx nx build pack-kids-football-api && npx nx test pack-kids-football-api`. Expected: green (the e2e suite exercises the real DI graph).
- [ ] **Step 4: Commit.** `git commit -am "refactor(kids-football): bindings → bindPort (ADR-236)"`

### Task B6: rewrite `@Inject` → `@InjectPort` at pack-defined-token sites

**Files (pack-defined tokens ONLY — leave substrate tokens `PACK_ROLE_ASSIGNMENT_REPOSITORY`/`TENANT_REGISTRY` as `@Inject`):**
- `apps/pack-kids-football-api/src/app/members.controller.ts:64–71`, `teams.controller.ts:59–66`, `resources.controller.ts:59–66`, `slots.controller.ts:59–66`, `drills.controller.ts:58–65`
- `apps/pack-kids-football-api/src/app/onboarding.service.ts:97,99,101,103,105,107` (CLUB/DRILL repo + the 4 create use-cases)
- `libs/pack-kids-football/src/application/*.service.ts` (each injects its repository token, e.g. `create-member.service.ts:28`)
- the Prisma repos that inject `TENANT_RUNNER` (e.g. `libs/pack-kids-football/src/out-adapters/prisma-drill.repository.ts:77`)

- [ ] **Step 1:** In each file, add `import { InjectPort } from '@de-braighter/substrate-runtime/kit';` and replace `@Inject(TOKEN)` → `@InjectPort(TOKEN)` for pack-defined tokens only. Leave the declared param types unchanged (the type-drift check is Phase 4). Remove the now-unused `Inject` import only if no substrate-token `@Inject` remains in the file.
- [ ] **Step 2: Build + test the lib and the api.** `npx nx build pack-kids-football pack-kids-football-api && npx nx test pack-kids-football pack-kids-football-api`. Expected: green.
- [ ] **Step 3: Commit.** `git commit -am "refactor(kids-football): @Inject → @InjectPort at pack-token sites (ADR-236)"`

### Task B7: wire `assertPortsBound` into `main.ts`

**File:** `apps/pack-kids-football-api/src/main.ts`.

- [ ] **Step 1: Add the import + call.** After `const app = await NestFactory.create(AppModule);` (before `app.listen`):

```typescript
import { assertPortsBound } from '@de-braighter/substrate-runtime/kit';
import {
  MEMBER_REPOSITORY, TEAM_REPOSITORY, RESOURCE_REPOSITORY, SLOT_REPOSITORY,
  CLUB_REPOSITORY, DRILL_REPOSITORY,
  LIST_MEMBERS_USE_CASE, CREATE_MEMBER_USE_CASE, UPDATE_MEMBER_USE_CASE, DELETE_MEMBER_USE_CASE,
  LIST_TEAMS_USE_CASE, CREATE_TEAM_USE_CASE, UPDATE_TEAM_USE_CASE, DELETE_TEAM_USE_CASE,
  LIST_RESOURCES_USE_CASE, CREATE_RESOURCE_USE_CASE, UPDATE_RESOURCE_USE_CASE, DELETE_RESOURCE_USE_CASE,
  LIST_SLOTS_USE_CASE, CREATE_SLOT_USE_CASE, UPDATE_SLOT_USE_CASE, DELETE_SLOT_USE_CASE,
  LIST_DRILLS_USE_CASE, CREATE_DRILL_USE_CASE, UPDATE_DRILL_USE_CASE, DELETE_DRILL_USE_CASE,
} from '@de-braighter/pack-kids-football';

// ...after NestFactory.create:
assertPortsBound(app, [
  MEMBER_REPOSITORY, TEAM_REPOSITORY, RESOURCE_REPOSITORY, SLOT_REPOSITORY, CLUB_REPOSITORY, DRILL_REPOSITORY,
  LIST_MEMBERS_USE_CASE, CREATE_MEMBER_USE_CASE, UPDATE_MEMBER_USE_CASE, DELETE_MEMBER_USE_CASE,
  LIST_TEAMS_USE_CASE, CREATE_TEAM_USE_CASE, UPDATE_TEAM_USE_CASE, DELETE_TEAM_USE_CASE,
  LIST_RESOURCES_USE_CASE, CREATE_RESOURCE_USE_CASE, UPDATE_RESOURCE_USE_CASE, DELETE_RESOURCE_USE_CASE,
  LIST_SLOTS_USE_CASE, CREATE_SLOT_USE_CASE, UPDATE_SLOT_USE_CASE, DELETE_SLOT_USE_CASE,
  LIST_DRILLS_USE_CASE, CREATE_DRILL_USE_CASE, UPDATE_DRILL_USE_CASE, DELETE_DRILL_USE_CASE,
]);
```

> **Do NOT include `TENANT_RUNNER`** in this list — it is bound only when `PACK_KIDS_FOOTBALL_DB=true`, so asserting it unconditionally would false-positive in the default in-memory mode. (The 26 repos + use-cases are bound in BOTH modes.)

- [ ] **Step 2: Build + boot-smoke.** `npx nx build pack-kids-football-api`, then run the API once (`PORT=3150 node dist/main.js` or the serve target) and confirm it boots without an "unbound port" throw. Run `npx nx test pack-kids-football-api` (e2e green).
- [ ] **Step 3: Commit.** `git commit -am "feat(kids-football): assertPortsBound at boot for all 26 required ports (ADR-236)"`

### Task B8: PR + verifier wave + twin ritual (orchestrator-driven)

- [ ] Open the exercir PR FIRST; body carries `Producer:` / `Effort: standard` / `Effect: cycle-time …` / `Effect: findings …`.
- [ ] Verifier wave with `isolation: "worktree"`: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + **`exercir-charter-checker`** (domains/exercir PR).
- [ ] `drain exercir#<pr>` → findings JSON → `post-findings` before merge → merge → `backfill` + `reconcile`.
- [ ] **Phase-2 exit check:** the kit's `@ts-expect-error` (compile proof) + `assertPortsBound` named-throw test (boot proof) are green, AND `pack-kids-football` + `pack-kids-football-api` build + test + boot green on the typed tokens.

---

## Self-review

**Spec coverage (every spec section → a task):**
- `definePort`/`Port<T>` (contracts, branded symbol, Symbol.for, namespacing) → A1. ✓
- `bindPort` (compile-checked) → A2. ✓
- `@InjectPort` (+ documented Phase-4 limitation) → A3. ✓
- `assertPortsBound` (named throw + scoped-provider tolerance) → A4. ✓
- Two-homes split + version/publish boundary → A1 (contracts), A2–A4 (kit), A5–A6. ✓
- Full ~27-token sweep + main.ts assert → B2–B7. ✓
- Testing exit (compile proof + boot proof, `toBeDefined` not `instanceof`) → A2 step 1 (`@ts-expect-error`), A4 step 1 (named throw), B5–B7 (reference green). ✓
- Banked gaps stay banked → not built (no task). ✓
- Governance (designer-first ADR done; charter-checker on PR; wave; twin ritual) → A5 step 4, B8. ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to". The 27-token sweep is enumerated explicitly (B2/B3 tables + B6 site list), not deferred. The one `> Implementer note` (NestJS deep-import fallback) is a real, bounded contingency with both branches specified, not a placeholder.

**Type consistency:** `Port<T>`, `definePort<T>(name): Port<T>`, `bindPort<T>(port, spec): Provider`, `InjectPort<T>(port): ParameterDecorator`, `assertPortsBound(app, ports): void`, `BindSpec<T>` — names + signatures consistent across A1→A4 and reused unchanged in B5/B6/B7.

**Known risk flagged for execution:** the `UnknownElementException` import path (A4) is the one uncertainty; the task carries a verified fallback. The `bindPort` `scope`-passthrough (A2 `BindSpec`) is required by the request-scoped kids-football repos (B5) — they are linked.
