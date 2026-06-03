# Workbench registration

Two edits in the **workbench** repo (`de-braighter/`), on a branch, PR-gated. NEVER
`git add -A` in the workbench — explicit paths only (it carries unrelated untracked WIP).

## 1. `repos.yaml` — add under `domains:`
```yaml
    - {{DOMAIN}}         # {{PURPOSE}}
```

## 2. `projects/{{DOMAIN}}/project.yaml`
```yaml
# {{DOMAIN}} — {{PURPOSE}}
# Form: pack-on-platform (ADR-027), zero kernel change (ADR-176).
name: {{DOMAIN}}
domain: {{DOMAIN}}
status: bootstrapping
repo: github.com/de-braighter/{{DOMAIN}}
local: domains/{{DOMAIN}}/
enabled:
  agents:
    suggested: [designer, substrate-architect, substrate-coder-pro, implementer, reviewer, charter-checker, qa-engineer, local-ci, prisma-pro, test-pro]
  skills:
    suggested: [architecture-concierge, diff-refactor-engine, md-quality-review]
```

## 3. Commit + PR
```bash
git add repos.yaml projects/{{DOMAIN}}/project.yaml
git status --short    # MUST show ONLY those two; everything else stays ?? untracked
git commit -m "chore(manifest): register {{DOMAIN}} domain"
git push -u origin chore/register-{{DOMAIN}}-domain
gh pr create --title "chore: register {{DOMAIN}} domain" --body "…"
```
