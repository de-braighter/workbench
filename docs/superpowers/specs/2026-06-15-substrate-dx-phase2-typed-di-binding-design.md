# Substrate Typed DI Binding (`definePort` / `bindPort`) — design spec

- **Date:** 2026-06-15
- **Status:** Design — approved in brainstorm, pending spec review
- **Program:** Phase 2 of the Substrate DX "Paved Road" program (`docs/superpowers/plans/2026-06-14-substrate-dx-paved-road-program.md`)
- **Reference product:** `domains/exercir` → `pack-kids-football` (full token sweep)
- **Builds on:** Phase 1 composition kit (`@de-braighter/substrate-runtime/kit`, runtime 2.6.0; spec `2026-06-14-substrate-cdk-pack-kit-design.md`; ADR-235)

## Motivation

Substrate DI tokens are untyped `Symbol`s whose typos and missing bindings are silent `undefined` blackholes. Two idioms coexist and leak in opposite directions:

- **Kernel tokens** — `export const X: unique symbol = Symbol.for('@de-braighter/.../X')` (global registry; dual-identity safe, but the string is hand-retyped and the type is declared separately).
- **Pack tokens** — `export const DRILL_REPOSITORY = Symbol('DRILL_REPOSITORY')` (a *local* symbol; fine inside one app, a footgun the moment a token crosses a package boundary, since two `Symbol()` calls never `===`).

Neither idiom type-links the **token** → its **interface** → the **`@Inject` site**. The interface (`DrillRepository`) sits in the same file as `DRILL_REPOSITORY`, but the linkage is eyeball-only: `@Inject(DRILL_REPOSITORY) repo: DrillRepository` re-declares the type by hand, and the provider `{ provide: DRILL_REPOSITORY, useClass: X }` never checks `X implements DrillRepository`. This is the "silent `Symbol.for` DI blackhole" hazard called out in the 2026-06-09 remediation audit (`docs/audit-2026-06-09-remediation.md`).

This spec defines a thin typed-DI layer that co-locates a token with its interface type, makes a wrong implementation a **compile error**, and turns a missing binding into a **loud, named boot error**.

## What Phase 2 can buy — honest enforcement tiers

Grounded against the real TypeScript + NestJS constraints, the footguns split across three enforcement tiers (not all are compile-time, and the spec says so):

| Footgun today | Phase-2 fix | Tier |
|---|---|---|
| Typo'd `Symbol.for('…')` string → different symbol → silent | one `definePort(...)` const everyone imports; typo = "Cannot find name" | **Compile** |
| Wrong impl bound (`useClass: X` not implementing the iface) | `bindPort<T>(PORT, {useClass: Type<T>})` constrains the value | **Compile** |
| `@Inject` site re-types the interface wrong | `@InjectPort(PORT)` — *but TS param decorators cannot rewrite the param's declared type* | **Lint (Phase 4 handoff)** |
| Port declared but never bound → cryptic Nest error / silent `undefined` if `@Optional` | `assertPortsBound(app, [PORTS])` at boot → named throw | **Boot** |

`definePort` + `bindPort` eliminate the *typo* and *wrong-impl* classes outright at compile time. The inject-site type-drift is genuinely **not** decorator-fixable in TS — it is seeded for Phase 4's lint preset rather than faked here.

## Decisions (from brainstorm)

1. **Two homes (the split).** `definePort` / `Port<T>` ship **framework-free** from `@de-braighter/substrate-contracts`, so the primitive can *eventually* retype the kernel's own ports and gives one uniform idiom; `bindPort` / `@InjectPort` / `assertPortsBound` (all NestJS-coupled) ship from `@de-braighter/substrate-runtime/kit` (the Phase-1 home). Trade-off accepted: this adds a public API to a Ring 0–3 kernel package, so **charter-checker must bless it** as DX-infra, not a kernel concept (see *Governance*).
2. **`Port<T>` is a branded symbol, not an object.** `definePort` returns `symbol & { readonly [BRAND]: T }` — it *is* a `symbol`, so every existing use-site (`@Inject(X)`, `{ provide: X }`, `moduleRef.get(X)`) keeps working untouched; `bindPort` / `@InjectPort` *add* safety on top. This is decisive for the full sweep: a missed use-site still **works** (it's a symbol) instead of breaking, so safety is added incrementally rather than the migration becoming a compile-error storm.
3. **Global registry + mandatory namespacing.** `definePort` uses `Symbol.for(name)` (global registry) → dual-identity safe (Phase-1 lesson: survives the local-src ↔ published boundary where plain `Symbol()` does not). Because the registry is keyed by string, **names MUST be package-qualified** (`'@de-braighter/pack-kids-football/DRILL_REPOSITORY'`) or two ports alias the same symbol. The namespace convention is documented now and is a candidate Phase-4 lint rule.
4. **Unbound → targeted `assertPortsBound(app, [...])`.** A tiny boot helper the app calls in `main.ts` with an explicit list of its required ports; resolves each via the container and throws a friendly **named** error. Catches the `@Optional`-undefined case too. Chosen over an auto-registry (decorator side-effects + mutable global state, harder to test) and over leaning on Nest's native cryptic throw. Designed to compose into Phase 4's `assertSubstrateSafety()`.
5. **Full sweep of the reference pack.** All ~26 `pack-kids-football` pack-owned tokens (6 repository / out-port tokens + ~20 use-case / in-port tokens) migrate to `definePort` + `bindPort` + `@InjectPort`, with `assertPortsBound` wired in `main.ts`. Maximal proof + a fully-typed reference pack.

## Architecture

```
@de-braighter/substrate-contracts            (framework-free; new)
  src/di/port.ts        →  Port<T>, definePort<T>(name)
  (exported top-level and/or via a `/di` subpath)

@de-braighter/substrate-runtime/kit          (NestJS; extends Phase-1 kit barrel)
  bind-port.ts          →  bindPort<T>(port, spec): Provider
  inject-port.ts        →  InjectPort<T>(port): ParameterDecorator
  assert-ports-bound.ts →  assertPortsBound(app, ports): void
```

**Charter stance (preempting charter-checker):** `definePort` authors **no** kernel concept. It is a pure typing utility over `Symbol.for` — it touches none of the four kernel concerns (recurse-plan / flat-observation / inference / reproducibility), adds nothing to the typed vocabulary, stores nothing, and changes no contract the kernel validates/queries/versions. It is therefore **ADR-176-orthogonal** — *infrastructure for how ports are declared*, not a concept subject to the inclusion test. The kit half is the already-sanctioned Ring-4/5 composition posture.

## Components

### 1 — `Port<T>` + `definePort` (contracts, framework-free)

```ts
declare const PORT_BRAND: unique symbol;

/** A DI token that carries the type of the value bound under it. IS a `symbol`. */
export type Port<T> = symbol & { readonly [PORT_BRAND]: T };

/**
 * Define a typed DI token. `name` MUST be package-qualified — `Symbol.for` is a
 * GLOBAL registry keyed by string, so a bare name risks aliasing another port.
 */
export function definePort<T>(name: string): Port<T> {
  return Symbol.for(name) as Port<T>;
}
```

- ~3 LOC, zero deps (the contracts package's existing Zod-only footprint is unchanged).
- T is captured at the definition, co-located with the interface that already lives in the same file.
- The human name for boot errors is recovered from `port.description` (`Symbol.for(name).description === name`).

### 2 — `bindPort` (kit)

```ts
import type { Provider, Type } from '@nestjs/common';
import type { Port } from '@de-braighter/substrate-contracts';

type BindSpec<T> =
  | { useClass: Type<T> }
  | { useValue: T }
  | { useFactory: (...args: any[]) => T | Promise<T>; inject?: any[] }
  | { useExisting: Type<T> | symbol };

export function bindPort<T>(port: Port<T>, spec: BindSpec<T>): Provider {
  return { provide: port, ...spec } as Provider;
}
```

- The compile-time impl check: `useClass: Type<T>` forces the class to construct a `T`; `useValue: T` forces the value; `useFactory` must return `T`. A drifted implementation (e.g. an `InMemoryDrillRepository` that no longer satisfies `DrillRepository`) is a **type error at the binding site** — the highest-value win for repository tokens, which carry two implementations (in-memory + Prisma) that must stay in lockstep.
- Returns a plain NestJS `Provider`, so it drops into existing `providers: [...]` arrays and composes with Phase-1 helpers (`selectAdapter`, `packPreset`).

### 3 — `@InjectPort` (kit)

```ts
import { Inject } from '@nestjs/common';
import type { Port } from '@de-braighter/substrate-contracts';

export function InjectPort<T>(port: Port<T>): ParameterDecorator {
  return Inject(port);
}
```

- Usage: `constructor(@InjectPort(DRILL_REPOSITORY) private readonly repo: DrillRepository) {}`.
- **Known limitation (documented, not hidden):** a TS parameter decorator cannot rewrite the declared type of the parameter, so `repo: DrillRepository` is still hand-written and could still drift from the port's `T`. Closing that gap is a lint rule (param type === port `T`) handed to **Phase 4**.

### 4 — `assertPortsBound` (kit)

```ts
import type { INestApplicationContext } from '@nestjs/common';
import type { Port } from '@de-braighter/substrate-contracts';

export function assertPortsBound(
  app: INestApplicationContext,
  ports: readonly Port<unknown>[],
): void { /* resolve each; collect missing; throw a single named error */ }
```

- Called once in `main.ts` after `NestFactory.create(AppModule)`.
- Throws a single aggregated, friendly error naming every unbound port, e.g.:
  `Substrate: 1 required port not bound: - DrillRepository (@de-braighter/pack-kids-football/DRILL_REPOSITORY). Did you forget bindPort(<port>, { useClass | useValue | useFactory }) in your module?`

#### The one real error-handling gotcha — scoped providers

`app.get(token)` on a **request-scoped** provider throws (it must be `resolve()`d per-request), and several kids-football repositories inject the request-scoped `TENANT_RUNNER`. A naïve `app.get` inside `assertPortsBound` would therefore **false-positive** those as "missing." The helper MUST distinguish:

- `UnknownElementException` (no provider for the token) → **truly missing**, report it.
- A scoped-provider error (provider exists but is request-scoped) → **bound**, treat as present.

The probe distinguishes by inspecting the thrown exception type/message; request-scoped ports are considered satisfied by the existence of a registered provider. (Mechanics belong to the implementation plan.)

## Data flow

```
definePort<DrillRepository>('@de-braighter/pack-kids-football/DRILL_REPOSITORY')   // co-locate token + T
        │
        ├─ bindPort(DRILL_REPOSITORY, { useClass: PrismaDrillRepository })   ──► compile error if not a DrillRepository
        ├─ @InjectPort(DRILL_REPOSITORY) repo: DrillRepository              ──► resolves the typed value
        └─ assertPortsBound(app, [DRILL_REPOSITORY, …])                     ──► named boot throw if unbound
```

## Migration plan — `pack-kids-football` full sweep (~26 tokens)

Mechanical, idiom-preserving (every token stays a symbol throughout, so intermediate states build):

1. **Define:** each `export const X = Symbol('X')` → `export const X = definePort<XInterface>('@de-braighter/pack-kids-football/X')`. Tokens are already co-located with their interfaces.
2. **Bind:** each provider literal `{ provide: X, useClass: Y }` → `bindPort(X, { useClass: Y })` in the pack module / composition root (this is where the demo-vs-prod `selectAdapter` choice already lives — `bindPort` wraps its result).
3. **Inject:** each `@Inject(X)` → `@InjectPort(X)`.
4. **Assert:** add `assertPortsBound(app, [/* all 26 */])` to `apps/pack-kids-football-api/src/main.ts`.

The six out-port (repository) tokens — `DRILL/MEMBER/TEAM/SLOT/RESOURCE/CLUB_REPOSITORY` — are the high-value targets (dual implementations). The ~20 use-case tokens are single-impl but included for a fully-typed reference pack.

## Testing — the exit proof

A kit spec proves both new failure modes:

- **Compile proof:** a `bindPort` with an incompatible `useClass` is asserted via `// @ts-expect-error` (a green test *requires* the type error to occur).
- **Boot proof:** a NestJS test module that deliberately omits a binding makes `assertPortsBound` throw an error whose message **names the port**.
- **DI-resolution proof:** assert resolution via `toBeDefined()`, **never `instanceof`** (Phase-1 dual-identity lesson — `Symbol.for` tokens match across the local-src/published boundary; classes do not). Same-project imports stay relative (`@nx/enforce-module-boundaries`).
- **Regression:** kids-football's existing smoke e2e stays green (the DI graph resolves under a real mount).

## Scope boundaries

- **In:** `definePort`/`Port<T>` (contracts); `bindPort`/`@InjectPort`/`assertPortsBound` (kit); full kids-football token sweep + `main.ts` assert; the kit spec proving compile + boot failure.
- **Out:** migrating the substrate's own contracts/runtime `Symbol.for` tokens (opportunistic, later phase); the inject-site type-drift **lint** (Phase 4); the namespace-convention lint (Phase 4).
- **Two banked Phase-1 kit gaps stay banked.** Phase 2's consumer is still `pack-kids-football` (the *first* consumer); no second consumer arrives, so the ADR-176 demand-gate is not met — do **not** build the `packPreset` `auditEventRepository` seam or the `AuthBootstrapBase` `ConsentEngine` extension this phase.

## Governance

- **Designer-first ADR** (author: `substrate-architect`) before any code, because this adds a public API to a Ring 0–3 kernel package. Load-bearing argument: `definePort`-in-contracts is **DX infrastructure, not a kernel concept** → ADR-176-orthogonal, not subject to the inclusion test. The ADR also ratifies the package-namespacing convention and records the Phase-4 lint handoff.
- **charter-checker** adjudicates the DX-infra-not-kernel-concept framing on the implementation PR.
- **Verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, worktree-isolated; `exercir-charter-checker` joins on the `domains/exercir` PR) per the review floor; this is a non-trivial change.
- **Twin ritual** on each PR (`Producer:` / `Effort:` / `Effect:` lines; `drain` → `backfill` → `reconcile`).

## Carried Phase-1 lessons (binding on execution)

- **Worktree isolation** for the substrate build (a concurrent foundry/debt session collided on the shared `layers/substrate` working tree last phase and cost a recovery).
- **Ground against the live consumer**, not memory (this spec already re-grounded: kids-football tokens are local `Symbol()`, the scoped-`TENANT_RUNNER` gotcha is real, all migration targets are NestJS-context).
- **Dual identity in kit tests** — `toBeDefined()` not `instanceof`; relative same-project imports.
- **Pre-push `nx lint` is whole-project** — the new code must add 0 errors.
- **Cross-repo consumers pin published versions** — publish the contracts + runtime bump before the kids-football adopt PR.
