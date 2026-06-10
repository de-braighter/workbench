---
name: dossier-intake
description: "Foundry pipeline stage 1 — ingest an idea dossier (zip or folder, typically from docs/ideas-inbox/) into a normalized Dossier Record with a canonical, addressable asset layout under docs/foundry/<product-key>/. Use when the founder says 'intake <dossier>', 'ingest this idea', or drops a new dossier into the ideas inbox."
tags: [foundry, intake, pipeline]
---

# Dossier Intake (Foundry stage 1)

Turns a raw idea dossier into a **Dossier Record**: nothing is lost, everything
becomes addressable. Spec §3 stage 1 of
`docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`.

## Rules

- **The inbox is immutable.** `docs/ideas-inbox/` is untracked founder material —
  COPY out of it; never move, edit, or delete anything there.
- **Nothing lost.** Every file in the source dossier appears in the record's
  asset manifest. Check: manifest row count == source file count.
- **One dossier, one product key, one folder.** Re-running intake on the same
  dossier updates `docs/foundry/<key>/` in place (idempotent), never forks a
  second folder.

## Procedure

1. **Resolve the source.** Input is a path or a name under `docs/ideas-inbox/`:
   - Zip not yet extracted → `Expand-Archive` into
     `docs/ideas-inbox/_extracted/<zip-stem>/` (the established layout), then
     use that folder.
   - Already-extracted folder (or a loose folder) → use it directly.
2. **Derive the product key** — kebab-case of the idea name
   (`Agricultural Ecosystem Twin` → `agri-ecosystem-twin`). Confirm with the
   founder if they're present; otherwise proceed and note the key is
   founder-overridable until the charter binds it.
3. **Create the canonical layout** — `docs/foundry/<key>/assets/`: copy every
   source file, preserving relative paths under `assets/`.
4. **Read everything** (markdown, scratchpads, SVG titles, deck text) and write
   `docs/foundry/<key>/dossier-record.md`:

   ```markdown
   ---
   product_key: <key>
   source: docs/ideas-inbox/<original>
   intake_date: <YYYY-MM-DD>
   status: intake
   ---

   # Dossier Record — <Idea Name>

   ## Essence
   <One paragraph: what the idea IS. Then 3-6 bullets of its core claims.>

   ## Domain-model hints
   <Entities, events, interventions, decisions spotted in the material —
   the raw ore the build-path designer (F4) will mine. Bullets, cite the
   asset file each hint came from.>

   ## UI-prototype artifacts
   <List any mockups/SVGs/frontend prototypes with one line on what each shows;
   "none" if none.>

   ## Market signal
   <Whatever the dossier claims about buyers, pain, pricing — verbatim-ish,
   flagged as the founder's untested hypotheses.>

   ## Asset manifest
   | Asset | Type | What it is |
   | --- | --- | --- |
   <one row per file under assets/>

   ## Open questions
   <What the dossier does NOT answer that stage 2 will need.>
   ```

5. **Verify the nothing-lost check** (manifest rows == file count), report the
   record path, and point at the next stage: `/opportunity-brief <key>`.

## Failure stances

- Source unreadable / zip corrupt → report which file; ingest the rest; list
  the casualty in Open questions. Never silently drop material.
- Name collision with an existing `docs/foundry/<key>/` for a DIFFERENT idea →
  stop and ask the founder for a key.
