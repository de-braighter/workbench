---
name: tech-debt
description: "Clean up tech debt by scope: dead-code, test-migration, token-cleanup."
argument-hint: "SCOPE — one of: dead-code, test-migration, token-cleanup"
tags: [sdlc, solo, kanban]
---

# Tech Debt Cleanup

You are an autonomous cleanup agent. Given a scope, you identify tech debt, fix it systematically, verify nothing breaks, and create a PR.

## Project Configuration

Read `.Codex/sdlc.json` at the project root for project-specific paths (cookbook, design system, test infrastructure, scopes).

## Scope Handlers

### `dead-code` — Remove Unused Exports and Files

1. **Detect** dead code:
   ```bash
   npx knip --reporter compact
   ```

2. **Categorize**: unused exports (remove), unused files (delete), unused deps (remove from package.json), false positives (skip).

3. **Remove** in batches, verifying after each:
   ```bash
   npx nx build frontend && npx nx build backend
   npx nx test frontend && npx nx test backend
   ```

4. **Branch and commit:**
   ```bash
   git checkout -b refactor/dead-code-cleanup
   git add -A
   git commit -m "refactor(shared): remove dead code detected by knip"
   ```

### `test-migration` — Migrate Tests to Shared Infrastructure

1. **Find tests with inline mocks** (not using shared test utilities):
   ```bash
   grep -rn "mockDeep\|vi.fn().*findMany\|mock.*prisma" apps/backend/src/ --include="*.spec.ts" | grep -v "test-utils/"
   grep -rn "TestBed.configureTestingModule" apps/frontend/src/ --include="*.spec.ts" | grep -v "test-utils/"
   ```

2. **Migrate** each file to use shared infrastructure (mock DB builders, auth context factories, component harness). Read the test infrastructure doc from `sdlc.testInfrastructure` for the exact utilities.

3. **Verify** each migrated test passes, then full suite.

4. **Branch and commit:**
   ```bash
   git checkout -b refactor/test-migration-cleanup
   git add -A
   git commit -m "refactor(test): migrate inline mocks to shared test infrastructure"
   ```

### `token-cleanup` — Replace Hardcoded Values with Design Tokens

1. **Find hardcoded values** in SCSS:
   ```bash
   grep -rn "#[0-9a-fA-F]\{3,8\}" apps/frontend/src/ --include="*.scss" | grep -v "node_modules\|dist\|themes/"
   grep -rn "[0-9]\+px" apps/frontend/src/ --include="*.scss" | grep -v "node_modules\|dist\|themes\|0px"
   grep -rn "font-size:\s*[0-9]" apps/frontend/src/ --include="*.scss"
   grep -rn "box-shadow:\s*[0-9]" apps/frontend/src/ --include="*.scss"
   ```

2. **Replace** with design tokens. Read the design system doc from `sdlc.designSystem` for the full token mapping (colors → `var(--color-*)`, spacing → `var(--space-*)`, radii → `var(--radius-*)`, shadows → `var(--shadow-*)`, fonts → `var(--font-size-*)`).

3. **Verify** build passes.

4. **Branch and commit:**
   ```bash
   git checkout -b refactor/token-cleanup
   git add -A
   git commit -m "refactor(frontend): replace hardcoded values with design tokens"
   ```

## Common Rules

- Never break existing functionality — run full test suite
- Zero lint errors — run lint for all affected projects
- Small, reviewable batches — split large changes into multiple commits
- One PR per scope — don't mix scopes

## PR Template

```bash
gh pr create --title "refactor({scope}): {description}" --body "$(cat <<'EOF'
## Summary
- {What was cleaned up}
- {Files affected count}
- {Verification approach}

## Changes
- [x] {Files changed summary}

## Test Plan
- [x] Full test suite passes
- [x] Build succeeds

## Checklist
- [x] Builds pass
- [x] Lint passes (zero errors)
- [x] Tests pass
- [x] No functional changes
EOF
)"
```

## Output

Report: Scope, files affected (count), specific changes, PR URL.
