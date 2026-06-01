---
title: "domains/devloop — technical design (correct-minimal substrate pack)"
status: design (pre-scaffold) — for review
kind: technical-design
created: 2026-05-29
author: stibe
ratified-by:
  - layers/specs/adr/adr-192-sanction-pack-devloop-pack-on-platform-zero-kernel-change.md
  - layers/specs/adr/adr-193-pack-devloop-effect-declarations-are-calibratable-claims.md
relates-to:
  - layers/specs/concepts/substrate/self-hosting-devloop.md
  - layers/substrate/libs/substrate-contracts/  (the contracts this pack consumes)
note: >
  Per sdlc.md §5.3 a kernel-consuming pack needs a technical design before code.
  This is that doc. Form chosen: correct-minimal (substrate-typed, no NestJS/
  Postgres/RLS) per ADR-176. Scaffolding follows founder review.
---

# domains/devloop — technical design

> The committed home for the SDLC-on-substrate work (consumer #1: the founder).
> Replaces the throwaway `tmp/devloop-spike/`. Sanctioned by ADR-192 (pack, zero
> kernel change) + ADR-193 (effect-declarations-as-claims). Read before scaffold.

## 1. Form & rationale

A **correct-minimal** domain pack (Path A): a real, committed, tested package
**typed against `@de-braighter/substrate-contracts`** — but **no NestJS, Prisma,
Postgres, or RLS**. devloop is single-user, no-PHI, no-multi-tenant, read-mostly
(reads GitHub PRs + appends an event log). The conservation/exercir full runtime
stack exists for multi-tenant medical-grade isolation; imposing it here is the
over-engineering [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
forbids. Runtime escalation (kernel `event_log` Postgres, RLS) is **demand-pulled**
— it lands only if devloop ever becomes multi-tenant or shared.

## 2. Architecture — kernel-consumed vs pack-local

The defining finding from reading the real contracts: the substrate's **plumbing**
generalizes to software-delivery; its **domain ontology** does not — and forcing
the latter would be wrong.

| Concern | Disposition | Why |
|---|---|---|
| **Observation log** | **Kernel-consumed** — every devloop event conforms to `DomainEventEnvelope` (`@de-braighter/substrate-contracts/events`). | The envelope is deliberately pack-agnostic: opaque `payload` JSONB, free-string `eventType`, opaque `actorRef`. devloop uses the kernel's "flatten the observation" concern directly. |
| **Reproducibility discipline** | **Kernel-consumed (pattern)** — append-only, never-mutate, derive-from-log. | The event-sourcing posture (ADR-030) is the contract; devloop honours it. |
| **Inference port** | **Future seam** — `InferenceBackbone` port type referenced; not wired in v1. | v1 posteriors are conjugate/MC over delivery metrics; the kernel `PosteriorInput` is subject-indicator-on-plan shaped. A devloop adapter routes through the port only when inference outgrows in-process MC. |
| **Producer attribution** | **Pack-local** — a devloop `ProducerManifest {producer, model, skills}` carried in envelope `metadata.actorRef`. | The kernel `RunManifest` is *inference reproducibility* (`seed`, `engineVersion`, hashes), **not** code authorship. Authorship is needed by 1 consumer → pack territory (ADR-176). |
| **Subject (repo/module)** | **Pack-local** — `RepoSubject { repo: string }`. | Kernel `SubjectRef` is `{person\|agent\|world\|cohort}` keyed by **uuid**; a repo is `"de-braighter/specs"`. Map to `SubjectRef{kind:'world', id: uuidv5(repo)}` **only** at the (deferred) inference-port boundary. |
| **Verdict / Correction / Override** | **Pack-local** payloads. | Verifier-wave vocabulary is devloop-specific; opaque to the kernel (ADR-027). |
| **Delivery indicators + posteriors** | **Pack-local**. | cycle-time, cleanliness, calibration — not kernel indicators. |

**The answer to "is the SDLC a substrate domain?"**: yes for the substrate's
*infrastructure* concerns (event-sourcing, reproducibility, the inference-port
abstraction), **deliberately no** for its *ontology* (uuid subjects, plan-tree
interventions, indicator posteriors, inference manifests). That partial fit is
*correct* pack architecture, not a shortcoming.

## 3. Event model

Every devloop event is a `DomainEventEnvelope`:

- `tenantPackId`: a fixed `DEVLOOP_SCOPE` UUIDv5 (single tenant — required by the schema, trivially satisfied).
- `packId`: `'devloop'`.
- `aggregateType`: `'Repo' | 'PullRequest'`; `aggregateId`: uuidv5 of the repo/PR.
- `eventType` (pack-owned, free string): `devloop:PrOpened.v1`, `devloop:PrMerged.v1`, `devloop:VerdictRecorded.v1`, `devloop:CorrectionRecorded.v1`, `devloop:OverrideRecorded.v1`, `devloop:ProducerAttributed.v1`.
- `metadata.actorRef`: the producer (opaque provenance — exactly its intended use).
- `payload`: the pack-local typed schema (validated by devloop, opaque to the kernel).

**Store v1:** append-only JSONL (the spike's shape, now typed + validated on write).
The kernel `event_log` Postgres path is the demand-pulled escalation.

## 4. Inference

- **v1 (pack-local, in-process):** the spike's math, ported and tested — NIG
  cycle-time *predictive* posterior; Beta verdict-trustworthiness + producer-cleanliness.
  Pure functions, ε-cheap (no sidecar).
- **Future seam:** a `DevloopInferenceAdapter implements InferenceBackbone` routes
  to the kernel port when inference outgrows conjugate/MC. Documented, not built.

## 5. Package structure (lean)

```text
domains/devloop/
├── .npmrc                 @de-braighter:registry -> GH Packages; token from $GITHUB_TOKEN
├── package.json           @de-braighter/devloop; deps: @de-braighter/substrate-contracts ^0.7.0, zod
├── tsconfig.json
├── vitest.config.ts
├── README.md              (the §2 architecture table — kernel-consumed vs pack-local)
├── src/
│  ├── index.ts
│  ├── events.ts           pack-local payload schemas + DomainEventEnvelope conformance
│  ├── log.ts              append-only JSONL store + read (the observation log)
│  ├── producer.ts         ProducerManifest (pack-local)
│  ├── ingest/github.ts    gh backfill -> envelopes
│  ├── inference/cycle-time.ts
│  ├── inference/reliability.ts
│  └── cli.ts              backfill | seed | posterior | reliability | append
└── test/                  vitest (ports the spike's selftests as real tests)
```

**Dependency resolution:** published `@de-braighter/substrate-contracts@^0.7.0`
via a committed `.npmrc` (token from `$GITHUB_TOKEN`, mirrors exercir); local
`layers/substrate/libs/substrate-contracts/dist` as a `file:` fallback if the
registry is unavailable.

## 6. Migration from `tmp/devloop-spike/`

| Spike file | → Pack |
|---|---|
| `devloop.mjs` (events/log/posterior/reliability) | `src/log.ts`, `src/events.ts`, `src/inference/*`, `src/cli.ts` (typed + tested) |
| `cycle-time-posterior.mjs` | `src/inference/cycle-time.ts` |
| `capture-verdict.mjs` (SubagentStop hook) | kept; repointed to the pack's log path; `settings.local.json` updated |
| `events.jsonl` | re-backfilled into the pack's log (append-only, so a clean rebuild) |

The spike's `--selftest`s become real vitest tests (roundtrip, validation,
posterior recovery, beta sanity, manifest/correction validation).

## 7. What this is NOT

- **No** Postgres / RLS / NestJS / multi-tenant (demand-pulled escalation only).
- **No** forcing producer/verdict/repo-subject onto kernel primitives.
- **No** GitHub remote / published package until explicitly asked (local repo first).
- **Not** a product — internal tooling, consumer #1 = founder (north-star Option A).

## 8. Open questions

| Question | Resolve when |
|---|---|
| Log location: in-repo `data/` vs `~/.devloop/`? | At scaffold — affects the hook repoint. |
| New `de-braighter/devloop` GitHub repo, or local-only git for now? | Founder call before any push. |
| Does the capture hook graduate out of `tmp/` to the pack? | At scaffold (yes, with the repoint). |
| When does the `InferenceBackbone` adapter seam get built? | When in-process MC is provably insufficient (a real escalation trigger). |
