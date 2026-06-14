# Green-Desk False-Positive Audit Ledger

Append-only audit table of **verified** false-positive suppressions for the
`/green-desk` debt-path generator (Component D). Schema + the "native ignore +
ledger row, never silent" rule: see `README.md` §`fp-ledger.md`.

`/green-desk` step 5 reads this table and drops any offense matching a row (by
`tool` + `path` + `rule`) before partitioning — so a suppressed FP is never
re-emitted. Add a row ONLY together with a native per-tool ignore, and only after
a reviewer verifies the offense is a true false positive.

**Class-level seed rows** (repo `(all)`, `path` a pattern): the two canonical
false-positive CLASSES from the F5 quality-floor runbook. Their native suppression
differs — verify per repo:
- **declaration-emit-types** IS baked into the lint-kit `knipDomainPreset`
  (`ignoreExportsUsedInFile {interface, type}`), so a repo using that preset never
  surfaces it.
- **prisma-generate-dep** is NOT in the preset — it requires a **per-repo** knip
  `ignoreDependencies: ["@prisma/client"]` (F5 runbook), so it still surfaces on a
  preset-using repo until that repo adds the ignore.

These rows DOCUMENT the classes so a sweep that surfaces them recognises them as
known FPs — suppress via the appropriate native ignore (preset for the first,
per-repo `ignoreDependencies` for the second) and, for a concrete path, add a
path-specific row beneath.

| date | repo | tool | path | rule | justification | reviewer |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-06-14 | (all) | knip | `*` (type/interface export used only in its declaring file) | declaration-emit-types | knip flags `interface`/`type` exports referenced only within their own file as "unused exports", but they are declaration-emit surface (consumed via `.d.ts` / same-file). The lint-kit `knipDomainPreset` bakes `ignoreExportsUsedInFile {interface,type}` — config-suppressed, never real dead code (F5 runbook). | F5-runbook (founder-ratified) |
| 2026-06-14 | (all) | knip | `package.json` (`@prisma/client`) | prisma-generate-dep | knip reports `@prisma/client` as an unused dependency, but it is a generate-time dep used after `prisma generate` emits the client — present + required. Suppress via knip `ignoreDependencies` — never real unused-dep debt (F5 runbook). | F5-runbook (founder-ratified) |
| 2026-06-14 | (all) | knip | `hooks/*.mjs`, `scripts/*.mjs` (or any standalone entry-point script not in package.json) | entry-point-file | knip reports a standalone script (a Claude Code hook, a CLI/serve script) as an "unused file" because nothing IMPORTS it — but it is an ENTRY POINT (run by the hook system / `node <script>`), not dead code. Deleting it would break the entry point (e.g. a SubagentStop verdict-capture hook). Suppress by declaring it in knip `entry` (NOT `ignore` — `entry` keeps knip following its imports so a helper it imports isn't orphaned). NB: an explicit knip `entry` OVERRIDES the default patterns, so include the repo's real default entries (e.g. `src/index.ts`) alongside. | orchestrator (devloop#79, verified) |
| 2026-06-14 | de-braighter/devloop | knip | `package.json` (`@prisma/client`) | prisma-generate-dep | Applied: devloop reaches `@prisma/client` only via a dynamic import of the generated client path (`src/persist/plan-tree-store.ts`), which knip can't trace. Suppressed via `ignoreDependencies: ["@prisma/client"]` in devloop `knip.json` (devloop#79). | orchestrator (devloop#79, verified) |
<!-- append verified FP suppressions below this line, one row each -->
