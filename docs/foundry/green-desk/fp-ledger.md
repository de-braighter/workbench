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
<!-- append verified FP suppressions below this line, one row each -->
