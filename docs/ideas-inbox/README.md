# Ideas inbox — drop zone for raw founder inputs to be ingested

This folder is the **stable drop zone** for raw product/domain ideas you want me to
ingest, evaluate, and park — before any of them go near the `/new-domain` scaffolder.
It replaces the ad-hoc "drop a zip in Downloads and paste the path" dance.

## What to drop here

Anything that carries an idea — no format rules:

- markdown / text notes (`*.md`, `*.txt`)
- PDFs, slide exports, one-pagers
- prototype bundles (`*.zip` — e.g. the markets / Strain prototypes)
- screenshots / sketches (`*.png`, `*.jpg`)

Optional but helpful: prefix the filename with a short slug so I can tell them apart,
e.g. `crm-incrementality-notes.md`, `loyalty-program-prototype.zip`.

## How to trigger ingestion

Drop the files, then say **"ingest the inbox"** (or name a specific file). For each
idea I will, in the same spirit as the CRM evaluation:

1. **Evaluate it honestly** — steelman, then stress-test against how the kernel
   actually works (the four concerns + the ADR-176 inclusion test) and where the
   cluster is strategically. No cheerleading.
2. **Produce a fit-evaluation concept doc** → `docs/superpowers/specs/<date>-<slug>-substrate-fit-evaluation.md`.
3. **Park a one-line entry** in the `product-ideas-backlog` memory (so it survives
   across sessions and surfaces in the index).
4. **Archive the raw input** → moved to `docs/ideas-inbox/_ingested/` so the inbox
   stays a clear "still to process" list.

## Two intake paths

- **Documents** → drop them here (this folder). Good for anything written down,
  visual, or a prototype bundle.
- **Verbal / one-liners** → just tell me in chat ("park this idea: …"). I'll
  evaluate + backlog it directly; no file needed.

## What's tracked vs. scratch

- **Tracked (version-controlled):** this `README.md` (the contract) and the
  *outputs* I generate (concept docs under `docs/superpowers/specs/`, backlog memory).
- **Scratch (gitignored):** everything else you drop here, and the `_ingested/`
  archive. Raw inputs are not repo artifacts — the evaluated concept docs are.

So drop freely, including confidential drafts or large bundles; they won't be
committed. If a raw input is itself worth keeping in the repo, I'll call that out
during ingestion.
