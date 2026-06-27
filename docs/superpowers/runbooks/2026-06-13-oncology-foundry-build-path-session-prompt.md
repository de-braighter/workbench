# Session prompt — oncology build path into the foundry queue (coarse-grained)

> Paste everything below the line into a fresh session launched from `de-braighter/`.

---

Fill the **foundry queue with the oncology-path work items** — coarse-grained build
path this session; claimant worker sessions do the fine-grained planning
(brainstorming → writing-plans → implement) per the foundry-worker protocol. Nothing
is implemented this session.

CONTEXT (verify, don't re-derive):

- Read memory FIRST: **second-brick-oncology-direction** (the backlog + every gotcha)
  + **foundry-multi-product-machine-arc** (queue mechanics + the F4 invariants that
  bite). north-star-thesis-test-arc only if the registry comes up — it is PARKED
  (C4 PASS, Option-A consumer-pull brake).
- **Foundry pipeline stages 1–3 are already SATISFIED for oncology** by the ratified
  charter: `layers/specs/concepts/oncology-product-charter.md` + ADR-221/222/223
  (+ ADR-218 sequencing). Do NOT run dossier-intake or opportunity-brief. Jump to the
  **/build-path stage, adapted**: `charterRef` points at the ratified charter; the
  build-path doc lands in `docs/foundry/oncology/build-path.md` (workbench, PR-gated).
- **Risk tier = T2 (regulated)** — per-ADR gates + designer-first for new ports;
  highest quality battery. This is the foundry's first T2 product; the charter (not
  the prototype-assumptions-charter, which is superseded for this domain) governs.
- Already DONE — do not queue: B1 PHI field-encryption (S1–S6 + durable audit,
  health-api live proof), B3 survival family first arc (S1–S5b incl. the §11
  validation gate), substrate 2.0.0/2.1.0 published.

THE TASK:

1. `foundry_status` first — see the board (agri items are queued; don't disturb).
2. Draft the **coarse epic ladder** (herdbook E1…En style). Candidate cut — verify
   against memory + charter; the founder owns the final shape:
   - **O-1 health PHI data layer** — oncology schema patient → tumor → observation on
     `domains/health` (health-api). MUST fold in the standing B1 follow-up: when
     related PHI tables land, `fieldEncryptionExtension` needs the relation graph
     from `client._runtimeDataModel` (S6 passed NO prismaClient → empty graph;
     nested-PHI fails loud at best) + blind-index columns on the new tables.
   - **O-2 breast-survivorship pathway plan-tree** — pack-side kernel plan tree +
     effect declarations; clinical content from `concepts/swiss-top5-cancer-pathways.md`
     (reuse the content, NOT its superseded architecture). Synthetic/demo cohorts.
   - **O-3 survival-twin wiring** (the shrunk S6): seed a synthetic real-shaped
     cohort into the health event_log → survival posterior through the §11-gated
     family → replay/manifest on the health DB. dependsOn O-1, O-2.
   - **O-4 B2 EPD-FHIR ingest** — fhir-pro lane: R4 + CH Core + IHE MHD, sandboxed
     per charter; maps into the O-1 schema. dependsOn O-1.
   - **O-5 B4 egress** — **rung-2-gated, LAST**; model the charter rung as a foundry
     founder gate (gate_request), not just dependsOn.
   - **O-6 hardening tail** (small, parallel-friendly, mostly other repos → disjoint
     by repo): real cloud-KMS adapter behind `KmsKekClient` (substrate); substrate#137
     WORM-trigger adoption (substrate); health `requireScope` unit test + non-app
     `closeAnchor` role (health).
   - **NOT queue items:** charter §12 founder/consultant matters (MDR conformity
     route, notified body, CH-REP, mCODE profile set) — record them in the build-path
     doc as gates/risks, not work.
   - Coarse means: per item ~5–10 lines — scope, deliverable, acceptance SKETCH,
     dependsOn, lane, qualityObligations. NO step lists, NO code. Claimants run
     designer-first + writing-plans themselves (T2 mandates it).
3. **Founder checkpoint (AskUserQuestion) on the ladder BEFORE any push** — item cut,
   ordering, what's gated vs queued.
4. Push via `foundry_queue_push` honoring the F4 invariants verbatim (they bite):
   - product block (registration is **WRITE-ONCE** — get it right the first time):
     `productKey: oncology`, `name`, `repo: de-braighter/health`, `riskTier: T2`,
     `charterRef` → the ratified charter path, sensible `priority`.
   - **Unordered-pair disjointness proof table** in the build-path doc (pathPrefix
     authoritative; dependsOn-ordered pairs may share scope); cross-repo items are
     disjoint by `scope.repo`.
   - **No dangling dependsOn** (queue_push accepts them silently → bricked item; the
     F1 retire-op gap means an unclaimable bad item can't be retired today).
   - Shared surfaces (route tables, root config, package.json/lockfile) → a
     sequencing item parallel items depend on.
   - qualityObligations verbatim from the charter + T2 battery (full verifier wave;
     designer-first ADR for any new port; no-real-PHI / synthetic cohorts; any fit
     cites the §11 gate; `assertNonSuperuser` in DB suites; mutation t2 where the
     battery exists).
5. Land the build-path doc as a workbench PR (Producer/Effort/Effect lines, twin
   ritual after merge). Hand-off: succeeding worker sessions just run
   **/foundry-pool** (workbench#128 — self-serves the top claimable item under the
   full foundry-worker protocol); `foundry_session_prompt` per item remains
   available if the founder wants targeted launches instead.

KNOWN TRAPS (carried from memory — restate in items where relevant):

- **Published-vs-main**: adjudicate substrate API claims against the consumer's
  `node_modules` d.ts, never `layers/substrate` source. health-api predates 2.x —
  whether O-1 needs the `^2.1.0` bump (6-arg router per
  `substrate/docs/migration-substrate-2.0.md`) is a claim-time verification, note it
  on O-1.
- Windows MAX_PATH in claim worktrees → `.npmrc virtual-store-dir-max-length=60`
  (pnpm repos); health dev DB = `health-postgres` :5546, substrate dev :5544.
- post-findings: severity enum `blocking|should-fix|nit|note`, FULL `owner/repo#pr`,
  out-of-diff paths cause 422.
- Standard block: worktree isolation everywhere, fresh install per worktree, never
  git ops in shared clones, freeze-merge `--admin`, ritual args (drain/reconcile
  short `repo#pr`, backfill `OWNER/REPO`).

ADJACENT BUT NOT THIS SESSION'S SCOPE (park unless the founder pulls them in):
vendor-only registry v1 — **authorized to proceed ahead of consumer pull**
(ADR-218 second amendment, specs#302; §15.2 vendor-only invariants intact) but it
is a SEPARATE designer-first substrate-architect arc, not an oncology queue item;
exercir log-odds/2.x follow-ups; the foundry conductor + F1 retire-op; devloop
test-hardening backlog.
