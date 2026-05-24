---
title: Testing discipline
last_updated: 2026-05-24
---

# Testing discipline

## Principles

- **TDD by default.** Write the failing test first, then the implementation.
- **Test what changes, not what stays.** Integration tests are higher leverage than unit tests for code that crosses repo boundaries (e.g., substrate consumers).
- **Never mock the database in integration tests.** Mock/prod divergence has masked broken migrations in the past.
- **Run the verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`) on every non-trivial PR per `workflows/verifier-wave.md`.

## Per-project runners

- TypeScript projects with Nx: prefer `nx test <project>` over invoking jest/vitest directly.
- Mixed jest + vitest workspaces: always go through Nx so the right runner is selected.

## What blocks merge

- Any failing test in `local-ci`.
- Any BLOCKING-severity finding from `reviewer` or `qa-engineer`.
- A charter-check fail from `charter-checker`.
