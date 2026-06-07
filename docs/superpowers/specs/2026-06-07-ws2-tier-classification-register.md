# WS-2 — tier-classification register (PROPOSAL, for founder review)

- **Status:** classification proposal — **review gate.** Founder confirms the charter set + resolves the rulings → a stamping subagent applies `tier:`/`scope:` to every doc. No doc stamped yet.
- **Date:** 2026-06-07
- **Author:** orchestrator session (read-only classification audit over `origin/main` HEAD `da4053c`, post-WS-1).
- **Parent:** `2026-06-07-knowledge-corpus-reorg-design.md` (the three-tier taxonomy + identity rule); WS-2 step 1 = ADR-181 amendment (merged, specs #282).

## Counts (≈374 surviving docs)

- **Charter (tier-1, scope: cluster): 27** — 20 ADR + 7 concept.
- **Design-global (scope: substrate): ~205** — ~140 ADR + ~65 concept.
- **Design-local: ~115** — exercir ~78 · health ~28 · devloop ~6 · markets 1.
- **Borderlines flagged: 21** (12 charter-vs-global, 9 local-vs-global/scope).

## 1. Proposed CHARTER SET (27) — the constitutional core

Test applied: *would changing it stop the system being Substrate, or break a cross-pack invariant?*

**ADRs (20):** 176 (minimality+inclusion-test) · 127 (kernel substrate v1 / four concerns) · 153 (PlanNode collapse) · 154 (effect-declaration algebra) · 155 (aggregation semantics) · 027 (pack architecture) · 110 (hex ports) · 152 (amend-110 port-category axis)\* · 115 (pack-hex amendment)\* · 184 (consent foundation) · 187 (ontology-integrity invariants) · 188 (developmental-ethics charter) · 189 (AI-safety ladder) · 179 (scalability invariants) · 213 (subject-ontology generalization) · 178 (ADR-lifecycle/corpus-cleanup charter) · 181 (frontmatter canonical set) · 128 (two-track governance) · 191 (amend-128 specs PR-flow) · 214 (code-English / UI-i18n policy).
*(\* = flagged borderline, see §3.)*

**Concepts (7):** `kernel-substrate-v1.md` · `ring-model-and-kernel-boundary-reference.md` · `substrate-vision-layers-generalization-design-constraints.md` · `prototype-assumptions-charter.md` · `ontology-integrity-invariants-concept.md` · `developmental-ethics-charter-concept.md` · `product-ai-safety-ladder-concept.md`.

## 2. The taxonomy gap (highest-leverage decision — RULING 1)

~30 docs are **neither substrate-mechanism nor pack-local**:
- **Cluster infra/ops** — ADR-019–026 (Infomaniak/SOPS/ESO/passkeys/observability-stack/analytics/capacitor/video), ADR-139–143 (IaC/ingress/cert-manager/reconciliation), `infomaniak-k8s-deploy.md`.
- **Workbench/governance/agent-tooling** — ADR-133–137 (fabricir/eyecatchers/repo-topology/agent-rename), `fabricir-operating-model.md`, `pro-agents-roadmap.md`, `canonical-claude-code-primitives.md`, `vision-to-bricks-audit-2026-05-16.md`, `north-star-vision-capture-2026-05-17.md`.
- **Business / GTM** — `sponsorship-partnerships.md`, `sportfonds-application-template.md`, `swiss-trust-labels.md`, `product-analytics-strategy.md`, the vereins-backoffice + payment drafts.

The decided taxonomy (charter/global-design/local-design × cluster/substrate/domain) has **no scope** for these. They're currently parked at `design-global scope=substrate` by default. **This is the single highest-leverage gap to resolve before stamping** (it reshapes ~30 docs' scope) — RULING 1 below.

## 3. The rulings (resolve the 21 borderlines in batches)

- **RULING 1 — the meta/ops/business scope gap (§2).** Add new scope value(s) vs fold into `substrate`. (Decision pending.)
- **RULING 2 — do amendments inherit the tier of what they amend?** If yes: ADR-152/115 (amend-110)→charter; ADR-149/198 (amend-127)→charter; ADR-150/151 (amend-027)→charter; ADR-191 (amend-128)→charter (already proposed). Resolves borderlines #4/#6/#7. (Decision pending.)
- **RULING 3 — is concern-implementing plumbing charter or mechanism?** The four concerns: plan-tree (153 → charter ✓), observation-log (**ADR-030**?), inference (127 → charter ✓), reproducibility (**ADR-220**?). Plus ADR-204 (re-draws the kernel boundary), ADR-029 (kernel-runtime shape), ADR-168 (bricks "packs compose" corollary to 027), ADR-144 (child-safety data posture — charter like ADR-188?). Resolves #1/#2/#5/#8/#10/#11. (Decision pending.)
- **RULING 4 — scope-inheritance for design concepts.** Proposed rule: *a design concept inherits the scope of the ADR it backs; a substrate change is `substrate` even if demand/demonstration came from a domain.* Applies to: visual-editor ADRs (kernel→global) #13/#14; EPD/FHIR-now-health ADR-081–084/032 + `epd-egd-integration`/`foundation-fhir` (→ health) #16; b1/b3/case-mgmt health-design concepts (→ follow ADR-222/223; global vs health) #18; markets reproducibility proof (→ substrate vs markets) #19; devloop-feedback ADR-196/199 (→ substrate where the change lands vs devloop where demand arose) #17; the pack-oncology-era ADR-095/096 (exercir-era vs health vs dead) #15. (Decision pending.)
- **CHARTER-SET confirmation** — confirm the 27 (§1) + any promotions RULINGs 2/3 imply.

## 4. Next

Founder resolves RULINGS 1–4 + confirms the charter set (walked one-at-a-time). Then a stamping subagent applies the finalized `tier:`/`scope:` to every doc, sorts tier-1/2 into `charter/`+`design/`, relocates tier-3 to domains with stubs, and folds in the `foundation-fhir` stub `moved-to`→frontmatter fix. Full per-doc proposed assignment is in the classification-audit output (this session) — finalized against the resolved rulings at stamping time.

## 5. RESOLVED 2026-06-07 (founder-directed) + execution plan

**Rulings:**
- **R1 → three new design-global scopes:** `platform` (cluster infra/ops/deploy — ADR-019–026, 139–143, infomaniak-k8s-deploy), `meta` (workbench/governance/agents/north-star — ADR-133–137, operating-model, agents-roadmap, vision-to-bricks, north-star), `business` (GTM/product-strategy — sponsorship, sportfonds, trust-labels, analytics; these likely relocate to the specs `business/` dir). Add platform/meta/business to the validator `SCOPE_KNOWN` set so they don't warn.
- **R2 → amendments inherit the amended tier:** ADR-152/115/149/198/150/151 → charter.
- **R3 → charter = definition only:** concern *plumbing* (ADR-030 event-log, ADR-220 reproducibility, ADR-029 runtime, ADR-195/206 distribution) stays design-global; only the concern *definitions* (127/153/154/155) are charter.
- **R4 → scope = where the change/subject lives** (not where demand/demo originated): ADR-196/199 + the b1/b3 design concepts + the markets reproducibility-proof → `substrate`; FHIR/EPD (ADR-081–084/032, epd-egd, foundation-fhir) → `health`; visual-editor kernel parts → substrate, pack-football editor surfaces → exercir.
- **R5 → FINAL CHARTER SET = 33** (26 ADR + 7 concept): base 27 + amendment promotions (149/198/150/151) + **ADR-144** (child-safety, cluster ethical invariant) + **ADR-168** (bricks 'packs compose' UI corollary). ADR-204 stays design-global (it *applies* ADR-176, doesn't *define* it).

**Execution (staged into reviewable PRs):**
- **Stage 2a — STAMP (non-destructive):** add `tier:`/`scope:` frontmatter to all ~374 docs per the resolved classification; add platform/meta/business to validator `SCOPE_KNOWN`; fold in the `foundation-fhir` stub `moved-to`→frontmatter fix. One specs PR — no file moves → no cross-ref breakage.
- **Stage 2b — FOLDER-SORT (destructive, within specs):** tier-1 → `charter/`, tier-2 → `design/`; repoint all referrers (referrer-integrity-critical, like B1). ~230 docs.
- **Stage 2c — TIER-3 RELOCATION (destructive, cross-repo):** ~115 local docs → their domains (exercir 78 / health 28 / devloop 6 / markets 1) with redirect stubs in specs. Multi-repo, multi-PR; sequence per-domain.

**Magnitude note:** the `tier:`/`scope:` *tag* (2a) is the durable classification signal; 2b/2c are a *physical* reorg moving 345+ docs and repointing thousands of cross-refs. Decide full-physical-reorg vs stamp-first/stage-(or-scale-back)-the-moves before starting 2b.
