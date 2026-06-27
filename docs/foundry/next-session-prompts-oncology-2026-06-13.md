# Next foundry session prompts — oncology frontier (2026-06-13)

The agri build path is exhausted (10/10 done). The only remaining foundry work is
the **oncology** product (7 items, all **T2 = founder-launch-only**), so the pool
loop won't auto-claim them — you launch them by hand in **item mode**.

> **LIVE STATUS (2026-06-13, refreshed):** `O-1` is **IN FLIGHT** — claimed by an
> active worker session (`sess-20260613-085840-d5d4`, healthy heartbeat). Do **not**
> relaunch it. The **launch-ready** set right now is **`O-6.1` ∥ `O-6.2`** (independent
> hardening items, disjoint substrate scopes → safe to run in parallel). `O-2` / `O-3` /
> `O-6.3` stay **dep-blocked** behind O-1; `O-5` (egress) stays **held** behind the
> rung-2 ship gate (re-request when O-4 merges + rung-1 evidence exists).

## How to start a session

1. Open a **fresh** Claude Code session from the cluster root
   `D:\development\projects\de-braighter` (fresh context per item is the design).
2. Pick the item (start with **O-1** — it's the foundation; the other 4 queued
   oncology items `dependsOn` it). O-6.1 and O-6.2 are independent hardening items
   and can run in **parallel** sessions alongside O-1 (disjoint scopes — different
   repos/paths, the foundry server already verified non-overlap).
3. Paste one prompt block below into that session. (Or just type `/foundry-worker`
   and name the item — the skill does the rest. The paste is the fully-explicit form.)
4. **Pin the session model** (`/model` → Opus 4.8 or whatever's stable). Lesson from
   today: a worker that inherited an unavailable model died mid-run and orphaned its
   claim. If the worker spawns sub-agents, they inherit the session model.

Recommended order (live): **O-1 is already in flight** — launch **O-6.1 ∥ O-6.2 now**
(parallel; disjoint scopes). O-2/O-3/O-6.3 unlock when O-1 merges.

---

## O-1 — PHI data layer + substrate-2.x foundation  (⚠ IN FLIGHT — claimed; relaunch ONLY if the claim goes stale)

Repo `de-braighter/health` · scope `libs/health-api/` · T2

```text
You are a Foundry worker session. Work EXACTLY one work item, then stop.

Item: oncology/O-1 — Oncology PHI data layer patient→tumor→observation + substrate-2.x foundation: add encrypted/RLS-isolated/blind-indexed tumor + observation tables; pass prismaClient to forRoot so fieldEncryptionExtension gets the live relation graph (_runtimeDataModel) and nested-PHI encrypts fail-loud; bump the workspace to substrate ^2.1.0 (atomic across both libs + root lockfile) with the 6-arg router migration. Foundation — every health item dependsOn this. Designer-first ADR extending ADR-222.
Product: oncology (risk tier T2) · Repo: de-braighter/health
Scope (hard boundary — do not touch anything outside it): de-braighter/health — paths under libs/health-api/
Quality obligations (tier floor): verifier-wave-full, synthetic-cohorts-no-real-phi, mutation-t2-where-battery-exists, designer-first-adr-new-port, phi-encrypted-at-rest-and-in-transit, blind-index-queryable-phi, relation-graph-wiring-reverify, rls-secure-by-default, assert-non-superuser-db-suites, consent-audit-tamper-evident

Invoke the workbench skill foundry-worker (Skill tool) and follow it end to end — it is the canonical session protocol. Fallback protocol if the skill is unavailable — mandatory, in order:
1. CLAIM — mint a session id (sess-<yyyyMMdd-HHmmss>-<4 hex>), derive your worktree (<repo-local-path>/.claude/worktrees/<item-slug>) and branch (feat/<item-slug>), then call foundry MCP tool foundry_claim with { itemId: "oncology/O-1", sessionId, worktree, branch }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create the claimed git worktree and work only there; never in the shared clone.
3. EXECUTE — implement the item within its scope. Route through existing skills (superpowers:subagent-driven-development for plan execution).
4. QUALITY — run the repo's local gates (ci:local) and the verifier wave per risk tier T2; post findings to the PR before merge.
5. LAND — open a PR carrying Producer:/Effort:/Effect: lines; merge per tier policy; run the devloop twin ritual (drain -> backfill -> reconcile).
6. RELEASE — call foundry_release with { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }; if you cannot finish, release with outcome "blocked" and a note instead.

During long work call foundry_heartbeat with your claimId at least every 2 hours, or the claim goes stale and may be reclaimed.
```

---

## O-6.1 — cloud-KMS adapter behind KmsKekClient

Repo `de-braighter/substrate` · scope `libs/substrate-runtime/src/adapters/field-encryption/` · T2

```text
You are a Foundry worker session. Work EXACTLY one work item, then stop.

Item: oncology/O-6.1 — Real cloud-KMS adapter behind the existing KmsKekClient port: implement a production cloud-KMS-backed KEK client (replacing the dev-only in-memory KEK) for the B1 envelope-encryption stack. The port already exists — this is the provider implementation + a provider-choice ADR (designer-first). No new port.
Product: oncology (risk tier T2) · Repo: de-braighter/health
Scope (hard boundary — do not touch anything outside it): de-braighter/substrate — paths under libs/substrate-runtime/src/adapters/field-encryption/
Quality obligations (tier floor): verifier-wave-full, synthetic-cohorts-no-real-phi, mutation-t2-where-battery-exists, designer-first-adr-new-port

Invoke the workbench skill foundry-worker (Skill tool) and follow it end to end — it is the canonical session protocol. Fallback protocol if the skill is unavailable — mandatory, in order:
1. CLAIM — mint a session id (sess-<yyyyMMdd-HHmmss>-<4 hex>), derive your worktree (<repo-local-path>/.claude/worktrees/<item-slug>) and branch (feat/<item-slug>), then call foundry MCP tool foundry_claim with { itemId: "oncology/O-6.1", sessionId, worktree, branch }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create the claimed git worktree and work only there; never in the shared clone.
3. EXECUTE — implement the item within its scope. Route through existing skills (superpowers:subagent-driven-development for plan execution).
4. QUALITY — run the repo's local gates (ci:local) and the verifier wave per risk tier T2; post findings to the PR before merge.
5. LAND — open a PR carrying Producer:/Effort:/Effect: lines; merge per tier policy; run the devloop twin ritual (drain -> backfill -> reconcile).
6. RELEASE — call foundry_release with { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }; if you cannot finish, release with outcome "blocked" and a note instead.

During long work call foundry_heartbeat with your claimId at least every 2 hours, or the claim goes stale and may be reclaimed.
```

---

## O-6.2 — WORM trigger on kernel.audit_event*

Repo `de-braighter/substrate` · scope `libs/substrate-runtime/src/audit/` · T2

```text
You are a Foundry worker session. Work EXACTLY one work item, then stop.

Item: oncology/O-6.2 — substrate#137 — adopt the BEFORE-UPDATE/DELETE WORM trigger on kernel.audit_event*: the published PrismaAuditEventRepository chain-append uses SELECT FOR UPDATE which needs UPDATE priv, incompatible with the append-only WORM grant (42501 under the app role). Adopt the stronger trigger pattern health already proved (the migration is outside src/audit/ — owned by this item). Hardens the durable audit chain.
Product: oncology (risk tier T2) · Repo: de-braighter/health
Scope (hard boundary — do not touch anything outside it): de-braighter/substrate — paths under libs/substrate-runtime/src/audit/
Quality obligations (tier floor): verifier-wave-full, synthetic-cohorts-no-real-phi, mutation-t2-where-battery-exists, assert-non-superuser-db-suites

Invoke the workbench skill foundry-worker (Skill tool) and follow it end to end — it is the canonical session protocol. Fallback protocol if the skill is unavailable — mandatory, in order:
1. CLAIM — mint a session id (sess-<yyyyMMdd-HHmmss>-<4 hex>), derive your worktree (<repo-local-path>/.claude/worktrees/<item-slug>) and branch (feat/<item-slug>), then call foundry MCP tool foundry_claim with { itemId: "oncology/O-6.2", sessionId, worktree, branch }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create the claimed git worktree and work only there; never in the shared clone.
3. EXECUTE — implement the item within its scope. Route through existing skills (superpowers:subagent-driven-development for plan execution).
4. QUALITY — run the repo's local gates (ci:local) and the verifier wave per risk tier T2; post findings to the PR before merge.
5. LAND — open a PR carrying Producer:/Effort:/Effect: lines; merge per tier policy; run the devloop twin ritual (drain -> backfill -> reconcile).
6. RELEASE — call foundry_release with { claimId, outcome: "done", prRef: "<owner>/<repo>#<pr>" }; if you cannot finish, release with outcome "blocked" and a note instead.

During long work call foundry_heartbeat with your claimId at least every 2 hours, or the claim goes stale and may be reclaimed.
```
