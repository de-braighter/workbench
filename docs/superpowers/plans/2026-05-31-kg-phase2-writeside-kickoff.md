# Kickoff prompt — KG Phase 2 (write-side emit-loop)

> Paste the block below into a fresh session to pick up Phase 2. It's self-contained;
> the auto-loaded memory note carries the full prior state.

---

Pick up **Phase 2 of the SDLC knowledge graph: the write-side emit-loop.**

**First, read the memory note `strain-kep-knowledge-graph-direction`** (auto-loaded via MEMORY.md) — it has the complete state. One-sentence summary: the read-side KG is **built + cloud-published** — read-side module in `domains/devloop/src/knowledge-graph/` (devloop#33), MCP-registered cluster-wide (workbench#46), Stage 1 local S3 sharing (devloop#34), Sonar debt cleared (devloop#35), Stage 2 nightly **CronJob live on the Infomaniak cluster** publishing the memory-free base to Object Storage (platform#8), MCP wired to the cloud bucket (workbench#51). Tools: `kg_context` / `kg_query` / `kg_rebuild`. Serving precedence: S3 cloud base → local cache → local build, then local-memory overlay.

**Phase 2 goal:** close the read+**WRITE** loop — sessions *emit* their activity (decisions, PRs, declared/observed effects, retros, lessons) so the graph **evolves** and the next session stands on what the last one learned ("knowledge that evolves"). devloop is the home precisely because it owns the append-only event log (`data/events.jsonl`) that the write-side fuses into.

**Start with the brainstorming skill.** Open design questions to resolve there:

1. **What's emitted + by what mechanism?** devloop ALREADY logs SDLC events (`PrOpened`/`PrMerged`/`VerdictRecorded`/`ProducerAttributed`/`EffectDeclared`/`EffectObserved`/`RetroSignal` — via the CLI `backfill`/`drain`/`reconcile`/`retro` + the `SubagentStop` hook). So is Phase 2 mostly **"project the existing event log into the graph as activity nodes/edges"** (kg_context then surfaces recent relevant decisions/PRs/retros *alongside* ADRs), or also a NEW capture path for session decisions/lessons?
2. **Activity vs memory vs corpus.** Activity (PRs, decisions) is cluster-**shared** (could enter the cloud base); memory is personal/local. Where does activity sit in the shared-base / local-overlay model — a third "activity" layer? Does activity go to the cloud bucket too, or stay a separate projection?
3. **Capture trigger.** A hook (SessionStart/Stop / per-PR), a CLI (`devloop emit …`), or *derive* from git + PRs + the existing event log? Avoid manual authoring (it rots — "store generators, derive graphs").
4. **Fusion / edges.** kg projection = corpus + memory-overlay + **activity**. How do activity nodes link to corpus nodes? (A PR `implemented-by` an ADR already exists in frontmatter; a decision `relates-to` a concept; a retro `mentions` a node.) Reuse the existing `deriveMentionEdges` / typed-edge machinery.
5. **Freshness + dedup.** Activity grows unbounded; cap/window it (recent N, or by relevance). Don't double-count events already in the log.

**Constraints (carry from the prior arcs):**
- **No kernel change** — internal devloop tooling per ADR-176; reuse the Stage-1 S3/overlay/serving machinery; the image carries to cloud unchanged.
- **Conventions:** ESM `.js` imports, `noUncheckedIndexedAccess`-clean `src/**`, tests nested `test/knowledge-graph/`, vitest. English for all coding/docs.
- **Rhythm:** brainstorm → spec → plan → subagent-driven implement → verifier wave + **Sonar babysit** → PR-gated merge (the local Sonar stack is the `db-sonar-*` docker containers; mint token via `SONAR_ADMIN_PW` in `de-braighter/.env`; devloop `main` is currently Sonar-green — keep it that way; own-code-clean, leave pre-existing as documented).
- **Gotchas banked in memory:** the `docker push` / `kubectl` classifier blocks (allow rules or `!`-prefix), the Infomaniak NodePort TLS quirk (insecure-skip-tls-verify on `~/Downloads/pck-7e3mues-kubeconfig`), and the `resolveRef`/amendment-slug/mentions-scan-summary-not-body subtleties.

**Deliverable:** the write-side that makes `kg_context` answer "what did we recently decide/ship that bears on this task?" — not just "what do the specs/memory say?"

---
