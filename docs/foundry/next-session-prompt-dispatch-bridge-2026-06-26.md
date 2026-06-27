# Next-session prompt — implement ADR-278 (the headless dispatch bridge, rung 1)

Paste the block below into a **fresh Claude Code session launched from the cluster root**
(`D:/development/projects/de-braighter/`). It is self-contained; the design is already
merged (ADR-278 on `specs` main), so this is an EXECUTE task, not a design task.

---

You are implementing **ADR-278 — the headless dispatch bridge** (rung 1 of the founder's
north-star: *"the plan studio to do dev with, calling you only in headless mode"*). The
design is DONE and merged; build it.

**READ FIRST (authoritative — do not re-derive):**
- `layers/specs/adr/adr-278-headless-dispatch-bridge.md` — THE spec + the six ratified
  decisions **D-1…D-6** (read the whole thing; build to exactly these).
- `domains/foundry/src/workflow/actions.ts` — the **`dispatch-review`** declared-actuator
  (the precedent `dispatch-worker` mirrors: a THIN, side-effect-free action that returns a
  descriptor and calls NO store-locked op).
- `domains/foundry/src/prompts.ts` (`renderSessionPrompt`), `src/ops.ts` (`nextItems` /
  `foundry_next`), `src/wt-pool.ts` (warm pool), `src/mcp/server.ts` (MCP registration +
  the `JSON_OBJECT_ARG` typed-arg pattern), `src/dashboard/` (the cockpit).
- Memory: `[[studio-foundry-fusion-arc]]`, `[[deterministic-generation-fusion-arc]]`
  (the dispatch-bridge north-star note), `[[foundry-substrate-self-application-arc]]`.

**THE DECISIONS (ADR-278 — build to these exactly):**
- **D-1** mechanism = **subscription / `claude -p`** + `CLAUDE_CODE_OAUTH_TOKEN`. NOT the
  Agent SDK (Anthropic prohibits subscription auth for the SDK). The founder runs
  `claude setup-token` once and the daemon inherits the token; children inherit it too.
- **D-2** trigger = an **autonomous daemon** `foundry-dispatchd` (full unattended drain).
- **D-3** home = a **foundry tool**: the daemon + a `foundry_dispatch` MCP (start | stop |
  status) the cockpit calls; reuse `foundry_next` + `renderSessionPrompt` + the warm pool.
- **D-4** worker creds = **inherit the founder's ambient env** (SSH key → git push, `gh`
  token → PR create/merge, `CLAUDE_CODE_OAUTH_TOKEN` → model); spawn cwd = cluster root so
  the foundry MCP loads from `.mcp.json`; never `--bare`. Commits/PRs are authored as the
  founder.
- **D-5** concurrency/model = **conservative + tiered**: cap N (default 2–3) + 429 backoff
  (one shared Max rate cap); model per item via `claude -p --model` (cheaper for
  green-desk/debt, capable for T1+/product). N is config.
- **D-6** regulated = **all tiers dispatched; T2 builds then HALTS at the founder ship gate**
  (never auto-merges). The daemon never decides a gate or merges T2.

**BUILD (5 components):**
1. **`dispatch-worker` action** (`workflow/actions.ts`) — a THIN side-effect-free
   declared-actuator mirroring `dispatch-review`: returns `{ kind:'dispatch-worker',
   target, limit?, requestedAt }`, calls NO store op (replay-safe). Add to
   `ACTION_REGISTRY` and **update the exact-membership acid test**.
2. **`foundry-dispatchd` daemon** (new module, e.g. `src/dispatch/`) — the loop: read the
   claimable frontier (`foundry_next`, pool-eligible) → spawn up to N headless
   `claude -p` workers → each self-`foundry_claim`s (the claim is the dedup + record) →
   backoff on 429 → repeat until drained. Safety mechanics (mandatory): concurrency cap,
   429 backoff, **kill switch** (cockpit stop + a flag/heartbeat the loop checks),
   **crash-recovery** (lean on the atomic-claim TTL; reconcile against merged PRs, not
   heartbeats — the orphaned-claim lesson). Keep the loop pure/testable; the actual spawn
   is an injected boundary you can mock.
3. **`foundry_dispatch` MCP** (`mcp/server.ts` + `mcp/tools.ts`) — start | stop | status.
   Type the args properly (the `JSON_OBJECT_ARG` lesson: the MCP input schema is SEPARATE
   from ops/events; an object arg must render `type: object` or the client stringifies it).
4. **The `claude -p` spawn mechanic** — reuse `renderSessionPrompt` for the worker prompt;
   env = inherited `CLAUDE_CODE_OAUTH_TOKEN` + `--model <tier>`; confirm the spawned worker
   gets the foundry MCP (cwd = cluster root → `.mcp.json`).
5. **The cockpit control** (`src/dashboard/`) — start/stop/status surface (sibling of the
   ADR-267 Authorize/Advance buttons) calling `foundry_dispatch`.

**HARD CONSTRAINTS:**
- **ADR-176: kernel grows by ZERO** — pack/tooling only; NO new event type (the claim is
  the durable record); nothing reaches `@de-braighter/substrate-*`.
- Reuse the spine (worker protocol, atomic claim, warm pool, action registry,
  `foundry_next`, `renderSessionPrompt`, gates, verifier wave, twin) — add only the
  declared-actuator + the daemon/runner + the MCP + the cockpit control.
- `dispatch-worker` stays side-effect-free (replay-safe) like `dispatch-review`.
- Governance: spawn only *claimable* items; gates halt; T2 builds-then-gate-halts; the
  daemon never merges T2 or decides a gate.
- D-1: `claude -p`, never the Agent SDK.
- Do NOT touch `domains/studio/libs/board-editor` (separate live chain).

**PROCESS:** designer-first is DONE (ADR-278 merged) → EXECUTE via
`superpowers:writing-plans` → `superpowers:subagent-driven-development`; TDD. PR-gated;
foundry is **T0** → standard verifier wave (reviewer + qa-engineer + charter-checker),
post findings to the PR before merge; twin ritual after merge (drain → backfill →
reconcile from `domains/devloop`). PR body carries `Producer:` / `Effort: deep` /
`Effect: cycle-time`. Work in a git **worktree off origin/main** — **`git fetch origin
main` + verify the fresh worktree first** (sibling clones go stale; this bit the prior
session). Never bypass pre-push hooks.

**GOTCHAS (this cluster):**
- The running foundry MCP server is LONG-LIVED — it won't expose the new `foundry_dispatch`
  tool until the founder reconnects (`/mcp` → reconnect foundry). Prove via unit/acid tests;
  ask the founder to reconnect for a live smoke.
- markdownlint MD004: a text-wrap landing `+ ` at a line start trips the list-marker rule —
  reword.
- foundry worktree resolves `node_modules` from the parent clone (no install needed); the
  full vitest collect is slow under load + can flake on timeouts — run targeted tests to
  isolate real failures.
- Windows worktree dirs lock on delete (`git worktree prune` deregisters; the dir is
  harmless env-debt).

**ACCEPTANCE (rung 1 done):**
- `dispatch-worker` in `ACTION_REGISTRY` (exact-membership acid updated), proven
  side-effect-free / replay-safe.
- `foundry-dispatchd`: spawns ≤N headless `claude -p` workers over the claimable frontier,
  claim-as-dedup, backoff, kill switch, crash-recovery — all test-proven (spawn mocked).
- `foundry_dispatch` MCP (start/stop/status) + the cockpit control.
- `ci:local` green; verifier wave per tier; charter-checker COHERENT (kernel grows by
  zero); twin ritual run.
- Live smoke (after the founder runs `claude setup-token` + reconnects the MCP): start the
  daemon on a small NON-T2 frontier → it spawns a worker that claims → builds → opens a PR;
  a T2 item halts at the gate. (Headless dogfood: this is the bridge dispatching itself.)
