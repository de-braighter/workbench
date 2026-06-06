# WS-8 — Subject-Ontology Generalization (opaque-`role` SubjectRef) — Design

- **Status:** proposed (awaiting user review)
- **Date:** 2026-06-06
- **Author:** orchestrator session (founder-directed)
- **Implements:** [ADR-213](../../../layers/specs/adr/adr-213-generalize-subject-ontology-beyond-person.md) (direction-only) — the detailed contract shape it deferred to "the WS-8 implementation arc".
- **Sequenced by:** [ADR-218](../../../layers/specs/adr/adr-218-north-star-critical-path-sequencing.md) — WS-8 is step 1 (foundational) on the north-star critical path.
- **Rides:** the coordinated `substrate@1.0` breaking batch — epic [substrate#92](https://github.com/de-braighter/substrate/issues/92) (WS-3 + WS-6 + WS-8). Tracking epic: [substrate#95](https://github.com/de-braighter/substrate/issues/95).
- **Successor artifact:** implementation plan at `docs/superpowers/plans/2026-06-06-ws8-subject-ontology-plan.md` (written after this spec is approved).

---

## 1. Why this exists

The substrate claims to be **domain-agnostic** (kernel concern #3 / ADR-127: inference over *any* subject-indicator twin). The conjugate inference fast-paths contradict that claim today by **gating on `subject.kind === 'person'`**, so every non-person digital twin must misrepresent its subject as a person to use them. markets labels a **crypto-asset** as `kind:'person'` (`readout.service.ts:50`, with an explanatory comment at `:47`); the `supportedV1:['person']` error envelope is a *false* contract masquerading as a constraint.

ADR-213 ratified the **direction** (open `SubjectRef.kind`, treat it opaquely in the fast-paths, remove the guards, breaking → 1.0) but deliberately deferred the **shape** to this arc. This spec settles the shape and the exact edits.

## 2. The key insight that shapes the design

The `kind === 'person'` guard is silently doing **two** jobs:

1. **A domain-gate** (the bug): it rejects non-person domains the engine has no business judging.
2. **A structural-gate** (legitimate, incidental): for the single-subject adapters (`normal-normal`, `beta-binomial`), `kind === 'person'` *also* happens to exclude `aggregate`/`cohort` subjects those adapters genuinely cannot pool — a Normal-Normal conjugate update is defined over **one** subject's evidence, not a pooled set.

Therefore WS-8 is **not** "delete the guard." It is **convert a domain-gate into a structural-gate**: the fast-paths stop branching on the *domain label* but keep (correctly) constraining the *structure* they support. This preserves ADR-213's invariant — *conjugate-family selection keys off `conjugateHint` + distribution family, never off subject kind* — while keeping structural admissibility correct. The code already branches on `cohort` structurally in a few places (`*.adapter.ts:373/:395` cache-key build, `eb-hierarchical:429`); those are *correct* and survive unchanged, confirming "gate on structure, not domain" is the existing grain of the code.

## 3. Goals / Non-goals

**Goals**

1. A non-person subject runs a posterior with **no workaround**; markets drops the `kind:'person'` crypto-asset lie (the ADR-213 / substrate#95 done-when).
2. `SubjectRef.kind` carries **inference structure only**; the domain label moves to an opaque, pack-namespaced `role` the kernel never branches on.
3. Add **no** kernel table, verb, or relation (ADR-176 — the change *removes* a domain assumption).

**Non-goals**

- Not touching exercir's pack-local `PersonSubjectRef` / `actorRef` / `playerRef` domain modeling (see §6 — out of scope; they never cross the substrate inference boundary).
- Not adding a subject-kind **registry / governance** (Approach 3, rejected: ADR-176 minimality + ADR-198's opaque-label precedent give opacity for free without new kernel machinery).
- Not the conservation fork's `SubjectRef` (its own `inference-backbone.port.ts` — that is **WS-7** de-fork territory).
- Not WS-3 (legacy port retirement) or WS-6 (FHIR eviction) — sibling members of the same `substrate@1.0` batch, executed in their own arcs.

## 4. Target contract (`libs/substrate-contracts/src/primitives/`)

### 4.1 `subject-ref.ts`

```ts
export const SubjectRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('individual'), id:  z.string().uuid(),                 role: z.string() }),
  z.object({ kind: z.literal('cohort'),     ids: z.array(z.string().uuid()).min(1), role: z.string() }),
  z.object({ kind: z.literal('aggregate'),  id:  z.string().uuid(),                 role: z.string() }),
]);

export type SubjectRef  = z.infer<typeof SubjectRefSchema>;
export type SubjectKind = SubjectRef['kind'];   // 'individual' | 'cohort' | 'aggregate'
```

- **`kind` = inference structure** the engine legitimately needs: `individual` (one subject), `cohort` (pooled set), `aggregate` (hierarchical twin over members partial-pooled toward a shared hyperparameter — ADR-198).
- **`role` = pack-namespaced opaque domain label**, **required** on every variant, that the kernel **never branches on**: `'football.player'`, `'football.team'`, `'markets.crypto-asset'`, `'herdbook.animal'`, `'conservation.region'`, … The kernel ships **zero** role literals.
- The dead, never-consumed `person` / `agent` / `world` published literals are **dropped** (they were "encoded from day one" speculatively; no published-substrate consumer uses them). `individual` replaces all single-id variants.
- The `null` SubjectRef (population-level inference, no specific subject) is **unchanged**.
- Naming note: `individual` overlaps the herdbook/conservation pedigree `Individual` entity, but at a different layer; `role` disambiguates (`{kind:'individual', role:'herdbook.animal'}`). Harmless.

### 4.2 `error-envelope.ts` — domain-gate → structure-gate

The `subject-kind-not-supported` variant is **renamed** to make its now-structural meaning self-documenting:

```ts
// was: { kind: 'subject-kind-not-supported'; received: SubjectRef['kind']; supportedV1: readonly ['person'] }
   now: { kind: 'subject-structure-not-supported'; received: SubjectKind; supported: readonly SubjectKind[] }
```

It now means "this adapter does not support this subject **structure**" (e.g. a `cohort` handed to `normal-normal`), not "wrong domain kind."

## 5. The four adapters — convert domain-gates to structural-gates *(core of the arc)*

| Adapter (file) | Guard sites today | After WS-8 |
|---|---|---|
| `normal-normal-fast-path.adapter.ts` | `:105`, `:226` — `kind !== 'person'` | accept `kind === 'individual'`; reject `cohort`/`aggregate` → `subject-structure-not-supported` (`supported: ['individual']`) |
| `beta-binomial-fast-path.adapter.ts` | `:91`, `:210` — `kind !== 'person'` | same — `individual` only |
| `eb-hierarchical-beta-binomial.adapter.ts` | `:165`,`:170` — members `kind !== 'person'` | subject `kind === 'aggregate'`; **members** must be `individual`; nested-aggregate members stay deferred ("Tier 5") with a structural error |
| `adapters/inference/in-memory.adapter.ts` | `:83`,`:87` — `subjectRef.kind !== 'person'` | accept `individual`; structural-reject otherwise |

- **Family selection is untouched** — it keys off `conjugateHint` + distribution family (ADR-165 / ADR-213 invariant). Only the *admissibility* guard changes from domain to structure.
- The cohort-branch cache-key code (`normal-normal:395`, `beta-binomial:373`) and `eb-hierarchical:429`'s `case 'cohort'` survive **unchanged** (already structural). With the new structural guard, the `cohort` branch in the single-subject adapters becomes unreachable defensive code — leave it (harmless) or drop it as a tidy; impl-author's call.

## 6. Consumer migration — the *entire* breaking surface

**markets** (`apps/markets-api/src/readout/readout.service.ts`)

```ts
// :47–:50  the lie + comment removed →
subject: { kind: 'individual', id: ASSET_IDS[assetId], role: 'markets.crypto-asset' }
```

**exercir** — substrate-`SubjectRef` inference-call sites **only**:

| Site | Change |
|---|---|
| `apps/pack-football-api/.../pack-football.controller.ts:96,146` | player posterior → `{kind:'individual', id: playerId, role:'football.player'}` |
| `apps/pack-football-api/.../pack-football-player-match-day.controller.ts:103` | `{kind:'individual', id: personId, role:'football.player'}` (drop local `PersonSubjectRef` at this boundary) |
| `apps/pack-football-api/.../pack-football-team-twin.controller.ts:89` | already `aggregate` — `role:'football.team'` unchanged; verify `id`/`role` order only |

**Explicitly out of scope** (pack-internal modeling that never reaches the substrate inference port, keeps its own `{kind:'person'}` shape): exercir's local `PersonSubjectRef` (`libs/pack-football/src/domain/subject-ref.ts`), and all `actorRef` / `playerRef` / `captainRef` / `playerOutRef` event-actor and lineup refs across `libs/pack-football/src/application/*`. The pack may align these to `individual+role` later as its own cleanup, but it is **not** WS-8.

**herdbook**: no inference / SubjectRef usage — no migration. **conservation**: own fork — WS-7, not here.

## 7. Invariants preserved (no change)

Tenant scoping (ADR-205), `RunManifest.apiVersion` replay contract, single-parent plan-tree spine, conjugate-family correctness (ADR-165), `null`-subject population inference. **No** kernel table/verb/relation added — ADR-176 inclusion test passes by *removal* of a domain assumption (both legs already satisfied by the existing ratified surface; verdict recorded in ADR-213).

## 8. Release mechanics

- Implement on a substrate `release/1.0` branch; **do not publish WS-8 in isolation.** It rides the coordinated `substrate-contracts@1.0` / `substrate-runtime@1.0` batch (substrate#92) with WS-3 + WS-6 so exercir/markets migrate **once** against a single documented breaking surface.
- This arc lands: the contracts + runtime edits on the release branch, the markets + exercir migrations (gated behind the batch), and the migration-guide section for WS-8. The 1.0 cut itself (version, publish, single guide) is owned by substrate#92 once all three workstreams are on the branch.

## 9. Testing strategy

- **Contract (substrate):** a non-person `individual` Normal-Normal posterior returns a real result (the done-when); a `cohort`/`aggregate` into `normal-normal`/`beta-binomial` returns `subject-structure-not-supported`; `eb-hierarchical` accepts an `aggregate` subject with `individual` members and rejects nested-aggregate members structurally. Zod round-trips the three variants; `role` required is enforced.
- **Consumer:** markets + exercir build green on the release branch with **zero** `kind:'person'` in any substrate inference call; markets' BTC posterior runs with `role:'markets.crypto-asset'`.

## 10. Ownership (per program spec §4)

`substrate-architect` (this design / any ADR-213 amendment) → `substrate-coder-pro` (contracts + runtime on the release branch) → consumer `implementer`s (markets, exercir) → verifier wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`; `exercir-charter-checker` on the exercir PR).

## 11. Confirmed sub-decisions (this session)

1. Single-subject structural kind name = **`individual`**.
2. Error variant **renamed** to `subject-structure-not-supported` (`supported: SubjectKind[]`).
3. `role` is **required** on every variant (consistent with ADR-198's `aggregate.role`; forces explicit provenance; kernel still never reads it).
