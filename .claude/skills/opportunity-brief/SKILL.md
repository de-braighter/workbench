---
name: opportunity-brief
description: "Foundry pipeline stage 2 — score a Dossier Record's substrate fit (four-kernel-concern decomposition + pack/primitive reuse) and the 8-dimension opportunity rubric, recommend a risk tier, and tee up founder Gate 1 (greenlight) as a foundry gate record. Use when the founder says 'brief <product-key>' or after /dossier-intake completes."
tags: [foundry, assessment, pipeline]
---

# Opportunity Brief (Foundry stage 2)

Scores **substrate fit** — does the idea decompose into the four kernel
concerns? — plus the opportunity rubric demonstrated in
`docs/ideas-inbox/substrate_saas_opportunity_dossier/substrate_saas_opportunity_dossier/01_overview_and_scoring.md`.
Output: `docs/foundry/<key>/opportunity-brief.md`. Spec §3 stage 2.

## Procedure

1. **Read** `docs/foundry/<key>/dossier-record.md` + every asset it manifests.
   No record → run `/dossier-intake` first; never brief from a raw dossier.
2. **Substrate-fit decomposition** — for each kernel concern, say what it would
   concretely be for this idea and judge `natural | forced | absent`:
   - **Plan tree** — what is the single-parent intervention/plan structure?
   - **Event log** — what observations stream in, from where?
   - **Inference** — what posteriors/twins/counterfactuals would users buy?
   - **Reproducibility** — what needs versioned catalogs / replay?
   **Gate rule:** any core concern `absent` → the idea is not substrate-shaped;
   the brief may recommend at most a T0 experiment or `defer`, never a T1+ build.
3. **Reuse inventory** — which existing cluster assets apply (kernel event_log +
   inference backbone, design-system bricks, herdbook/exercir/markets patterns,
   devloop loop, …). Name concrete packages/patterns, not vibes.
4. **Rubric scorecard** — the 8 demonstrated dimensions, scores 1–5, total /40:
   Strategic fit · Market pain · Buyer clarity · Data feasibility ·
   MVP feasibility · Differentiation · Regulatory ease · Platform leverage.
   One sentence of justification per score — a bare number is not a score.
5. **Risk-tier recommendation** — T0 prototype/demo, T1 product, T2 regulated
   (spec §3; the tier table lives in `templates/charter/template.md`). Justify
   against regulatory burden + blast radius.
6. **Recommendation** — build now / defer / decline, the wedge (narrowest
   valuable first slice), and 3-5 what-NOT-to-build candidates for the charter.
7. **Write** `docs/foundry/<key>/opportunity-brief.md`:

   ```markdown
   ---
   product_key: <key>
   brief_date: <YYYY-MM-DD>
   status: brief
   substrate_fit: natural | partial | absent
   rubric_total: <n>/40
   recommended_tier: T0 | T1 | T2
   recommendation: build | defer | decline
   ---

   # Opportunity Brief — <Idea Name>

   ## Substrate-fit decomposition
   ## Reuse inventory
   ## Scorecard
   ## Risk tier
   ## Recommendation & wedge
   ## What NOT to build (charter candidates)
   ```

8. **Gate 1 (founder greenlight).** Present the brief summary. If the founder
   says go: `foundry_gate_request { productKey: <key>, gateType: "greenlight",
   payloadRef: "docs/foundry/<key>/opportunity-brief.md" }` and report the
   gateId. The **charter** (`templates/charter/template.md` →
   `docs/foundry/<key>/charter.md`) is authored only AFTER
   `foundry_gate_decide` approves — the charter binds name, tier, scope,
   what-NOT-to-build, quality plan, gate schedule.

## Failure stances

- Foundry MCP unavailable → write the brief anyway (it's a file); flag that the
  gate record is pending and must be requested when the MCP is back. Never
  treat a chat "looks good" as a decided gate.
- Founder rejects at Gate 1 → record stays with `recommendation` unchanged;
  set frontmatter `status: declined`; nothing is deleted.
