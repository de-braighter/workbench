# Kickoff prompt — S1: the uniform charter lifecycle runtime

> Paste the block below into a fresh Claude Code session (launched from `de-braighter/`) to start S1 of the recursive-charter-runtime program. It assumes Slice 0 is merged.

---

We are building **S1 — the uniform lifecycle runtime** of the recursive-charter-runtime program. Read these first, in order:

1. Memory: `recursive-charter-runtime-arc` (the arc state, decisions D1–D8, the Slice-0 outcome + execution lessons).
2. `docs/superpowers/specs/2026-06-27-recursive-charter-runtime-program-design.md` — the program; S1 is "the uniform lifecycle runtime" sub-project (see §10 table + §3 the seam + §4 the layer cake).
3. ADR-283 (`layers/specs/adr/adr-283-charter-runtime-cluster-layer.md`) — the ratified rationale for the `charter-runtime` layer + the Kernel-Untouched Invariant.
4. The merged Slice-0 code in `layers/charter-runtime/src/` — `lifecycle.ts` already has a *one-pass* lifecycle (intake→validate→execute→record→resolve) + a closed `ACTION_REGISTRY` + a replay-safe `foldCharterState`. S1 generalizes this into the **full** runtime.

## What S1 builds

Generalize the foundry's conductor into a **domain-agnostic charter lifecycle runtime** in `layers/charter-runtime`:
- The full lifecycle: `intake → validate → decompose-or-claim → execute → verify → gate → record → resolve`, with the complete resolution set `done | expanded | blocked | rejected | superseded` (Slice 0 shipped a thin `done | rejected` subset).
- A **derived frontier / advancement** view over a charter *tree* (which nodes are claimable/ready), driven by completion events + derived `dependsOn` reachability — control flow stays *derived*, not callbacks.
- `ACTION_REGISTRY` dispatch generalized (still a closed map; unknown kind throws; event-sourced, exactly-once on replay).
- Inheritance enforced at claim/execute time via the **canonical** `validateInheritance` (one rule — never a private copy; this was the #1 cross-task bug in Slice 0).

## Prior art to LIFT (generalize, don't reinvent)

`domains/foundry/src/`: the conductor (`conductWorkflowStep`, `workflowFrontier`, `planFrontier`/`planFrontierAll`), `state.ts` (event fold + claim/release), `workflow-*` (the FOUNDRY_WORKFLOW tree + variants), the `ACTION_REGISTRY` command pattern (ADR-263). The foundry already runs this single-domain; S1 makes it reusable.

## Hard guardrails (non-negotiable)

- **Zero kernel change / Kernel-Untouched Invariant.** No diff to `substrate-contracts/.../plan-tree-schemas.ts`, `plan-tree-store.port.ts`, `substrate-runtime/.../prisma-plan-tree.store.ts`, or `prisma/`. Contract/runtime data rides on `PlanNode.metadata`; the recursion is kernel concern #1, reused. Extend the recursive boundary acid to cover any new files.
- **One inheritance rule** — reuse `validateInheritance`; no divergent semantics (equal scope is valid; only genuine widening rejected).
- **Replay-stable + exactly-once** — event-sourced; no `Date.now()`/`new Date()`/`Math.random()` in the fold/runtime path (inject ids/timestamps); handlers emit events, replay folds (never re-runs).
- **Store generators, derive graphs** — frontier/advancement/effective-contract are derived views, never stored.

## Process

This is a sub-project: run it as **brainstorm → spec → plan → subagent-driven execution**, ending in a verifier wave (full wave incl. `charter-checker`) + the twin ritual. Start with the `brainstorming` skill (the design will surface real forks: how much of the foundry conductor generalizes cleanly vs stays foundry-specific; the frontier derivation over a charter tree; decompose-or-claim semantics for charter nodes; whether S1 needs its own ADR or extends ADR-283). Keep the walking-skeleton discipline — thin vertical slices, acids first (the frontier-derivation + exactly-once + inheritance-at-claim are the load-bearing properties).

## Out of scope for S1

The blueprint/charter-tree engine (S2), foundry migration (S3), studio durable persistence (S4), deploy+sync — the original "persist the foundry SDLC tree" ask (S5), a second consuming pack (S6).
