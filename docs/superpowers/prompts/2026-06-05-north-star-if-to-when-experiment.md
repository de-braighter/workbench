# Next-session prompt — north-star "if → when" load-bearing experiment

- **Date:** 2026-06-05
- **Purpose:** A copy-paste session-kickoff prompt that runs the substrate north-star's single *load-bearing experiment* — reproducible + deeper inference (kernel concern #4 + a real non-conjugate inference family) — to find out, cheaply and early, whether the north-star is "when" or still "if".
- **Why this framing:** The substrate *core* (the typed recursive twin kernel) is proven across five domains — that part is "when". The *compound* (general probabilistic inference at interactive latency + the cross-consumer subtree-registry flywheel) still carries genuine "if". Concern #4 — reproducible, deeper inference — is the falsifiable line between them. This prompt aims one experiment straight at that line instead of trying to build the whole north-star, so an "if" shows its face early and cheaply rather than after a long build.
- **Context to load:** memory note `substrate-coherence-remediation-program`; on `origin/main` — ADR-218 (north-star critical-path sequencing), ADR-216 (gated model-proposal — blocked on WS-9), WS-9 epic `substrate#97`, north-star doc §9.3 + §15.1 + Q6.
- **Note:** it does NOT pick the product vertical (founder's open decision, ADR-218 OQ-1) and does NOT require WS-8 first — the experiment runs on `markets` as-is.

## The prompt (paste into a fresh session launched from `de-braighter/`)

```text
Goal: find out — cheaply and early — whether the substrate's north-star is "when"
or still "if", by building the one part that's genuinely uncertain: REPRODUCIBLE,
DEEPER INFERENCE (kernel concern #4 + a real non-conjugate inference family). This
is the falsifiable test: if it lands cleanly, the north-star tilts to "when"; if it
resists (latency, or the model has to be clipped so hard the twin stops being
honest), surface exactly where and why — that's the "if" showing its face.

Orient first. Read the memory note "substrate coherence remediation program" (in
your memory index), and on origin/main read: ADR-218 (north-star critical-path
sequencing), ADR-216 (gated model-proposal — it's blocked on WS-9), the WS-9 epic
substrate#97, and the north-star doc §9.3 + §15.1 + Q6 (reproducibility + inference
cost — the honest cons). Verify origin/main before trusting any local checkout
(last session's lesson: the cluster was healthier than stale local branches said).

The experiment — smallest real version. Do NOT build the whole north-star, the
general PPL, or the subtree registry. Run it on the thinnest existing domain
(markets — cleanest event->posterior loop; it already works with the kind:'person'
workaround, so you do NOT need WS-8 first — WS-8 is for the product path, not this
test):
  1. Reproducibility (WS-9 core): a versioned catalog table + a persisted
     RunManifest + a replay that reproduces a historical posterior BIT-FOR-BIT from
     the pinned catalog version + event log. No domain has done concern #4 yet —
     this is its first real proof.
  2. Inference depth: add ONE genuinely non-conjugate / richer likelihood beyond
     Normal-Normal + Beta-Binomial (a survival or categorical/multinomial outcome),
     in-process JS/TS first (NumPyro sidecar stays off the menu until in-process
     limits are concrete). Produce a real, correct, non-trivial posterior.
  3. Measure honestly against §15.1: record actual latency. Interactive-enough =
     "when" evidence; if it forces a latency/expressiveness tradeoff that clips the
     model, document precisely where that line is — that's the "if".

Process: designer-first (substrate-architect designs the WS-9 + new-family shape as
an ADR/concept before any code), then subagent-driven execution. Worktrees off
origin/main for every repo touch (parallel sessions are live); PR-gated everywhere;
twin ritual after each merge; respect the substrate@1.0 batch context. Don't pick
the product vertical (that's my open decision — ADR-218 OQ-1).

Deliverable: a working reproducible-replay + a second real inference family on
markets, AND an honest one-paragraph verdict — did concern #4 + deep inference
crack (north-star -> "when"), or where did it resist (the "if", and what it'd take)?
Close with the updated product-path sequencing given what you learned.
```
