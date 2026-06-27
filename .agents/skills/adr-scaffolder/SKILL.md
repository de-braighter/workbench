---
name: adr-scaffolder
description: Scaffold a new ADR (enterprise or product) with correct numbering, template, and index update.
argument-hint: "[enterprise|product] <decision-title>"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash, AskUserQuestion
tags: [sdlc, solo, kanban]
---

# ADR Scaffolder

Scaffold a new Architecture Decision Record with correct numbering, template,
frontmatter, and README index update.

## Input

`$ARGUMENTS` may be:
- `enterprise <title>` — create an enterprise ADR in `the-braighter-specs/adr/`
- `product <title>` — create a product ADR in the current product's `specs/*/adr/`
- `<title>` only (no tier keyword) — ask the user which tier

If `$ARGUMENTS` is empty, ask for a title and tier.

## Process

### 1. Determine Tier

Parse `$ARGUMENTS` for the tier keyword (`enterprise` or `product`).
If missing, ask:

```
Which tier is this ADR?
- Enterprise (cross-cutting, applies to all Braighter products)
- Product (specific to this product only)
```

### 2. Resolve Paths

| Tier | ADR directory | Template | Index |
|---|---|---|---|
| Enterprise | `D:/development/projects/braighter/the-braighter-specs/adr/` | `adr-template.md` in that dir | `README.md` in that dir |
| Product | Find `specs/*-specs/adr/` relative to the workbench root | `adr-template.md` in that dir | `README.md` in that dir |

For product ADRs, detect the product specs directory by globbing `specs/*-specs/adr/`
from the current working directory or its parent workbench.

### 3. Determine Next Number

**Enterprise:** Glob `adr-E*.md` in the enterprise ADR dir. Extract the highest `E-NNN`
number, increment by 1, zero-pad to 3 digits.

**Product:** Glob `adr-[0-9]*.md` in the product ADR dir. Extract the highest `NNN`
number, increment by 1, zero-pad to 3 digits.

### 4. Build Slug

Convert the title to a slug: lowercase, replace spaces with hyphens, remove special
characters, truncate to 60 characters.

### 5. Ask Contextual Questions

**Always ask:**
- Confirm the title and number: `"Creating ADR-<number>: <title> — correct?"`

**For product ADRs, also ask:**
- `"Does this implement an enterprise ADR? If yes, which one (e.g. E-001)?"`

**For enterprise ADRs, also ask:**
- `"Which products does this apply to? (all, or list specific ones)"`

### 6. Scaffold the File

Read the template from the resolved path. Create a new file with:

**Enterprise file name:** `adr-E<NNN>-<slug>.md`

```yaml
---
title: "ADR-E-<NNN>: <title>"
status: proposed
date: <today YYYY-MM-DD>
decision-makers: []
applies-to: <all or product list>
---
```

**Product file name:** `adr-<NNN>-<slug>.md`

```yaml
---
title: "ADR-<NNN>: <title>"
status: proposed
date: <today YYYY-MM-DD>
decision-makers: []
implements-enterprise-adr: <E-NNN if applicable, omit field if not>
---
```

Fill in all section headings from the template. For product ADRs implementing an
enterprise ADR, pre-fill the Context section with:

```markdown
## Context

> **Implements:** [ADR-E<NNN> — <enterprise title>](<github-link-to-enterprise-adr>)

<!-- Product-specific context follows here -->
```

### 7. Update the README Index

Read the `README.md` in the ADR directory. Append a new row to the index table:

```markdown
| [ADR-<number>](<filename>) | <title> | Proposed | <date> |
```

For enterprise ADRs, use `[E-<NNN>](<filename>)` as the link text.

### 8. Cross-Link (if applicable)

If a product ADR implements an enterprise ADR:
- Read the enterprise ADR file.
- Find the "Implementation by product" table.
- Add a row for this product: `| <product> | [ADR-<NNN>](<link>) | <notes> |`

### 9. Report

Print a summary:

```text
## ADR Scaffolded

- File: <path to new ADR>
- Number: <ADR number>
- Title: <title>
- Tier: <enterprise|product>
- Implements: <enterprise ADR or "standalone">
- Index updated: <README path>
- Cross-linked: <yes/no>

Next steps:
1. Fill in the Context, Decision, Alternatives, and Consequences sections
2. Add decision-makers to frontmatter
3. Open a PR for review
```
