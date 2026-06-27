# Example: Decompose and clean a complex module

Input:
- One large file with multiple responsibilities (parsing, IO, business rules)
Constraints:
- diff-only
- no public API breaks

Expected output:
1) Diagnosis of responsibilities and hotspots
2) Target decomposition into cohesive units (parser, validator, service)
3) Incremental plan
4) Patch set as unified diffs
5) Verification checklist
