# AI-Driven SDLC — a portable blueprint

A vendor-neutral extract of an agent-driven software delivery process: how a small team
runs design → build → verify → ship with a fleet of specialized AI agents, kept honest by
written policies and two quality gates. Everything here is **stack-agnostic** — the named
roles and workflows transfer to any language, framework, or issue tracker.

## The two diagrams

| File | Audience | Purpose |
|---|---|---|
| `ai-sdlc-overview.svg` | Leadership / stakeholders | One-screen pitch: how AI-driven delivery works and where the gates sit. |
| `ai-sdlc-blueprint.svg` | Engineers who will build it | The real interaction graph — agent roster by phase, skills, policies, workflows. |

## The four pillars

The whole system is four kinds of artifact. Adopt them in this order.

1. **Policies — the constitution.** A handful of short markdown files (`coding`, `testing`,
   `git`, `docs`, `voice`) that every agent must obey. They are the *non-negotiables*: how
   commits are shaped, what "tested" means, the docs bar, the writing tone. Start here —
   policies are cheap to write and everything else references them.

2. **Agents — the AI workforce.** Single-purpose roles, not one do-everything assistant.
   Grouped by SDLC phase:
   - **Plan:** *Designer* (writes specs/ADRs, markdown only — never code), *Architecture
     Guardian* (load-bearing/cross-cutting design), *Product Strategist* (what to build next).
   - **Build:** *Implementer*, *UI Implementer*, *Schema/Data Specialist*, *Domain
     Specialists* (the deep-domain experts your product needs).
   - **Verify:** *Reviewer*, *QA Engineer*, *Test Engineer*, *Accessibility*, *Local-CI*,
     *Governance Guardian* (architecture/constitution + product-charter conformance).

   The discipline that makes this work: each agent has **one clear job, a defined input, and a
   defined output**. Narrow agents are easier to trust, easier to run in parallel, and easier
   to swap.

3. **Skills — reusable playbooks.** Procedures any agent can invoke on demand, grouped into
   capability buckets: *Scaffolding · Refactor/Quality · Governance · Sprint/Story · CI/Release
   · Docs*. **Stack-specific skills plug in as interchangeable "stack adapters"** — wherever
   you see a tool name (build system, UI framework, ORM, i18n), that's an adapter you swap for
   your own stack. The buckets stay; the adapters change per company.

4. **Workflows — the choreography.** How the above combine into repeatable flows:
   - **`verifier-wave` — the merge gate.** Every non-trivial PR fans out to all Verify agents
     **in parallel**, each working on an isolated copy of the diff. Verdict matrix:
     **all PASS → squash-merge**; **any BLOCK → fix in the PR (cheap) or file a follow-up**;
     **agents disagree → escalate to a human.** Skipped for pure-doc / one-line / rename PRs.
   - **`designer-first` — the design gate.** Inserted *only* for risky or load-bearing work
     (new contracts, cross-cutting changes, migrations with non-obvious rollback). Direction →
     Designer/Architecture Guardian writes a spec → **a human approves** → Implementer builds.
     The default path skips straight to build.
   - **`story-tracker`.** One coarse issue per *stream of work* (not per PR); PRs link via
     `Refs #N`. Replaces local handoff files with durable, shared state.
   - **Sprint loop.** `plan-sprint → sprint-runner → sprint-retro → repeat`.

## How the pieces interact (read the blueprint top-down)

```
Policies constrain every agent
        ↓
Agents flow  PLAN → BUILD → VERIFY
        ↓                 ↘ (risky? insert the design gate first)
Agents invoke Skills (capability buckets + stack adapters)
        ↓
Workflows wire it all into the two gates → merge to main → retro → loop
```

The load-bearing ideas, in one line each:

- **Humans stay in the loop at exactly two points:** setting direction, and approving risky
  designs / resolving agent disagreements. Everything between is automated.
- **Two gates do the quality work:** a *design gate* (catch bad ideas before code) and a
  *merge gate* (catch bad code before main). Most PRs only hit the merge gate.
- **The merge gate is parallel and adversarial:** independent verifiers, each isolated, each
  able to BLOCK. Cheap to run, hard to fool.

## Standing it up in your org

1. Write the five **policy** files first — they're the contract everything else cites.
2. Define **agents** as narrow roles; resist the "one big agent" temptation. Begin with
   *Implementer + Reviewer + Test Engineer*; add specialists as real need appears.
3. Wire the **merge gate** (`verifier-wave`) — this alone delivers most of the value.
4. Add the **design gate** (`designer-first`) once you feel the pain of agents guessing at
   scope on risky changes.
5. Replace each **stack adapter** skill with your own stack's equivalent; keep the buckets.

> The diagrams are intentionally generic. Names like *Governance Guardian*, *Domain
> Specialists*, and *stack adapters* are placeholders for whatever your product and stack
> actually require — fill them in for your context.
