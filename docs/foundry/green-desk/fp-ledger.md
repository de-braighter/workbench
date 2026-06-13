# Green-Desk False-Positive Audit Ledger

Append-only audit table of **verified** false-positive suppressions for the
`/green-desk` debt-path generator (Component D). Schema + the "native ignore +
ledger row, never silent" rule: see `README.md` §`fp-ledger.md`.

`/green-desk` step 5 reads this table and drops any offense matching a row (by
`tool` + `path` + `rule`) before partitioning — so a suppressed FP is never
re-emitted. Add a row ONLY together with a native per-tool ignore, and only after
a reviewer verifies the offense is a true false positive.

| date | repo | tool | path | rule | justification | reviewer |
| --- | --- | --- | --- | --- | --- | --- |
<!-- append verified FP suppressions below this line, one row each -->
