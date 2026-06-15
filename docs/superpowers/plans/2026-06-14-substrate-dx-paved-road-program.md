# Substrate DX "Paved Road" Program — coarse roadmap

- **Date:** 2026-06-14 (last updated 2026-06-15)
- **Status:** ACTIVE — **Phases 1–2 SHIPPED + PUBLISHED**; Phase 3 (`Result` + error model) is next.
- **Scope:** developer experience of building products on the substrate (a Ring 4/5 packaging layer over the kernel)
- **Constraint:** phases run **strictly sequentially**, one after another.

## Why

The kernel and published primitives (`@de-braighter/substrate-{contracts,runtime}`) are strong, but there is **no layer between the primitives and a product's composition root**. Every new product re-pays the same wiring and re-exposes the same footguns:

- A production pack is ~82 files / ~10.7K LOC, **~70% mechanical template**, not domain.
- ~600 LOC of composition-root wiring is copy-pasted across ~8 repos (DB-auth client lifecycle, `SubstrateModule.forRoot` provider arrays, the inference 5-provider chain, auth bootstrap, in-memory/Prisma adapter selection).
- A known hazard class recurs per product: silent `Symbol.for` DI blackholes, guard-order fragility, manifest-key ↔ tenant drift, `tenant_pack_id` string/uuid drift, RLS silently off in prod (see `docs/audit-2026-06-09-remediation.md`).

When building **many** products this fixed per-product tax dominates. This program converts it into a write-once paved road.

**Guardrail (ADR-176):** this is a Ring 4/5 *packaging* layer that **composes** primitives; it never authors kernel concepts. It keeps the kernel minimal by absorbing assembly complexity above it.

## Operating rhythm (every phase)

brainstorm scope → designer-first ADR (charter-checker territory) → subagent-driven implementation → verifier wave → **migrate ONE reference product** → twin ritual + merge → founder checkpoint → next phase.

## Reference-product spine

`pack-kids-football` is the guinea pig migrated in every phase. By Phase 5 it is the fully-worked example the guide is written from.

> **Exit criterion for every phase = "the reference product uses it and is green," not "the package exists."**
>
> Phase 2 is the canonical proof of *why* this criterion is worded this way: the `assertPortsBound` primitive passed its own (TestingModule-based) test **and** a full verifier wave, yet was broken against a real `NestFactory` app — only the live reference-product migration surfaced it. Ground boot/DI primitive tests against a real app context (`NestFactory.createApplicationContext`), never a `TestingModule`.

## Phases (sequential)

| Phase | Improvement | Size | Status | Why this slot |
|---|---|---|---|---|
| 1 | Composition CDK | M | ✅ **SHIPPED** (2026-06-14) | Foundation + biggest lever; produces the reference migration |
| 2 | Typed DI binding | S | ✅ **SHIPPED** (2026-06-15) | Same composition-root surface as Phase 1 |
| 3 | `Result` combinators + one error model | S–M | ⏭️ next | Request/service edges (different surface) |
| 4 | Safety net (lint preset + boot asserts) | M | queued | Lints the patterns Phases 1–3 established |
| 5 | Guide + code templates | S–M | queued | Harvested from the migrated reference product |

> Order = priority ranking, with one swap: typed-DI pulled ahead of `Result` because it shares the composition-root surface with the CDK.

### Phase 1 — Composition CDK ✅ SHIPPED

- **Goal:** collapse ~600 LOC/product of composition-root wiring into typed factories + presets.
- **In:** `dbAuthWiring()`, `inferenceBackboneProviders()`, `selectAdapter()`, `AuthBootstrapBase`, `packPreset()` (demo/production).
- **Out:** domain-shaped content (manifest body, schema) — that's Phase 5 templates.
- **Decision (resolved):** package home = a subpath of the runtime, `@de-braighter/substrate-runtime/kit` (NOT a third package — it's NestJS-coupled + wires runtime internals).
- **Shipped:** `@de-braighter/substrate-runtime/kit` (runtime **2.6.0**), substrate#182, **ADR-235** (specs#314), charter-BLESSED. `pack-kids-football` adopted `dbAuthWiring` + `AuthBootstrapBase` (exercir#269, auth bootstrap 266→135 LOC). Two demand-driven kit gaps banked (`packPreset` `auditEventRepository` seam; `AuthBootstrapBase` `ConsentEngine` extension) — widen on a 2nd consumer.

### Phase 2 — Typed DI binding ✅ SHIPPED

- **Goal:** kill silent `Symbol.for` DI blackholes.
- **In:** `definePort<T>()` + `bindPort()` — compile-time impl check, loud *named* boot error on unbound; adopt in the kit + migrate the reference pack's tokens.
- **Out:** big-bang migration of all tokens (opportunistic — substrate's own contracts/runtime tokens stay raw for now).
- **Exit (met):** a deliberately mis-bound/missing port fails at compile or boot, naming the port — proven by a test.
- **Shipped:** `definePort<T>`/`Port<T>` (branded symbol, framework-free) in `@de-braighter/substrate-contracts` **2.6.0**; `bindPort`/`@InjectPort`/`assertPortsBound` in `@de-braighter/substrate-runtime/kit` **2.7.1**. **ADR-236** accepted (specs#315, charter-BLESSED). substrate#183 (primitives + a scoped `typecheck-proofs` gate enforcing the `@ts-expect-error` compile-proofs) + substrate#185 (the `assertPortsBound` `app.resolve()`/async fix). Reference consumer: `pack-kids-football` full **39-token sweep** (exercir#274, 4-agent wave green) + a `NestFactory.createApplicationContext` boot test (exercir#277). **Handoffs to Phase 4:** the inject-site param-type-drift lint, the package-namespace lint, and `assertSubstrateSafety()` (which `assertPortsBound` was designed to compose into).

### Phase 3 — `Result` combinators + one error model ⏭️ NEXT

- **Goal:** shrink + unify every service/controller edge.
- **In:** `map` / `flatMap` / `unwrapOr` / `getOrThrow`; the rule "ports return `Result`, the HTTP edge maps via `@MapResult()`, nothing between throws"; one error→HTTP registry.
- **Out:** rewriting all controllers at once (apply-on-touch + reference product).
- **Exit:** reference product has zero ad-hoc `throw new HttpException` in controllers.

### Phase 4 — Safety net

- **Goal:** make the audit's hazard class deterministic, not honor-system.
- **In:** `@de-braighter/eslint-substrate` (switch-exhaustiveness, guard-order, manifest⊆tenants, no-eager-tenant-context, no-raw-symbol-port, **+ the Phase-2 handoffs: inject-site type-drift + port-name namespacing**) + `assertSubstrateSafety()` boot (RLS-on-in-prod, manifest⊆tenants, `tenant_pack_id` uuid, **+ compose `assertPortsBound`**).
- **Out:** the heavy `tenant_pack_id` UUID data migration (WS-4) — track separately; assert warn-first.
- **Exit:** all product repos extend the preset; the kit wires the boot-assert so new products inherit it; CI red on a planted violation.

### Phase 5 — Guide + code templates

- **Goal:** kill the 2–4 hr archaeology tax; a recipe for human + agent builders.
- **In:** a narrative "Build a Product on the Substrate" walkthrough from the migrated reference product + code templates (manifest, RLS schema pattern, event-type, migration, controller/service, Angular page+routing); wire them into `/new-domain`.
- **Out:** exhaustive per-domain cookbooks — one golden path.
- **Exit:** a fresh builder/agent stands up a CRUD slice from the guide alone, touching no other product's source.

## Evidence

- Wiring duplication: compare `domains/{exercir,gridiron,markets}/apps/*-api/src/app/app.module.ts`.
- Hazard class: `docs/audit-2026-06-09-remediation.md` (I1–I7); `docs/superpowers/specs/2026-06-04-substrate-coherence-remediation-program-design.md` (WS-4).
- Scaffolding baseline: `.claude/skills/new-domain/SKILL.md`.

## Status log

- **2026-06-14** — roadmap ratified; Phase 1 (Composition CDK) design starting. Open: `pack-kit` vs `substrate-runtime` home.
- **2026-06-14** — **Phase 1 SHIPPED + PUBLISHED.** Composition kit at `@de-braighter/substrate-runtime/kit` (runtime 2.6.0), ADR-235, charter-BLESSED; `pack-kids-football` partially migrated (exercir#269). Home decision resolved: runtime subpath. 2 kit gaps banked (demand-driven).
- **2026-06-15** — **Phase 2 SHIPPED + PUBLISHED.** Typed DI binding: `definePort`/`Port<T>` (contracts 2.6.0) + `bindPort`/`@InjectPort`/`assertPortsBound` (runtime 2.7.1); ADR-236 accepted; substrate#183 + #185; full 39-token `pack-kids-football` sweep (exercir#274) + boot test (exercir#277). **Lesson burned in:** `assertPortsBound` was DOA in 2.7.0 (its `app.get` form false-negatived the all-request-scoped/`useExisting` graph); the kit's TestingModule test + a full verifier wave both MISSED it — only the live consumer caught it → fixed via `app.resolve()`/async in 2.7.1, with the regression test now grounded on `NestFactory.createApplicationContext`. Design: branded-symbol `Port<T>` made the sweep safe; `useExisting` tightened to `Type<T> | Port<T>`; a scoped `typecheck-proofs` gate makes the `@ts-expect-error` compile-proofs real. Phase 4 inherits the two lint handoffs + `assertSubstrateSafety()` composition.
- **Next:** Phase 3 (`Result` combinators + one error model).
