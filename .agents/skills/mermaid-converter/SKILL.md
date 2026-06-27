---
name: mermaid-converter
description: Convert ASCII diagrams and text-block visuals to professional Mermaid diagrams. Scans files for convertible text blocks, classifies diagram types, applies rules from global and local skills, and produces clean Mermaid output. Use when upgrading documentation visuals.
disable-model-invocation: false
argument-hint: <file-path-or-glob>
allowed-tools: Read, Glob, Grep, Edit, Bash
tags: [tooling]
---

# Mermaid Converter

You are a professional diagram conversion specialist. Scan the target file(s) at `$ARGUMENTS`,
find every `` ```text `` block that qualifies for Mermaid conversion, classify it, convert it,
and verify the output — all in a loop until nothing convertible remains.

## Process

1. **Discover conversion rules** from skills (both global and local):
    - Read the global `md-quality-review` skill at `~/.Codex/skills/md-quality-review/SKILL.md`
      to load its Mermaid Migration Guide (F6, F7, F8 rules and examples).
    - Search for a local `.Codex/skills/` directory relative to the target file's project root
      (walk up until you find `.git`, `pom.xml`, `package.json`, or the filesystem root).
      If local skills exist, read them and extract any additional Mermaid or diagram conversion
      rules they define.
    - Merge all discovered rules into a unified rule set. Local rules **extend** global rules;
      if a local rule contradicts a global rule, the **local rule wins** (project-specific
      conventions take priority).
2. **Read** each target file completely.
3. **Scan** every fenced code block. For each `` ```text `` block, classify it using the
   [Diagram Classification](#diagram-classification) catalog below.
4. **Print the scan report** listing every `` ```text `` block with its line number,
   classification, and conversion decision (CONVERT or SKIP with reason).
5. **Convert** every block marked CONVERT using the matched conversion rule.
6. **Verify** by re-scanning: confirm zero convertible `` ```text `` blocks remain.
7. If a markdownlint config exists in the project, run `npx markdownlint-cli <file>` and
   fix any violations introduced by the conversion.
8. **Print the final report** and stop.

## Diagram Classification

Classify each `` ```text `` block into exactly one of the categories below. A block is
**convertible** if it matches any category in the "Convert" group. All others are SKIP.

### Convert Group

| ID | Pattern | Mermaid Type | Detection Heuristic |
|---|---|---|---|
| D1 | **Vertical box-and-arrow flow** | `flowchart TD` | Contains `┌`, `└`, `│`, `▼`, or vertically stacked `→` arrows |
| D2 | **Horizontal box-and-arrow flow** | `flowchart LR` | Contains `→` / `──>` with horizontally laid-out boxes |
| D3 | **Decision tree / branching** | `flowchart TD` with `{decision}` | Contains `├── yes` / `└── no` or if/else branches |
| D4 | **Dependency chain** | `flowchart TD` or `BT` | Shows `A depends on B`, `A → B → C` as a chain |
| D5 | **Multi-line call chain** | `sequenceDiagram` | 3+ indented lines with `→` showing nested calls between named components |
| D6 | **State transitions** | `stateDiagram-v2` | Contains state names with transitions (`→`, `-->`, arrows between states) |
| D7 | **Class / inheritance tree** | `classDiagram` or `flowchart TD` | `extends`, `implements`, or inheritance `└──` trees with class names |
| D8 | **Package / directory tree** | `flowchart TD` | `├──` / `└──` tree with paths ending in `/` or `.java`, `.ts`, etc. |
| D9 | **SQL schema column listing** | `erDiagram` | Table name followed by `├──` / `└──` entries with SQL types (VARCHAR, UUID, INTEGER, BOOLEAN, TIMESTAMP, DATE) |
| D10 | **ER relationship diagram** | `erDiagram` with relationships | Multiple table names with relationship lines or `FK` references between them |
| D11 | **Swimlane / responsibility matrix** | `flowchart TD` with subgraphs | Visually grouped columns representing layers or roles |
| D12 | **Timeline / Gantt** | `gantt` | Time-phased steps, date ranges, or sequential milestones |
| D13 | **Pie / distribution chart** | `pie` | Percentage breakdowns or proportional data |
| D14 | **Git graph** | `gitGraph` | Branch/merge/commit patterns with `*`, `│`, `/`, `\` |

### Skip Group (not convertible)

| Pattern | Reason |
|---|---|
| **Single-line call chain** (`A.foo() → B.bar()`) | One-liners are clearer as text |
| **Plain numbered step list** (`1. Do X → 2. Do Y`) without branching | Scannable as text |
| **Table-like ASCII layout** (aligned columns without tree structure) | Use Markdown table instead |
| **Log output / stack traces** | Not a diagram |
| **Configuration file content** (YAML, properties, env vars) | Not a diagram |
| **Code snippets or pseudo-code** | Not a diagram |
| **Simple key-value listings** without tree structure | Not a diagram |

## Conversion Rules

### General Rules (all diagram types)

1. **Readability first:** Mermaid source must be human-readable. Declare node content
   on separate lines from edges. Use meaningful node IDs.
2. **Node shapes:** `["label"]` for components, `(["label"])` for triggers/events,
   `[("label")]` for databases/storage, `{"label"}` for decisions.
3. **Edge labels:** Preserve relationship text as edge labels (`-- calls -->`,
   `-- implements -->`).
4. **Subgraphs:** Group related nodes when the source uses visual grouping (layers,
   packages, swimlanes).
5. **Newlines:** Use `\n` inside `"..."` for multi-line labels.
6. **No orphan nodes:** Every node must have at least one edge (unless it is a leaf in
   a tree connected by `---`).
7. **ID naming:** Use short, uppercase IDs derived from the label
   (`CTRL` for Controller, `SVC` for Service).

### D5 — Multi-line Call Chain → Sequence Diagram

1. Each distinct component/class becomes a `participant`.
2. Forward calls use `->>`, returns use `-->>`.
3. Include remarks as notes or return-value labels.
4. If nesting depth is visible (indentation), reflect it as nested call depth.

### D8 — Package/Directory Tree → Flowchart

1. Root package/directory is the top node.
2. Directories with children become `subgraph` blocks.
3. Leaf directories or files are plain nodes.
4. Parent-to-child: `-->`. Containment within subgraph: `---`.
5. Annotations/comments in the tree become `\n(remark)` in node labels.
6. Unique node IDs: prefix with parent abbreviation to avoid collisions
   (e.g., `md_activity` vs `activity`).

### D9 — SQL Schema Column Listing → erDiagram

1. Table name becomes the entity name.
2. Each column: `TYPE column_name [PK]`.
3. Constraints in quoted comments: `VARCHAR person_number "NOT NULL"`.
4. **Wildcard expansion:** `start_meta_*` covering `source, device_id, function`
   → expand to `VARCHAR start_meta_source`, `VARCHAR start_meta_device_id`,
   `VARCHAR start_meta_function`.
5. **Grouped columns:** `col_a, col_b, col_c (TYPE)` → one row per column, all
   with the same type.
6. If multiple tables are in the same block with FK references, add relationship
   lines: `table_a ||--o{ table_b : "has many"`.

### D10 — ER Relationship Diagram → erDiagram

1. Each table is an entity with columns.
2. Relationships: `||--||` (one-to-one), `||--o{` (one-to-many),
   `o{--o{` (many-to-many).
3. Include relationship labels from the source.

### D1/D2 — Box-and-Arrow Flows → Flowchart

1. Detect flow direction from the ASCII layout (vertical → `TD`, horizontal → `LR`).
2. Extract box labels from `┌──┐` / `│ text │` / `└──┘` blocks.
3. Extract edge labels from arrow annotations.
4. Use `subgraph` when visual grouping (dashed boxes, indentation groups) is present.

### D3 — Decision Trees → Flowchart with Diamonds

1. Decision points become `{Decision text}` diamond nodes.
2. Branches become labeled edges: `-- yes -->`, `-- no -->`.
3. Preserve the full branch structure.

## Handling Ambiguous Blocks

If a `` ```text `` block could match multiple categories:

1. Pick the **most specific** match (D9 is more specific than D8 for SQL schemas).
2. If equally specific, prefer the type that preserves the most information.
3. If truly ambiguous, print the ambiguity in the scan report and pick the best fit
   with a `(classified as Dx — rationale)` note.

## Skill Rule Integration

When converting, cross-reference rules from discovered skills:

- **`md-quality-review`** (global): Apply F6, F7, F8 conversion rules and examples as
  the baseline. The Mermaid Migration Guide in that skill is the authoritative reference.
- If a package tree matches a hexagonal architecture layout, use canonical layer names
  for subgraphs (`domain/`, `port/`, `adapter/`).
- **Local project skills** (`.Codex/skills/*/SKILL.md`): Read and apply any project-specific
  diagram conventions, naming rules, or Mermaid style guides defined locally. Examples:
  - A local skill may define preferred `flowchart` direction (LR vs TD).
  - A local skill may define custom subgraph naming for the project's architecture layers.
  - A local skill may define specific `erDiagram` conventions for the project's database schema.

**Precedence:** local skill rules > global skill rules > built-in rules in this skill.

## Output Format

### Scan Report (printed before converting)

```text
## Mermaid Conversion Scan — <filename>

Found N ```text blocks:

| # | Line | Classification | Decision | Notes |
|---|------|----------------|----------|-------|
| 1 | 42   | D8 — Package tree | CONVERT | 3-level tree with annotations |
| 2 | 98   | D9 — SQL schema | CONVERT | 12 columns, 2 wildcard groups |
| 3 | 155  | Skip — Log output | SKIP | Stack trace, not a diagram |
| 4 | 201  | D5 — Call chain | CONVERT | 6-line nested call flow |

Converting 3 of 4 blocks...
```

### Final Report (printed after all conversions)

```text
## Mermaid Conversion Complete — <filename>

Converted: 3 blocks (D8 ×1, D9 ×1, D5 ×1)
Skipped: 1 block (log output)
Remaining ```text blocks: 1 (non-convertible)
Markdownlint: 0 violations

---
Result: ALL CONVERTED
```

If any convertible blocks remain after the fix pass, loop back to step 3.
