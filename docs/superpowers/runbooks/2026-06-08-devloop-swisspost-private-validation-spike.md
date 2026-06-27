# Runbook — devloop private-validation spike on a real Swiss Post repo

**Date:** 2026-06-08 · **Posture:** *private validation only* (resolves Open Decision #1 of
the [devloop pilot design](../specs/2026-06-07-devloop-delivery-audit-concierge-pilot-design.md),
on branch `docs/devloop-pilot-and-ideas-inbox`). **Goal:** prove devloop's engine produces
compelling signal on a real engineering org's GitHub *metadata*, and let the gap between raw
output and a sellable Delivery Audit define the report-generator build delta.

> ⚠️ **Data-governance contract for this spike** (founder-accepted):
> Swiss Post is critical national infrastructure. Employee repo *access* ≠ authorization to
> export org delivery-metadata to a personal project. This spike therefore stays **strictly
> local**: an isolated log, no S3 publish, no Swiss Post stakeholder involvement, results used
> only as an anonymized internal reference. Delete the dataset when done.

## Hard guardrails (read before running)

1. **Isolated log** — all data goes to `data/swisspost-validation.jsonl`, NOT the cluster's
   live `data/events.jsonl` (1.1 MB, your real twin — do not pollute it).
2. **NEVER run `publish` / `kg:publish`** during this spike — it's the only code path that
   reaches external S3 (Infomaniak). It ships the KG corpus base, not the event log, but keep
   the rule absolute.
3. **Dedicated shell** — set `$env:DEVLOOP_LOG` in a shell you use *only* for this spike, so
   no later cluster ritual in the same shell accidentally hits the Swiss Post log. It dies
   when the shell closes.
4. **Metadata only** — skip `reconcile` / `sonar-verdicts` (no `SONAR_TOKEN`); GitHub PR
   metadata only.
5. **Delete on done** — `Remove-Item data/swisspost-validation.jsonl` when finished.

## Step 0 — the only code change (enables log isolation)

`src/log.ts:14` hardcodes the log path; make it honor `DEVLOOP_LOG` (the write path; the KG
read path already does). One line:

```diff
- export const DEFAULT_LOG = join(PKG_ROOT, 'data', 'events.jsonl');
+ export const DEFAULT_LOG = process.env['DEVLOOP_LOG'] ?? join(PKG_ROOT, 'data', 'events.jsonl');
```

> This is the *only* code touch for the spike. It is also the first real piece of the build
> delta (per-target isolated datasets), so **harden it into a proper TDD'd PR** once the spike
> proves out — a test asserting `append`/`readEnvelopes` honor `DEVLOOP_LOG`. Don't ship it
> untested long-term.

## Step 1 — isolate the session (PowerShell)

```powershell
cd D:\development\projects\de-braighter\domains\devloop
$env:DEVLOOP_LOG = "data\swisspost-validation.jsonl"   # all reads+writes now hit this file
```

*(bash equivalent: `export DEVLOOP_LOG=data/swisspost-validation.jsonl`)*

## Step 2 — pre-flight: confirm `gh` can see the repo

devloop shells out to `gh`. Confirm auth + the correct host *before* backfill.

```powershell
gh auth status
gh pr list --repo <org>/<repo> --limit 1   # smoke-test access to the target repo
```

- If the repo is on **github.com** under a Swiss Post org and the smoke-test lists a PR → good.
- If Swiss Post uses **GitHub Enterprise Server** (internal host), first
  `gh auth login --hostname <ghe-host>`; the bare `--repo owner/repo` resolves to the default
  host, so you may need the host configured as default or the repo host-qualified. This is the
  one real ingestion unknown to resolve.

## Step 3 — backfill PR metadata (the ingest)

Pick a repo (or several) with **≥5 merged PRs** — `posterior` stratifies per repo and needs
≥5 merges each to fit a distribution.

```powershell
npm run dev -- backfill <org>/<repo>
# more signal = more repos: npm run dev -- backfill <org>/<repoA> <org>/<repoB> <org>/<repoC>
```

Optional richer signal:

```powershell
npm run dev -- reviews <org>/<repo>      # PR reviews as verifier signals (human/copilot/bot)
npm run dev -- attribute <org>/<repo>    # producer attribution from Co-authored-by trailers
```

## Step 4 — run the inference (what the audit is built from)

```powershell
npm run dev -- posterior                       # next-PR cycle time, per repo, with 80% CI
npm run dev -- whatif <org>/<repo> cycle-time   # conditional contrast (may be INCONCLUSIVE — fine)
npm run dev -- reliability                       # verifier/producer trust (likely sparse on SP)
npm run dev -- dashboard                         # writes data/dashboard.html — open in browser
```

**Set expectations:** the strong signal on raw SP metadata is **cycle-time posterior** +
**PR-review/throughput** + the **dashboard**. `reliability`/`calibration`/`qa-baseline` lean on
the cluster's own verifier-wave + `Effect:` declarations, which SP PRs won't have, so they'll
mostly report "no data" — that's expected, not a failure. The *counterfactual interventions*
(the differentiated audit core) need the report-generator that doesn't exist yet — that's
exactly what this spike is sizing.

> ⚠️ `dashboard`/`snapshot` write to the shared `data/dashboard.html` / `data/snapshot.json`
> (their output dir isn't redirected by `DEVLOOP_LOG`). They'll be **SP-derived and overwrite**
> your cluster copies (locally, gitignored). Back up first if you care:
> `Copy-Item data\dashboard.html data\dashboard.cluster.bak.html`, then after generating:
> `Copy-Item data\dashboard.html data\dashboard.swisspost.html`.

## Step 5 — capture the gap, then clean up

What to record (paste back for the next step — sizing the report generator):

- Does `posterior` produce credible, differentiated per-repo cycle times? (the descriptive baseline)
- Is there a visible bottleneck story (review latency, batch size, throughput)?
- What's **missing** to make it a deliverable a stranger would pay for? (narrative framing,
  top-3 bottleneck ranking, the counterfactual "do X → expect Y±Z" layer)

Then:

```powershell
Remove-Item data\swisspost-validation.jsonl    # delete-on-done
Remove-Item Env:\DEVLOOP_LOG                     # or just close the shell
```

## After the spike

The gap surfaced in Step 5 *is* the §4 build delta, now grounded in real output instead of
the abstract. Next: `writing-plans` for (a) hardening Step 0 into a tested per-target log knob,
(b) the audit-report generator (narrative + ranked counterfactual interventions), (c) buyer-
facing dashboard tuning.
