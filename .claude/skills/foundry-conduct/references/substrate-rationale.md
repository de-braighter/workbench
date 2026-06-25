# Why autonomous mode is an Agent-loop, not a Workflow (substrate rationale)

> Load this when you need the *reasons* the conductor's three modes split across two
> execution substrates — e.g. when extending the conductor, debugging why a Workflow
> worker can't self-wave, or deciding which substrate a new mode belongs on. The core
> SKILL.md states the rule (preview/build = Workflow; autonomous = Agent-loop); this is
> the empirical justification.

## Substrate (autonomous mode)

Autonomous mode is run **BY THE SESSION** as an `Agent`-loop — NOT via the Workflow tool.
Three reasons make this mandatory:

1. **Workers must run their own verifier waves.** A Workflow `agent()` node is a leaf (no
   `Agent`/`Task` spawn primitive in its toolset — verified 2026-06-13). Regular `Agent`-tool
   subagents DO carry the `Agent` tool and CAN fan out child agents, so workers dispatched via
   `Agent(...)` can run their own `reviewer + qa-engineer + charter-checker` wave. In a
   Workflow, this is structurally impossible.
2. **Async founder-gate wait.** The conductor must poll and wait for `foundry_gate_decide`
   outcomes (which arrive out-of-band, hours later) — a Workflow cannot suspend across turns.
3. **Runs until context-critical.** The loop continues for N passes over an evolving frontier
   and must detect and react to its own context budget — a session can introspect this; a
   Workflow cannot.

The `preview` and `build` modes stay Workflow-based (bounded, deterministic, journaled,
resumable). Autonomous is Session-based (continuous, auto-merge, async-gate-aware,
workers-self-wave).

## Why workers don't run their own wave — and when they do (substrate matrix)

This depends on which conductor mode is active:

**In `preview` / `build` modes (Workflow substrate):** A Workflow `agent()` node is a **leaf**
— its toolset carries no `Agent`/`Task` spawn primitive (verified empirically 2026-06-13:
a Workflow agent has Bash/Edit/Read/Skill/ToolSearch/Write/… but no subagent-spawn tool).
Therefore a Workflow worker **cannot** dispatch its own verifier-wave sub-agents. Review is
a **sibling pipeline stage** the conductor Workflow runs itself:
`pipeline(items, buildWorker, reviewWave, mergeOrGate)` — buildWorker and the wave-agents are
sibling leaf nodes at the top level. In `build` mode v1, review/merge stay out-of-band
(workers build to a PR; the founder/orchestrator reviews + merges). The slice-2.1 increment
adds the review stage as a sibling Workflow pipeline stage — never inside a worker node.

**In `autonomous` mode (Agent-loop substrate):** Workers ARE regular `Agent`-tool subagents,
dispatched via `Agent({ ... })` in the session loop — **not** via the Workflow `agent()` primitive.
Regular `Agent` subagents carry the `Agent` tool and CAN fan out children. Therefore autonomous
workers **DO run their own verifier wave** (reviewer + qa-engineer + charter-checker as sibling
`Agent` sub-calls inside the worker). This self-wave is the prerequisite for the conductor's
merge rule: the conductor merges on `waveVerdict = 'green'` returned by the worker, not on
a separate sibling pass.

**The capability matrix (empirically verified 2026-06-13):**

| Execution context | Can fan out sub-agents? | Wave inside worker? |
|---|---|---|
| Regular `Agent`-tool subagent | **YES** — `Agent` tool is in its toolset | **YES** (autonomous workers) |
| Workflow `agent()` node | **NO** — leaf; no spawn primitive | **NO** (preview/build workers) |

This is the substrate trade-off that makes autonomous mode an Agent-loop, not a Workflow.
