# SDLC Knowledge Graph (read-side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-side SDLC knowledge graph as a `domains/devloop` module that derives the cluster's procedural knowledge (ADR/concept frontmatter, governance docs, the auto-memory graph) into a graph an agent queries via MCP instead of greps.

**Architecture:** A four-stage pipeline — `sources/` readers (one per generator) → `graph/` builder (+ derived `index.json`) → `retrieval/` (lexical+tag seed → typed-edge traversal → rank → context-pack) → `mcp/` server (`kg_context` / `kg_query` / `kg_rebuild`). Pure corpus retrieval; imports nothing from the substrate kernel. Files stay the source of truth; the graph is a derived projection.

**Tech Stack:** TypeScript (ESM, `.js` import extensions, `moduleResolution: bundler`), `tsx` runtime, vitest (tests in `test/`), `zod`, `yaml` (new dep), `@modelcontextprotocol/sdk` (new dep). Node `fs`. No graph DB, no embeddings.

**Spec:** `docs/superpowers/specs/2026-05-31-sdlc-knowledge-graph-read-side-design.md`

**Where the work happens:** the `domains/devloop` sibling repo. Create a feature branch there (e.g. `feat/knowledge-graph-read-side`). All commits below are in that repo. Module root: `domains/devloop/src/knowledge-graph/`.

---

## File Structure

Created under `domains/devloop/src/knowledge-graph/`:

- `graph-model.ts` — shared types: `NodeKind`, `EdgeType`, `NodeStatus`, `KgNode`, `KgEdge`, `KgGraph`, `RawSlice`. One responsibility: the vocabulary every other unit speaks.
- `config.ts` — resolve corpus roots (specs repo, workbench root, memory dir) + index path, with env overrides.
- `sources/frontmatter.ts` — parse `---`-delimited YAML frontmatter + body.
- `sources/adr-reader.ts` — `layers/specs/adr/*.md` → nodes + frontmatter edges.
- `sources/concept-reader.ts` — `layers/specs/concepts/**/*.md` → nodes + edges.
- `sources/governance-reader.ts` — `policies/*.md`, `workflows/*.md`, root `CLAUDE.md` → nodes.
- `sources/memory-reader.ts` — memory dir `*.md` → nodes + `[[wikilink]]` edges.
- `graph/build-graph.ts` — merge slices, derive `mentions` + `applies-to-area`, detect dangling edges.
- `graph/index-store.ts` — write/read `index.json`.
- `retrieval/seed.ts` — lexical+tag seed scoring.
- `retrieval/traverse.ts` — BFS edge-traversal with hop distance + path.
- `retrieval/rank.ts` — composite ranking (seed + proximity + status + recency).
- `retrieval/context-pack.ts` — assemble + render the token-bounded pack.
- `mcp/server.ts` — MCP server exposing the three tools (side-effectful entry).
- `index.ts` — re-export the public functions for testing/CLI use.

Tests under `domains/devloop/test/knowledge-graph/` and fixtures under `domains/devloop/test/knowledge-graph/fixtures/`. (devloop's existing tests sit flat in `test/`; we nest under `test/knowledge-graph/` deliberately for module cohesion — note this in the first commit so it doesn't read as accidental drift.)

> **QA revision (2026-05-31).** This plan was revised after a verifier wave (reviewer BLOCKED, qa-engineer PASS-WITH-FIXES, charter-checker COHERENT). Key changes folded in: a new **Task 0 (corpus reconnaissance)** — the original fixtures did not match the real corpus (concepts carry **0** `tags`, only **14/201** ADRs carry `applies-to`, statuses include `draft`/others); Windows-correct MCP entry guard and `pathToFileURL`; `noUncheckedIndexedAccess`-clean code (every regex group + indexed read guarded); platform-agnostic config + test; `zod` floor raised to the SDK's requirement; hermetic `kg_rebuild` test; a real (not toy) golden-query net with a `DEVLOOP_KG_REAL`-gated corpus assertion; word-boundary `mentions`; deterministic budget cap.

---

## Task 0: Corpus reconnaissance (read-only — measure before you model)

**Purpose:** the readers, the `NodeStatus` enum, `STATUS_WEIGHT`, and seed weighting must match the *real* corpus, not assumed shapes. This task produces the facts that the later tasks bake in. It writes no module code — it records findings in the task notes / PR description.

**Files:** none created. Run read-only probes against `layers/specs/` and the memory dir.

- [ ] **Step 1: Enumerate the real `status:` vocabulary**

Run (from cluster root):
```bash
grep -rhoE '^status:\s*.*$' layers/specs/adr layers/specs/concepts | sed 's/status:[[:space:]]*//; s/["'\'' ]//g' | sort | uniq -c | sort -rn
```
Record every distinct value. Any value NOT in `{ratified, accepted, proposed, draft, superseded, deprecated}` must be added to `NodeStatus` (Task 1) and given a `STATUS_WEIGHT`, or deliberately mapped to `unknown` with a one-line justification.

- [ ] **Step 2: Measure tag / applies-to / domain coverage**

Run:
```bash
echo "ADRs with applies-to:"; grep -rlE '^applies-to:' layers/specs/adr | wc -l
echo "ADRs total:"; ls layers/specs/adr/*.md | wc -l
echo "concepts with tags:"; grep -rlE '^tags:' layers/specs/concepts | wc -l
echo "concepts with domain:"; grep -rlE '^domain:' layers/specs/concepts | wc -l
echo "concepts total:"; find layers/specs/concepts -name '*.md' | wc -l
```
Expectation (from the QA probe): `applies-to` is sparse on ADRs and `tags` is absent on concepts, while `domain:` is common on concepts. This is why Task 1 adds `domain` to the tag sources and Task 5 derives area edges from the **file path** as well as tags.

- [ ] **Step 3: Confirm real id shapes + ref formats**

Run:
```bash
ls layers/specs/adr | head -3          # adr-NNN-... .md  -> id 'adr-NNN'
ls layers/specs/concepts | head -3     # long dated slugs -> id = filename slug
grep -rhoE '^\s*-\s*(adr/)?adr-[0-9]+[^ ]*\.md' layers/specs/adr | head -3   # ref format
ls "${DEVLOOP_MEMORY_DIR:-$HOME/.claude/projects/D--development-projects-de-braighter/memory}" | head -3
```
Confirm: concept ids are long slugs (e.g. `north-star-vision-capture-2026-05-17`), refs may be path-prefixed (`adr/adr-153-....md`) or bare. The golden-query fixtures (Task 9) MUST use realistic ids of these shapes, not invented short slugs.

- [ ] **Step 4: Record findings**

Write the three results into the PR description (a short "Corpus reconnaissance" block). These are the inputs Task 1 (enum + weights), Task 5 (area derivation), and Task 9 (golden fixtures) consume. No commit (no files changed); proceed to Task 1.

---

## Task 1: Scaffold — deps, types, config

**Files:**
- Modify: `domains/devloop/package.json` (add deps)
- Create: `domains/devloop/src/knowledge-graph/graph-model.ts`
- Create: `domains/devloop/src/knowledge-graph/config.ts`
- Test: `domains/devloop/test/knowledge-graph/config.test.ts`

- [ ] **Step 1: Add dependencies**

Run (in `domains/devloop`):
```bash
npm install yaml@^2.5.0 @modelcontextprotocol/sdk@^1.0.0 zod@^3.25.0
```
Expected: `yaml` + `@modelcontextprotocol/sdk` added to `dependencies`; `zod` bumped to `^3.25.0` (devloop pinned `^3.24.0`, but `@modelcontextprotocol/sdk` requires `zod` `^3.25 || ^4`; leaving the lower floor risks a clean reinstall resolving to 3.24.x and breaking the SDK's zod compat imports). `npm install` exits 0. Then confirm the installed SDK's API shape before Task 10 relies on it:
```bash
node -e "const s=require('@modelcontextprotocol/sdk/package.json'); console.log('sdk', s.version)"
```
Record the version; Task 10 Step 3 verifies `McpServer` (`server/mcp.js`) + `server.tool(name, desc, shape, handler)` against it.

- [ ] **Step 2: Write the model types**

Create `src/knowledge-graph/graph-model.ts`:
```ts
// The vocabulary every knowledge-graph unit speaks. Pure types, no logic.
export type NodeKind = 'adr' | 'concept' | 'policy' | 'instruction' | 'memory';

export type EdgeType =
  | 'relates-to'
  | 'depends-on'
  | 'supersedes'
  | 'superseded-by'
  | 'amends'
  | 'ratifies'
  | 'ratified-by'
  | 'implemented-by'
  | 'links-to'
  | 'mentions'
  | 'applies-to-area';

export type NodeStatus =
  | 'ratified'
  | 'accepted'
  | 'proposed'
  | 'draft'
  | 'superseded'
  | 'deprecated'
  | 'unknown';

export interface KgNode {
  id: string; // stable slug, e.g. 'adr-176'
  kind: NodeKind;
  title: string;
  status: NodeStatus;
  summary: string; // frontmatter description / first heading / first sentence
  path: string; // file pointer (cluster-relative); we link, never inline contents
  tags: string[]; // applies-to + domain/area tags, lowercased
  date?: string; // ISO date if known
}

export interface KgEdge {
  from: string; // node id
  to: string; // node id, or an external ref like 'substrate#63'
  type: EdgeType;
}

// What every reader returns.
export interface RawSlice {
  nodes: KgNode[];
  edges: KgEdge[];
  warnings: string[];
}

export interface KgGraph {
  nodes: Record<string, KgNode>;
  edges: KgEdge[];
  warnings: string[];
}

export const STATUS_WEIGHT: Record<NodeStatus, number> = {
  ratified: 1.0,
  accepted: 0.9,
  proposed: 0.6,
  draft: 0.5,
  unknown: 0.5,
  superseded: 0.1,
  deprecated: 0.1,
};

export function normalizeStatus(raw: string | undefined): NodeStatus {
  const s = (raw ?? '').toLowerCase().trim();
  if (s === 'ratified' || s === 'accepted' || s === 'proposed' || s === 'draft' || s === 'superseded' || s === 'deprecated') {
    return s;
  }
  return 'unknown';
}
```

- [ ] **Step 3: Write the config test**

Create `test/knowledge-graph/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { resolveConfig } from '../../src/knowledge-graph/config.js';

// IMPORTANT: a hardcoded POSIX string like '/cluster' is wrong on win32 — there
// `path.resolve('/cluster/domains/devloop', '..', '..')` returns `C:\cluster`
// (rebased onto the cwd drive). So derive expectations from the same path ops
// and assert structural relationships, making the test platform-agnostic.
const PACK = resolve('/cluster/domains/devloop'); // win32 -> C:\cluster\...; posix -> /cluster/...

describe('resolveConfig', () => {
  it('derives cluster-relative roots from a given package root', () => {
    const cfg = resolveConfig({ packRoot: PACK, env: {} });
    expect(cfg.clusterRoot).toBe(resolve(PACK, '..', '..'));
    expect(cfg.specsRoot).toBe(join(cfg.clusterRoot, 'layers', 'specs'));
    expect(cfg.workbenchRoot).toBe(cfg.clusterRoot);
    expect(cfg.indexPath).toBe(join(PACK, 'data', 'kg-index.json'));
    expect(cfg.memoryDir).toBeUndefined(); // unset env → undefined (reader skips + warns)
  });

  it('honors DEVLOOP_MEMORY_DIR override', () => {
    const cfg = resolveConfig({ packRoot: PACK, env: { DEVLOOP_MEMORY_DIR: '/mem' } });
    expect(cfg.memoryDir).toBe('/mem');
  });
});
```
Note: `resolveConfig` keeps native separators (its paths feed `fs`, which accepts them on every platform); only the *node `path` field* produced by readers is normalized to `/` for display. This is why the config paths are asserted via `path` ops, not literal strings.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/knowledge-graph/config.test.ts`
Expected: FAIL — cannot resolve `../../src/knowledge-graph/config.js`.

- [ ] **Step 5: Implement config**

Create `src/knowledge-graph/config.ts`:
```ts
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KgConfig {
  clusterRoot: string;
  specsRoot: string;
  workbenchRoot: string;
  memoryDir: string | undefined;
  indexPath: string;
}

interface ResolveOpts {
  packRoot?: string;
  env?: Record<string, string | undefined>;
}

/** Pure resolver — testable with an injected packRoot + env. */
export function resolveConfig(opts: ResolveOpts = {}): KgConfig {
  const packRoot = opts.packRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const env = opts.env ?? process.env;
  const clusterRoot = resolve(packRoot, '..', '..');
  return {
    clusterRoot,
    specsRoot: join(clusterRoot, 'layers', 'specs'),
    workbenchRoot: clusterRoot,
    memoryDir: env.DEVLOOP_MEMORY_DIR,
    indexPath: join(packRoot, 'data', 'kg-index.json'),
  };
}
```
Note: `resolve` collapses the `..` segments, so `/cluster/domains/devloop` → `/cluster`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/knowledge-graph/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/knowledge-graph/graph-model.ts src/knowledge-graph/config.ts test/knowledge-graph/config.test.ts
git commit -m "feat(kg): scaffold knowledge-graph module — types, config, deps"
```

---

## Task 2: Frontmatter parser

**Files:**
- Create: `domains/devloop/src/knowledge-graph/sources/frontmatter.ts`
- Test: `domains/devloop/test/knowledge-graph/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/frontmatter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/knowledge-graph/sources/frontmatter.js';

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from body and parses lists', () => {
    const raw = [
      '---',
      'title: "ADR-200: Persist effects"',
      'status: ratified',
      'relates-to:',
      '  - adr-176-x.md',
      '  - adr-127-y.md',
      '---',
      '',
      '# ADR-200',
      'Body text.',
    ].join('\n');
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe('ADR-200: Persist effects');
    expect(frontmatter.status).toBe('ratified');
    expect(frontmatter['relates-to']).toEqual(['adr-176-x.md', 'adr-127-y.md']);
    expect(body.trimStart().startsWith('# ADR-200')).toBe(true);
  });

  it('returns empty frontmatter when none present', () => {
    const { frontmatter, body } = parseFrontmatter('# Just a heading\ntext');
    expect(frontmatter).toEqual({});
    expect(body.startsWith('# Just a heading')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/frontmatter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/knowledge-graph/sources/frontmatter.ts`:
```ts
import { parse as parseYaml } from 'yaml';

export interface Parsed {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split a markdown file into its YAML frontmatter object and the remaining body. */
export function parseFrontmatter(raw: string): Parsed {
  const m = FM_RE.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  // m[1]/m[2] are `string | undefined` under noUncheckedIndexedAccess — coalesce.
  const fm = (parseYaml(m[1] ?? '') ?? {}) as Record<string, unknown>;
  return { frontmatter: fm, body: m[2] ?? '' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/frontmatter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-graph/sources/frontmatter.ts test/knowledge-graph/frontmatter.test.ts
git commit -m "feat(kg): YAML frontmatter parser"
```

---

## Task 3: ADR + concept readers

These two share their core (frontmatter → node + typed edges), so build a shared helper and two thin wrappers.

**Files:**
- Create: `domains/devloop/src/knowledge-graph/sources/spec-reader.ts` (shared helper)
- Create: `domains/devloop/src/knowledge-graph/sources/adr-reader.ts`
- Create: `domains/devloop/src/knowledge-graph/sources/concept-reader.ts`
- Create fixtures under `domains/devloop/test/knowledge-graph/fixtures/specs/adr/` and `.../concepts/`
- Test: `domains/devloop/test/knowledge-graph/spec-reader.test.ts`

- [ ] **Step 1: Create fixtures**

Create `test/knowledge-graph/fixtures/specs/adr/adr-200-effect-persistence.md`:
```markdown
---
title: "ADR-200: Persist PlanNode effects as JSONB"
status: ratified
date: 2026-05-30
applies-to: [substrate]
relates-to:
  - adr-176-kernel-minimality.md
supersedes:
  - adr-153-plan-tree-phase-a.md
implemented-by:
  - substrate#63
---

# ADR-200
Persist effect declarations as JSONB on kernel.plan_node.
```

Create `test/knowledge-graph/fixtures/specs/adr/adr-176-kernel-minimality.md`:
```markdown
---
title: "ADR-176: Substrate kernel minimality — inclusion test"
status: ratified
date: 2026-05-28
applies-to: [substrate]
---

# ADR-176
The inclusion test for the kernel.
```

Create `test/knowledge-graph/fixtures/specs/adr/adr-153-plan-tree-phase-a.md`:
```markdown
---
title: "ADR-153: Plan-tree phase A"
status: superseded
superseded-by:
  - adr-200-effect-persistence.md
applies-to: [substrate]
---

# ADR-153
Superseded by ADR-200.
```

Create `test/knowledge-graph/fixtures/specs/concepts/north-star.md`:
```markdown
---
title: "North-star vision capture"
status: ratified
tags: [substrate, vision]
relates-to:
  - adr-176-kernel-minimality.md
---

# North-star
The substrate thesis.
```

- [ ] **Step 2: Write the failing test**

Create `test/knowledge-graph/spec-reader.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readAdrs } from '../../src/knowledge-graph/sources/adr-reader.js';
import { readConcepts } from '../../src/knowledge-graph/sources/concept-reader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS = join(HERE, 'fixtures', 'specs');

describe('readAdrs', () => {
  it('reads ADR nodes with id from filename and status from frontmatter', () => {
    const slice = readAdrs(SPECS);
    const ids = slice.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['adr-153', 'adr-176', 'adr-200']);
    const a200 = slice.nodes.find((n) => n.id === 'adr-200')!;
    expect(a200.kind).toBe('adr');
    expect(a200.status).toBe('ratified');
    expect(a200.tags).toContain('substrate');
  });

  it('emits typed edges with target ids resolved from referenced filenames', () => {
    const slice = readAdrs(SPECS);
    expect(slice.edges).toContainEqual({ from: 'adr-200', to: 'adr-176', type: 'relates-to' });
    expect(slice.edges).toContainEqual({ from: 'adr-200', to: 'adr-153', type: 'supersedes' });
    expect(slice.edges).toContainEqual({ from: 'adr-200', to: 'substrate#63', type: 'implemented-by' });
    expect(slice.edges).toContainEqual({ from: 'adr-153', to: 'adr-200', type: 'superseded-by' });
  });
});

describe('readConcepts', () => {
  it('reads concept nodes with slug id from filename', () => {
    const slice = readConcepts(SPECS);
    const node = slice.nodes.find((n) => n.id === 'north-star')!;
    expect(node.kind).toBe('concept');
    expect(node.tags).toEqual(expect.arrayContaining(['substrate', 'vision']));
    expect(slice.edges).toContainEqual({ from: 'north-star', to: 'adr-176', type: 'relates-to' });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/spec-reader.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the shared helper**

Create `src/knowledge-graph/sources/spec-reader.ts`:
```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { KgNode, KgEdge, RawSlice, NodeKind, EdgeType } from '../graph-model.js';
import { normalizeStatus } from '../graph-model.js';
import { parseFrontmatter } from './frontmatter.js';

// Frontmatter keys that are typed edges, mapped to their EdgeType.
const EDGE_KEYS: Record<string, EdgeType> = {
  'relates-to': 'relates-to',
  'depends-on': 'depends-on',
  supersedes: 'supersedes',
  'superseded-by': 'superseded-by',
  amends: 'amends',
  ratifies: 'ratifies',
  'ratified-by': 'ratified-by',
  'implemented-by': 'implemented-by',
};

/** 'adr-200-effect-persistence.md' -> 'adr-200'; 'north-star.md' -> 'north-star'. */
export function idFromFilename(filename: string, kind: NodeKind): string {
  const base = filename.replace(/\.md$/, '');
  if (kind === 'adr') {
    const m = /^(adr-\d+)/.exec(base);
    if (m) return m[1]!; // capture group guaranteed present when m matched
  }
  return base;
}

/** A referenced target: 'adr-176-x.md' -> 'adr-176'; 'substrate#63' stays as-is. */
function resolveRef(ref: string, kind: NodeKind): string {
  const s = String(ref).trim();
  if (/^[a-z-]+#\d+$/i.test(s)) return s; // external repo ref e.g. substrate#63
  const base = s.replace(/^.*\//, '').replace(/\.md$/, '');
  const m = /^(adr-\d+)/.exec(base);
  return kind === 'adr' && m ? m[1]! : base;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

function firstHeading(body: string): string {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1]!.trim() : '';
}

/** List *.md under dir (recursively). */
function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

export function readSpecDir(dir: string, kind: NodeKind, clusterRoot: string): RawSlice {
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];
  const warnings: string[] = [];
  for (const file of listMarkdown(dir)) {
    const raw = readFileSync(file, 'utf8');
    const { frontmatter: fm, body } = parseFrontmatter(raw);
    const filename = file.replace(/^.*[\\/]/, '');
    const id = idFromFilename(filename, kind);
    // Corpus reality (Task 0): concepts carry `domain:` not `tags:`, and `applies-to`
    // is sparse on ADRs — so pull from all three. `||` (not `??`) so an empty-string
    // heading falls through to the id rather than yielding ''.
    const tags = [...asArray(fm['applies-to']), ...asArray(fm['tags']), ...asArray(fm['domain'])].map((t) => t.toLowerCase());
    nodes.push({
      id,
      kind,
      title: String(fm.title || firstHeading(body) || id),
      status: normalizeStatus(fm.status as string | undefined),
      summary: String(fm.description || firstHeading(body) || '').slice(0, 280),
      path: relative(clusterRoot, file).split('\\').join('/'),
      tags,
      date: fm.date ? String(fm.date) : undefined,
    });
    for (const [key, type] of Object.entries(EDGE_KEYS)) {
      for (const ref of asArray(fm[key])) {
        edges.push({ from: id, to: resolveRef(ref, kind), type });
      }
    }
  }
  return { nodes, edges, warnings };
}
```

- [ ] **Step 5: Implement the two wrappers**

Create `src/knowledge-graph/sources/adr-reader.ts`:
```ts
import { join } from 'node:path';
import type { RawSlice } from '../graph-model.js';
import { readSpecDir } from './spec-reader.js';

/** specsRoot = .../layers/specs ; clusterRoot defaults to specsRoot for relative paths in tests. */
export function readAdrs(specsRoot: string, clusterRoot: string = specsRoot): RawSlice {
  return readSpecDir(join(specsRoot, 'adr'), 'adr', clusterRoot);
}
```

Create `src/knowledge-graph/sources/concept-reader.ts`:
```ts
import { join } from 'node:path';
import type { RawSlice } from '../graph-model.js';
import { readSpecDir } from './spec-reader.js';

export function readConcepts(specsRoot: string, clusterRoot: string = specsRoot): RawSlice {
  return readSpecDir(join(specsRoot, 'concepts'), 'concept', clusterRoot);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/spec-reader.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/knowledge-graph/sources/spec-reader.ts src/knowledge-graph/sources/adr-reader.ts src/knowledge-graph/sources/concept-reader.ts test/knowledge-graph/spec-reader.test.ts test/knowledge-graph/fixtures/specs
git commit -m "feat(kg): ADR + concept readers (frontmatter -> nodes + typed edges)"
```

---

## Task 4: Governance + memory readers

**Files:**
- Create: `domains/devloop/src/knowledge-graph/sources/governance-reader.ts`
- Create: `domains/devloop/src/knowledge-graph/sources/memory-reader.ts`
- Create fixtures `.../fixtures/workbench/policies/git.md`, `.../fixtures/workbench/CLAUDE.md`, `.../fixtures/memory/substrate-kernel-state.md`
- Test: `domains/devloop/test/knowledge-graph/governance-memory.test.ts`

- [ ] **Step 1: Create fixtures**

Create `test/knowledge-graph/fixtures/workbench/policies/git.md`:
```markdown
# Git policy

All repos go through PRs. No direct-to-main.
```

Create `test/knowledge-graph/fixtures/workbench/CLAUDE.md`:
```markdown
# CLAUDE.md

The kernel is exactly four concerns. See adr-176 and adr-127.
```

Create `test/knowledge-graph/fixtures/memory/substrate-kernel-state.md`:
```markdown
---
name: substrate-kernel-state
description: "Kernel persistence map. Read before any kernel-persistence work."
metadata:
  node_type: memory
  type: project
---

The plan_node now persists effects (ADR-200). See [[dev-observation-signal]] and adr-200.
```

- [ ] **Step 2: Write the failing test**

Create `test/knowledge-graph/governance-memory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGovernance } from '../../src/knowledge-graph/sources/governance-reader.js';
import { readMemory } from '../../src/knowledge-graph/sources/memory-reader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WB = join(HERE, 'fixtures', 'workbench');
const MEM = join(HERE, 'fixtures', 'memory');

describe('readGovernance', () => {
  it('reads policies as policy nodes and CLAUDE.md as an instruction node', () => {
    const slice = readGovernance(WB);
    const policy = slice.nodes.find((n) => n.kind === 'policy')!;
    expect(policy.id).toBe('policy-git');
    const instr = slice.nodes.find((n) => n.kind === 'instruction')!;
    expect(instr.id).toBe('claude-md-root');
  });
});

describe('readMemory', () => {
  it('reads memory nodes with description summary and [[wikilink]] edges', () => {
    const slice = readMemory(MEM);
    const node = slice.nodes.find((n) => n.id === 'substrate-kernel-state')!;
    expect(node.kind).toBe('memory');
    expect(node.summary).toContain('Read before');
    expect(slice.edges).toContainEqual({ from: 'substrate-kernel-state', to: 'dev-observation-signal', type: 'links-to' });
  });

  it('returns an empty slice with a warning when the memory dir is undefined', () => {
    const slice = readMemory(undefined);
    expect(slice.nodes).toEqual([]);
    expect(slice.warnings.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/governance-memory.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement governance reader**

Create `src/knowledge-graph/sources/governance-reader.ts`:
```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { KgNode, RawSlice } from '../graph-model.js';
import { parseFrontmatter } from './frontmatter.js';

function firstHeading(body: string): string {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1]!.trim() : '';
}

function readDirAsKind(dir: string, prefix: string, kind: 'policy', clusterRoot: string): KgNode[] {
  if (!existsSync(dir)) return [];
  const nodes: KgNode[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const file = join(dir, name);
    const { body } = parseFrontmatter(readFileSync(file, 'utf8'));
    const slug = name.replace(/\.md$/, '');
    nodes.push({
      id: `${prefix}-${slug}`,
      kind,
      title: firstHeading(body) || slug,
      status: 'ratified',
      summary: firstHeading(body) || slug,
      path: relative(clusterRoot, file).split('\\').join('/'),
      tags: ['governance'],
    });
  }
  return nodes;
}

/** workbenchRoot holds policies/, workflows/, CLAUDE.md. */
export function readGovernance(workbenchRoot: string, clusterRoot: string = workbenchRoot): RawSlice {
  const nodes: KgNode[] = [
    ...readDirAsKind(join(workbenchRoot, 'policies'), 'policy', 'policy', clusterRoot),
    ...readDirAsKind(join(workbenchRoot, 'workflows'), 'workflow', 'policy', clusterRoot),
  ];
  const claude = join(workbenchRoot, 'CLAUDE.md');
  if (existsSync(claude)) {
    const { body } = parseFrontmatter(readFileSync(claude, 'utf8'));
    nodes.push({
      id: 'claude-md-root',
      kind: 'instruction',
      title: 'CLAUDE.md (workbench root)',
      status: 'ratified',
      summary: firstHeading(body) || 'Project instructions',
      path: relative(clusterRoot, claude).split('\\').join('/'),
      tags: ['governance', 'instruction'],
    });
  }
  return { nodes, edges: [], warnings: [] };
}
```
Note: workflow files reuse `kind: 'policy'` (they are governance rules); their id prefix `workflow-` distinguishes them.

- [ ] **Step 5: Implement memory reader**

Create `src/knowledge-graph/sources/memory-reader.ts`:
```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { KgNode, KgEdge, RawSlice } from '../graph-model.js';
import { parseFrontmatter } from './frontmatter.js';

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function readMemory(memoryDir: string | undefined): RawSlice {
  if (!memoryDir) {
    return { nodes: [], edges: [], warnings: ['memory dir not set (DEVLOOP_MEMORY_DIR) — memory nodes skipped'] };
  }
  if (!existsSync(memoryDir)) {
    return { nodes: [], edges: [], warnings: [`memory dir does not exist: ${memoryDir}`] };
  }
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];
  for (const name of readdirSync(memoryDir)) {
    if (!name.endsWith('.md') || name === 'MEMORY.md') continue;
    const file = join(memoryDir, name);
    const raw = readFileSync(file, 'utf8');
    const { frontmatter: fm, body } = parseFrontmatter(raw);
    const id = name.replace(/\.md$/, '');
    nodes.push({
      id,
      kind: 'memory',
      title: String(fm.name ?? id),
      status: 'unknown',
      summary: String(fm.description ?? '').slice(0, 280),
      path: file.split('\\').join('/'), // memory dir is external (absolute)
      tags: ['memory', String((fm.metadata as Record<string, unknown> | undefined)?.type ?? 'project')],
    });
    for (const m of body.matchAll(WIKILINK_RE)) {
      const target = m[1]?.trim();
      if (target) edges.push({ from: id, to: target, type: 'links-to' });
    }
  }
  return { nodes, edges, warnings: [] };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/governance-memory.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/knowledge-graph/sources/governance-reader.ts src/knowledge-graph/sources/memory-reader.ts test/knowledge-graph/governance-memory.test.ts test/knowledge-graph/fixtures/workbench test/knowledge-graph/fixtures/memory
git commit -m "feat(kg): governance + memory readers"
```

---

## Task 5: Graph builder + index store

**Files:**
- Create: `domains/devloop/src/knowledge-graph/graph/build-graph.ts`
- Create: `domains/devloop/src/knowledge-graph/graph/index-store.ts`
- Test: `domains/devloop/test/knowledge-graph/build-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/build-graph.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { buildGraph } from '../../src/knowledge-graph/graph/build-graph.js';
import { writeIndex, readIndex } from '../../src/knowledge-graph/graph/index-store.js';
import type { RawSlice } from '../../src/knowledge-graph/graph-model.js';

const slices: RawSlice[] = [
  {
    nodes: [
      { id: 'adr-200', kind: 'adr', title: 'Persist effects', status: 'ratified', summary: 's', path: 'p', tags: ['substrate'] },
      { id: 'adr-176', kind: 'adr', title: 'Minimality', status: 'ratified', summary: 's', path: 'p', tags: ['substrate'] },
    ],
    edges: [
      { from: 'adr-200', to: 'adr-176', type: 'relates-to' },
      { from: 'adr-200', to: 'adr-999', type: 'supersedes' }, // dangling target
    ],
    warnings: [],
  },
  {
    nodes: [{ id: 'mem-1', kind: 'memory', title: 'm', status: 'unknown', summary: 'about adr-176', path: 'p', tags: ['memory'] }],
    edges: [],
    warnings: ['reader warned'],
  },
];

describe('buildGraph', () => {
  it('merges slices into a keyed node map and a flat edge list', () => {
    const g = buildGraph(slices);
    expect(Object.keys(g.nodes).sort()).toEqual(['adr-176', 'adr-200', 'mem-1']);
  });

  it('records a warning for a dangling edge target (not in nodes, not external)', () => {
    const g = buildGraph(slices);
    expect(g.warnings.some((w) => w.includes('adr-999'))).toBe(true);
    expect(g.warnings).toContain('reader warned');
  });

  it('derives a "mentions" edge when a node summary contains another node id', () => {
    const g = buildGraph(slices);
    expect(g.edges).toContainEqual({ from: 'mem-1', to: 'adr-176', type: 'mentions' });
  });

  it('derives applies-to-area edges from tags', () => {
    const g = buildGraph(slices);
    expect(g.edges).toContainEqual({ from: 'adr-200', to: 'area:substrate', type: 'applies-to-area' });
  });

  it('does NOT mention a non-distinctive id (no digit) found as a substring', () => {
    const g = buildGraph([
      {
        nodes: [
          { id: 'pack-care', kind: 'concept', title: 'care', status: 'ratified', summary: '', path: 'p', tags: [] },
          { id: 'mem-x', kind: 'memory', title: 'm', status: 'unknown', summary: 'notes on patient care plans', path: 'p', tags: [] },
        ],
        edges: [],
        warnings: [],
      },
    ]);
    expect(g.edges.some((e) => e.type === 'mentions' && e.to === 'pack-care')).toBe(false);
  });
});

describe('index store round-trips', () => {
  it('writes and reads back an identical graph', () => {
    const g = buildGraph(slices);
    const dir = mkdtempSync(join(tmpdir(), 'kg-'));
    const path = join(dir, 'idx.json');
    writeIndex(g, path);
    const back = readIndex(path);
    expect(back.nodes['adr-200'].title).toBe('Persist effects');
    expect(back.edges.length).toBe(g.edges.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/build-graph.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the builder**

Create `src/knowledge-graph/graph/build-graph.ts`:
```ts
import type { KgGraph, KgEdge, RawSlice } from '../graph-model.js';

const EXTERNAL_REF_RE = /^[a-z-]+#\d+$|^area:/i;

/** Merge reader slices into one graph; derive `mentions` + `applies-to-area`; flag dangling edges. */
export function buildGraph(slices: RawSlice[]): KgGraph {
  const nodes: KgGraph['nodes'] = {};
  const edges: KgEdge[] = [];
  const warnings: string[] = [];

  for (const slice of slices) {
    warnings.push(...slice.warnings);
    for (const n of slice.nodes) {
      if (nodes[n.id]) warnings.push(`duplicate node id: ${n.id} (keeping first)`);
      else nodes[n.id] = n;
    }
    edges.push(...slice.edges);
  }

  // Derived: applies-to-area from tags AND file path. Concepts carry no `tags:`
  // (Task 0), so also read the area from `.../concepts/<area>/...` path segments.
  const AREAS = ['substrate', 'design-system', 'exercir', 'devloop', 'conservation', 'herdbook'];
  for (const n of Object.values(nodes)) {
    const areas = new Set<string>();
    for (const tag of n.tags) if (AREAS.includes(tag)) areas.add(tag);
    const pm = /\/concepts\/([a-z-]+)\//.exec(n.path);
    if (pm && AREAS.includes(pm[1]!)) areas.add(pm[1]!);
    for (const a of areas) edges.push({ from: n.id, to: `area:${a}`, type: 'applies-to-area' });
  }

  // Derived: mentions — a node summary references another node's id as a WHOLE WORD.
  // Restrict to DISTINCTIVE ids (length>=6 AND containing a digit, e.g. `adr-200`,
  // dated concept/memory slugs) and use word boundaries, so common substrings
  // ('care' in 'pack-care') don't generate spurious edges at ~400-node scale.
  const distinctive = Object.keys(nodes).filter((id) => id.length >= 6 && /\d/.test(id));
  for (const n of Object.values(nodes)) {
    const hay = n.summary.toLowerCase();
    for (const other of distinctive) {
      if (other === n.id) continue;
      const esc = other.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${esc}\\b`).test(hay)) {
        edges.push({ from: n.id, to: other, type: 'mentions' });
      }
    }
  }

  // Dangling-edge warnings (target not a node and not an external/area ref).
  for (const e of edges) {
    if (!nodes[e.to] && !EXTERNAL_REF_RE.test(e.to)) {
      warnings.push(`dangling edge: ${e.from} -${e.type}-> ${e.to} (target not in graph)`);
    }
  }

  return { nodes, edges, warnings };
}
```

- [ ] **Step 4: Implement the index store**

Create `src/knowledge-graph/graph/index-store.ts`:
```ts
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KgGraph } from '../graph-model.js';

export function writeIndex(graph: KgGraph, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(graph, null, 2));
}

export function readIndex(path: string): KgGraph {
  return JSON.parse(readFileSync(path, 'utf8')) as KgGraph;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/build-graph.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/knowledge-graph/graph/build-graph.ts src/knowledge-graph/graph/index-store.ts test/knowledge-graph/build-graph.test.ts
git commit -m "feat(kg): graph builder (merge + derived edges + dangling warnings) + index store"
```

---

## Task 6: Seed-finding (lexical + tag)

**Files:**
- Create: `domains/devloop/src/knowledge-graph/retrieval/seed.ts`
- Test: `domains/devloop/test/knowledge-graph/seed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { findSeeds } from '../../src/knowledge-graph/retrieval/seed.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const graph: KgGraph = {
  nodes: {
    'adr-200': { id: 'adr-200', kind: 'adr', title: 'Persist PlanNode effects (kernel persistence)', status: 'ratified', summary: 'persist effect declarations', path: 'p', tags: ['substrate'] },
    'adr-168': { id: 'adr-168', kind: 'adr', title: 'Design-system bricks', status: 'ratified', summary: 'UI bricks live in design-system', path: 'p', tags: ['design-system'] },
    'mem-k': { id: 'mem-k', kind: 'memory', title: 'kernel state', status: 'unknown', summary: 'Read before any kernel-persistence work', path: 'p', tags: ['memory'] },
  },
  edges: [],
  warnings: [],
};

describe('findSeeds', () => {
  it('ranks nodes whose title/summary/tags overlap the task above unrelated nodes', () => {
    const seeds = findSeeds('kernel persistence', graph, 3);
    const ids = seeds.map((s) => s.id);
    expect(ids).toContain('adr-200');
    expect(ids).toContain('mem-k');
    expect(ids[ids.length - 1]).not.toBe('adr-168'); // unrelated ranks last or is excluded
  });

  it('returns scores in descending order and respects k', () => {
    const seeds = findSeeds('kernel persistence', graph, 1);
    expect(seeds.length).toBe(1);
  });

  it('returns empty for a task with no lexical overlap', () => {
    expect(findSeeds('quarterly revenue forecast', graph, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/seed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/knowledge-graph/retrieval/seed.ts`:
```ts
import type { KgGraph } from '../graph-model.js';

export interface SeedHit {
  id: string;
  score: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'be',
  'with', 'this', 'that', 'it', 'as', 'at', 'by', 'we', 'our', 'any',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Score every node by weighted token overlap with the task; return top-k above 0. */
export function findSeeds(task: string, graph: KgGraph, k = 8): SeedHit[] {
  const q = new Set(tokenize(task));
  if (q.size === 0) return [];
  const hits: SeedHit[] = [];
  for (const n of Object.values(graph.nodes)) {
    const title = new Set(tokenize(n.title));
    const summary = new Set(tokenize(n.summary));
    const tags = new Set(n.tags.flatMap(tokenize));
    let score = 0;
    for (const t of q) {
      if (title.has(t)) score += 3;
      if (tags.has(t)) score += 2;
      if (summary.has(t)) score += 1;
    }
    if (score > 0) hits.push({ id: n.id, score: score / q.size });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/seed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-graph/retrieval/seed.ts test/knowledge-graph/seed.test.ts
git commit -m "feat(kg): lexical+tag seed-finding"
```

---

## Task 7: Edge traversal

**Files:**
- Create: `domains/devloop/src/knowledge-graph/retrieval/traverse.ts`
- Test: `domains/devloop/test/knowledge-graph/traverse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/traverse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { traverse } from '../../src/knowledge-graph/retrieval/traverse.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const graph: KgGraph = {
  nodes: {
    a: { id: 'a', kind: 'adr', title: 'a', status: 'ratified', summary: '', path: 'p', tags: [] },
    b: { id: 'b', kind: 'adr', title: 'b', status: 'ratified', summary: '', path: 'p', tags: [] },
    c: { id: 'c', kind: 'adr', title: 'c', status: 'ratified', summary: '', path: 'p', tags: [] },
    d: { id: 'd', kind: 'adr', title: 'd', status: 'ratified', summary: '', path: 'p', tags: [] },
  },
  edges: [
    { from: 'a', to: 'b', type: 'relates-to' },
    { from: 'b', to: 'c', type: 'depends-on' },
    { from: 'c', to: 'd', type: 'relates-to' },
  ],
  warnings: [],
};

describe('traverse', () => {
  it('reaches nodes within N hops from the seeds, recording hop distance', () => {
    const reached = traverse(graph, ['a'], 2);
    const byId = new Map(reached.map((r) => [r.id, r]));
    expect(byId.get('a')!.hops).toBe(0);
    expect(byId.get('b')!.hops).toBe(1);
    expect(byId.get('c')!.hops).toBe(2);
    expect(byId.has('d')).toBe(false); // 3 hops away
  });

  it('traverses edges in both directions (a reachable from b seed)', () => {
    const reached = traverse(graph, ['b'], 1);
    const ids = reached.map((r) => r.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('records the edge path taken to each reached node', () => {
    const reached = traverse(graph, ['a'], 2);
    const c = reached.find((r) => r.id === 'c')!;
    expect(c.viaPath).toEqual(['a -relates-to-> b', 'b -depends-on-> c']);
  });

  it('ignores edges to external/area refs (no such node)', () => {
    const g: KgGraph = { ...graph, edges: [...graph.edges, { from: 'a', to: 'substrate#9', type: 'implemented-by' }] };
    const reached = traverse(g, ['a'], 1);
    expect(reached.some((r) => r.id === 'substrate#9')).toBe(false);
  });

  it('terminates on a cycle, visiting each node once', () => {
    const cyclic: KgGraph = {
      nodes: graph.nodes,
      edges: [
        { from: 'a', to: 'b', type: 'relates-to' },
        { from: 'b', to: 'c', type: 'relates-to' },
        { from: 'c', to: 'a', type: 'relates-to' },
      ],
      warnings: [],
    };
    const reached = traverse(cyclic, ['a'], 5);
    expect(reached.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('caps the reached-set at maxNodes', () => {
    const reached = traverse(graph, ['a'], 5, 2);
    expect(reached.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/traverse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/knowledge-graph/retrieval/traverse.ts`:
```ts
import type { KgGraph } from '../graph-model.js';

export interface Reached {
  id: string;
  hops: number;
  viaPath: string[]; // human-readable edge steps from a seed
}

interface Adjacency {
  to: string;
  label: string;
}

function buildAdjacency(graph: KgGraph): Map<string, Adjacency[]> {
  const adj = new Map<string, Adjacency[]>();
  const push = (from: string, to: string, label: string) => {
    if (!graph.nodes[to]) return; // skip external/area refs — only walk real nodes
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, label });
  };
  for (const e of graph.edges) {
    // Label always states the edge in its canonical (stored) direction — that is the
    // truthful relationship for the WHY-THESE provenance line, regardless of which
    // way BFS walked it (e.g. reaching adr-200 from seed adr-153 still reads
    // "adr-153 -superseded-by-> adr-200", i.e. "use adr-200").
    push(e.from, e.to, `${e.from} -${e.type}-> ${e.to}`);
    push(e.to, e.from, `${e.from} -${e.type}-> ${e.to}`); // undirected walk, same canonical label
  }
  return adj;
}

/**
 * BFS up to `maxHops` from each seed; first time a node is reached wins (shortest path).
 * `maxNodes` caps the reached-set — the real graph is dense and cyclic, so an
 * uncapped hops=2 walk from a high-degree seed could pull hundreds of nodes.
 */
export function traverse(graph: KgGraph, seedIds: string[], maxHops = 2, maxNodes = 200): Reached[] {
  const adj = buildAdjacency(graph);
  const seen = new Map<string, Reached>();
  const queue: Reached[] = [];
  for (const id of seedIds) {
    if (graph.nodes[id] && !seen.has(id)) {
      const r: Reached = { id, hops: 0, viaPath: [] };
      seen.set(id, r);
      queue.push(r);
    }
  }
  while (queue.length > 0) {
    if (seen.size >= maxNodes) break;
    const cur = queue.shift()!;
    if (cur.hops >= maxHops) continue;
    for (const { to, label } of adj.get(cur.id) ?? []) {
      if (seen.has(to)) continue;
      if (seen.size >= maxNodes) break;
      const r: Reached = { id: to, hops: cur.hops + 1, viaPath: [...cur.viaPath, label] };
      seen.set(to, r);
      queue.push(r);
    }
  }
  return [...seen.values()];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/traverse.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-graph/retrieval/traverse.ts test/knowledge-graph/traverse.test.ts
git commit -m "feat(kg): typed-edge BFS traversal with hop distance + path"
```

---

## Task 8: Ranking + context pack

**Files:**
- Create: `domains/devloop/src/knowledge-graph/retrieval/rank.ts`
- Create: `domains/devloop/src/knowledge-graph/retrieval/context-pack.ts`
- Test: `domains/devloop/test/knowledge-graph/context-pack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/context-pack.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rankNodes } from '../../src/knowledge-graph/retrieval/rank.js';
import { buildContextPack } from '../../src/knowledge-graph/retrieval/context-pack.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const graph: KgGraph = {
  nodes: {
    'adr-200': { id: 'adr-200', kind: 'adr', title: 'Persist effects', status: 'ratified', summary: '', path: 'layers/specs/adr/adr-200.md', tags: ['substrate'] },
    'adr-153': { id: 'adr-153', kind: 'adr', title: 'Plan-tree phase A', status: 'superseded', summary: '', path: 'p', tags: ['substrate'] },
    'policy-git': { id: 'policy-git', kind: 'policy', title: 'Git policy', status: 'ratified', summary: 'PRs only', path: 'policies/git.md', tags: ['governance'] },
    'mem-k': { id: 'mem-k', kind: 'memory', title: 'kernel state', status: 'unknown', summary: 'Read before kernel-persistence work', path: '/mem/k.md', tags: ['memory'] },
  },
  edges: [{ from: 'adr-153', to: 'adr-200', type: 'superseded-by' }],
  warnings: [],
};

describe('rankNodes', () => {
  it('ranks a ratified node above a superseded one at equal proximity', () => {
    const ranked = rankNodes(
      graph,
      [{ id: 'adr-200', score: 1 }, { id: 'adr-153', score: 1 }],
      [{ id: 'adr-200', hops: 0, viaPath: [] }, { id: 'adr-153', hops: 0, viaPath: [] }],
    );
    expect(ranked[0].id).toBe('adr-200');
  });
});

describe('buildContextPack', () => {
  const ranked = rankNodes(
    graph,
    [{ id: 'adr-200', score: 1 }, { id: 'mem-k', score: 0.8 }],
    [
      { id: 'adr-200', hops: 0, viaPath: [] },
      { id: 'mem-k', hops: 0, viaPath: [] },
      { id: 'policy-git', hops: 1, viaPath: ['adr-200 -relates-to-> policy-git'] },
      { id: 'adr-153', hops: 1, viaPath: ['adr-200 -superseded-by-> adr-153'] },
    ],
  );

  it('groups nodes into RULES / DECIDED / LEARNED sections', () => {
    const pack = buildContextPack('kernel persistence', graph, ranked, 4000);
    expect(pack).toContain('RULES:');
    expect(pack).toContain('policy-git');
    expect(pack).toContain('DECIDED:');
    expect(pack).toContain('adr-200');
    expect(pack).toContain('LEARNED:');
    expect(pack).toContain('mem-k');
  });

  it('annotates a superseded node with its successor', () => {
    const pack = buildContextPack('kernel persistence', graph, ranked, 4000);
    expect(pack).toMatch(/adr-153 .*superseded-by.* adr-200/);
  });

  it('caps output to the budget, keeps the highest-ranked, reports the dropped count', () => {
    const pack = buildContextPack('kernel persistence', graph, ranked, 120);
    expect(pack).toContain('adr-200'); // top-ranked survives the cap
    expect(pack).toMatch(/MORE:\s*\d+ further/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/context-pack.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement ranking**

Create `src/knowledge-graph/retrieval/rank.ts`:
```ts
import type { KgGraph } from '../graph-model.js';
import { STATUS_WEIGHT } from '../graph-model.js';
import type { SeedHit } from './seed.js';
import type { Reached } from './traverse.js';

export interface RankedNode {
  id: string;
  score: number;
  hops: number;
  viaPath: string[];
}

function recencyWeight(date: string | undefined): number {
  if (!date) return 0;
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return 0;
  return year >= 2026 ? 0.2 : 0.0; // light nudge toward current-cycle artifacts
}

/** Composite: seed match + edge proximity + status weight + recency. */
export function rankNodes(graph: KgGraph, seeds: SeedHit[], reached: Reached[]): RankedNode[] {
  const seedScore = new Map(seeds.map((s) => [s.id, s.score]));
  const ranked: RankedNode[] = [];
  for (const r of reached) {
    const node = graph.nodes[r.id];
    if (!node) continue;
    const proximity = 1 / (1 + r.hops);
    const status = STATUS_WEIGHT[node.status];
    const score = (seedScore.get(r.id) ?? 0) * 2 + proximity + status + recencyWeight(node.date);
    ranked.push({ id: r.id, score, hops: r.hops, viaPath: r.viaPath });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: Implement the context pack**

Create `src/knowledge-graph/retrieval/context-pack.ts`:
```ts
import type { KgGraph, KgNode } from '../graph-model.js';
import type { RankedNode } from './rank.js';

const RULE_KINDS = new Set(['policy', 'instruction']);
const DECISION_KINDS = new Set(['adr', 'concept']);

function successorOf(graph: KgGraph, id: string): string | undefined {
  const e = graph.edges.find((x) => x.from === id && x.type === 'superseded-by');
  return e?.to;
}

function lineFor(graph: KgGraph, n: KgNode): string {
  if (n.status === 'superseded' || n.status === 'deprecated') {
    const succ = successorOf(graph, n.id);
    return `WARN ${n.id} (${n.status}${succ ? `, superseded-by ${succ} — use ${succ}` : ''})`;
  }
  return `${n.id} (${n.title})`;
}

/** Render a token-bounded context pack. Budget is a rough char cap (≈4 chars/token). */
export function buildContextPack(task: string, graph: KgGraph, ranked: RankedNode[], budget = 4000): string {
  const charCap = budget; // treat budget as a char cap for simplicity/determinism
  const rules: string[] = [];
  const decided: string[] = [];
  const learned: string[] = [];
  const why: string[] = [];
  const files: string[] = [];
  let used = 0;
  let dropped = 0;

  // ranked is sorted by score desc, so we keep a PREFIX (the highest-ranked survive)
  // and break on the first over-budget line — `dropped` is then the exact tail count.
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]!;
    const n = graph.nodes[r.id];
    if (!n) continue;
    const line = lineFor(graph, n);
    if (used + line.length > charCap) {
      dropped = ranked.length - i;
      break;
    }
    used += line.length;
    if (RULE_KINDS.has(n.kind)) rules.push(line);
    else if (DECISION_KINDS.has(n.kind)) decided.push(line);
    else learned.push(n.kind === 'memory' ? `[[${n.id}]] "${n.summary}"` : line);
    const last = r.viaPath[r.viaPath.length - 1];
    if (last) why.push(last);
    files.push(n.path);
  }

  const out: string[] = [`TASK: "${task}"`];
  if (rules.length) out.push(`RULES:    ${rules.join(' · ')}`);
  if (decided.length) out.push(`DECIDED:  ${decided.join(' · ')}`);
  if (learned.length) out.push(`LEARNED:  ${learned.join(' · ')}`);
  if (why.length) out.push(`WHY THESE: ${[...new Set(why)].join(' ; ')}`);
  if (files.length) out.push(`FILES:    ${[...new Set(files)].join(' , ')}`);
  if (dropped > 0) out.push(`MORE:     ${dropped} further nodes within reach — kg_query to expand`);
  return out.join('\n');
}
```
Note on budget: we treat `budget` as a character cap for deterministic testing. The MCP layer (Task 10) documents the ≈4-chars-per-token rule of thumb for callers.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/context-pack.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/knowledge-graph/retrieval/rank.ts src/knowledge-graph/retrieval/context-pack.ts test/knowledge-graph/context-pack.test.ts
git commit -m "feat(kg): composite ranking + token-bounded context pack"
```

---

## Task 9: Public API wiring + golden-query quality net

This task wires the readers→build→retrieval flow into two public functions (`buildIndexFromConfig`, `contextFor`) and adds the golden-query regression net against a fixture corpus.

**Files:**
- Create: `domains/devloop/src/knowledge-graph/index.ts`
- Test: `domains/devloop/test/knowledge-graph/golden-queries.test.ts`
- Uses existing fixtures from Tasks 3–4.

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-graph/golden-queries.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndexFrom, contextFor, queryGraph, rebuildIndex } from '../../src/knowledge-graph/index.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');

// Build the graph once from the fixture corpus (specs + workbench + memory).
function fixtureGraph(): KgGraph {
  return buildIndexFrom({
    specsRoot: join(FIX, 'specs'),
    workbenchRoot: join(FIX, 'workbench'),
    memoryDir: join(FIX, 'memory'),
    clusterRoot: FIX,
  });
}

interface Golden {
  task: string;
  mustInclude: string[];
}

// Fixture-backed cases (hermetic). EXPAND the fixture corpus from Tasks 3–4 to
// ~15–20 nodes — add ≥6 DISTRACTOR files (unrelated ADRs/concepts on other areas:
// e.g. an `adr-168` design-system bricks, a `pack-football` concept, a governance
// `policy-testing`) so seeding has to discriminate among competitors, not trivially
// match a 5-node graph. Aim for ~12 golden cases total once distractors exist.
const GOLDEN: Golden[] = [
  { task: 'kernel persistence effects', mustInclude: ['adr-200', 'substrate-kernel-state'] },
  { task: 'kernel minimality inclusion test', mustInclude: ['adr-176'] },
  { task: 'substrate vision north star', mustInclude: ['north-star'] },
  { task: 'git policy pull request branch', mustInclude: ['policy-git'] },
];

describe('golden queries (retrieval quality net)', () => {
  const graph = fixtureGraph();
  for (const g of GOLDEN) {
    it(`"${g.task}" surfaces ${g.mustInclude.join(', ')}`, () => {
      const pack = contextFor(g.task, graph, 4000);
      for (const id of g.mustInclude) expect(pack).toContain(id);
    });
  }

  it('ranks a superseded node below its successor and annotates it (non-vacuous)', () => {
    const pack = contextFor('plan tree phase A effects', graph, 4000);
    expect(pack).toContain('adr-153'); // both MUST be present, or the test is meaningless
    expect(pack).toContain('adr-200');
    expect(pack.indexOf('adr-200')).toBeLessThan(pack.indexOf('adr-153'));
    expect(pack).toMatch(/adr-153 .*superseded-by.* adr-200/);
  });

  it('kg_query walks a named edge from a node', () => {
    const res = queryGraph(graph, { from: 'adr-153', edge: 'superseded-by', hops: 1 });
    expect(res.map((r) => r.id)).toContain('adr-200');
  });

  // Real-corpus assertion — GATED so CI without the corpus stays green. Run with
  // DEVLOOP_KG_REAL=1 + DEVLOOP_MEMORY_DIR set to validate against the live cluster
  // (precedent: devloop gates its DB test on DATABASE_URL). This is the tripwire the
  // hermetic fixtures cannot be: it exercises real ids, real status vocab, ~hundreds
  // of competing nodes.
  const REAL = process.env.DEVLOOP_KG_REAL === '1';
  it.runIf(REAL)('surfaces adr-176 + adr-200 for "kernel persistence" on the REAL corpus', () => {
    const real = rebuildIndex().graph;
    expect(Object.keys(real.nodes).length).toBeGreaterThan(300);
    const pack = contextFor('kernel persistence effects', real, 4000);
    expect(pack).toContain('adr-200');
    expect(pack).toContain('adr-176');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/golden-queries.test.ts`
Expected: FAIL — `index.js` exports not found.

- [ ] **Step 3: Implement the public API**

Create `src/knowledge-graph/index.ts`:
```ts
import type { KgGraph } from './graph-model.js';
import { resolveConfig } from './config.js';
import { readAdrs } from './sources/adr-reader.js';
import { readConcepts } from './sources/concept-reader.js';
import { readGovernance } from './sources/governance-reader.js';
import { readMemory } from './sources/memory-reader.js';
import { buildGraph } from './graph/build-graph.js';
import { writeIndex, readIndex } from './graph/index-store.js';
import { findSeeds } from './retrieval/seed.js';
import { traverse, type Reached } from './retrieval/traverse.js';
import { rankNodes } from './retrieval/rank.js';
import { buildContextPack } from './retrieval/context-pack.js';

export * from './graph-model.js';
export { findSeeds } from './retrieval/seed.js';
export { traverse } from './retrieval/traverse.js';
export { rankNodes } from './retrieval/rank.js';
export { buildContextPack } from './retrieval/context-pack.js';

export interface BuildRoots {
  specsRoot: string;
  workbenchRoot: string;
  memoryDir: string | undefined;
  clusterRoot: string;
}

/** Build the graph from explicit roots (used by tests + rebuild). */
export function buildIndexFrom(roots: BuildRoots): KgGraph {
  return buildGraph([
    readAdrs(roots.specsRoot, roots.clusterRoot),
    readConcepts(roots.specsRoot, roots.clusterRoot),
    readGovernance(roots.workbenchRoot, roots.clusterRoot),
    readMemory(roots.memoryDir),
  ]);
}

/** Build from the resolved cluster config + persist to the index path. */
export function rebuildIndex(): { graph: KgGraph; indexPath: string } {
  const cfg = resolveConfig();
  const graph = buildIndexFrom({
    specsRoot: cfg.specsRoot,
    workbenchRoot: cfg.workbenchRoot,
    memoryDir: cfg.memoryDir,
    clusterRoot: cfg.clusterRoot,
  });
  writeIndex(graph, cfg.indexPath);
  return { graph, indexPath: cfg.indexPath };
}

/** Load the persisted index, or rebuild if absent. */
export function loadOrBuildIndex(): KgGraph {
  const cfg = resolveConfig();
  try {
    return readIndex(cfg.indexPath);
  } catch {
    return rebuildIndex().graph;
  }
}

/** The warm-start context pack for a free-text task. */
export function contextFor(task: string, graph: KgGraph, budget = 4000): string {
  const seeds = findSeeds(task, graph, 8);
  const reached = traverse(graph, seeds.map((s) => s.id), 2);
  const ranked = rankNodes(graph, seeds, reached);
  return buildContextPack(task, graph, ranked, budget);
}

export interface QueryArgs {
  from?: string;
  edge?: string; // an EdgeType value; out-of-vocabulary strings simply match nothing
  hops?: number;
  text?: string;
  status?: string; // a NodeStatus value; out-of-vocabulary strings simply match nothing
}

/** Explicit-knob query: from a seed node and/or text, optionally filtered by edge/status. */
export function queryGraph(graph: KgGraph, args: QueryArgs): Reached[] {
  const seedIds = args.from
    ? [args.from]
    : args.text
      ? findSeeds(args.text, graph, 8).map((s) => s.id)
      : [];
  let reached = traverse(graph, seedIds, args.hops ?? 2);
  if (args.edge) {
    const targets = new Set(graph.edges.filter((e) => e.type === args.edge).flatMap((e) => [e.from, e.to]));
    reached = reached.filter((r) => targets.has(r.id));
  }
  if (args.status) reached = reached.filter((r) => graph.nodes[r.id]?.status === args.status);
  return reached;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/golden-queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run typecheck && npx vitest run test/knowledge-graph`
Expected: typecheck clean; all knowledge-graph tests PASS. NOTE: `tsc` only checks `src/**` (tsconfig `include: ["src"]`), so test-file type errors won't surface here — but every `src/**` file MUST be `noUncheckedIndexedAccess`-clean (this is why readers guard regex groups with `!`/`?.` and the retrieval code guards indexed reads). A `possibly 'undefined'` error means a guard was missed.

- [ ] **Step 6: Commit**

```bash
git add src/knowledge-graph/index.ts test/knowledge-graph/golden-queries.test.ts
git commit -m "feat(kg): public API (contextFor/queryGraph/rebuildIndex) + golden-query net"
```

---

## Task 10: MCP server + registration + docs

**Files:**
- Create: `domains/devloop/src/knowledge-graph/mcp/server.ts`
- Modify: `domains/devloop/vitest.config.ts` (exclude the side-effectful server entry from coverage)
- Modify: `domains/devloop/package.json` (add `kg:mcp` + `kg:rebuild` scripts)
- Create: `domains/devloop/src/knowledge-graph/README.md`
- Modify: project/global `settings.json` MCP registration (see Step 5)
- Test: `domains/devloop/test/knowledge-graph/mcp-tools.test.ts`

- [ ] **Step 1: Write the failing test (tool handlers, not transport)**

Create `test/knowledge-graph/mcp-tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTools } from '../../src/knowledge-graph/mcp/server.js';
import { buildIndexFrom } from '../../src/knowledge-graph/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');

function tools() {
  const graph = buildIndexFrom({
    specsRoot: join(FIX, 'specs'),
    workbenchRoot: join(FIX, 'workbench'),
    memoryDir: join(FIX, 'memory'),
    clusterRoot: FIX,
  });
  // Inject a stub rebuild so kg_rebuild stays hermetic — it must NOT read the real
  // corpus or write a real data/kg-index.json as a unit-test side effect.
  return makeTools(() => graph, () => ({ graph, indexPath: '(stub)' }));
}

describe('MCP tool handlers', () => {
  it('kg_context returns a text context pack for a task', async () => {
    const out = await tools().kg_context({ task: 'kernel persistence effects' });
    expect(out.content[0].text).toContain('adr-200');
  });

  it('kg_query returns matching node ids', async () => {
    const out = await tools().kg_query({ from: 'adr-153', edge: 'superseded-by', hops: 1 });
    expect(out.content[0].text).toContain('adr-200');
  });

  it('kg_rebuild reports node + edge counts', async () => {
    const out = await tools().kg_rebuild({});
    expect(out.content[0].text).toMatch(/nodes=\d+/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/mcp-tools.test.ts`
Expected: FAIL — `makeTools` not found.

- [ ] **Step 3: Implement the server + tool factory**

Create `src/knowledge-graph/mcp/server.ts`:
```ts
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { KgGraph } from '../graph-model.js';
import { contextFor, queryGraph, rebuildIndex, loadOrBuildIndex } from '../index.js';

interface ToolResult {
  content: { type: 'text'; text: string }[];
}

/**
 * Pure tool handlers, parameterized by a graph accessor + a rebuild fn — directly
 * unit-testable and hermetic (the test injects a stub rebuild so kg_rebuild does
 * NOT touch the real corpus or write a real index.json).
 */
export function makeTools(
  getGraph: () => KgGraph,
  rebuild: () => { graph: KgGraph; indexPath: string } = rebuildIndex,
) {
  return {
    async kg_context(args: { task: string; budget?: number }): Promise<ToolResult> {
      const text = contextFor(args.task, getGraph(), args.budget ?? 4000);
      return { content: [{ type: 'text', text }] };
    },
    async kg_query(args: { from?: string; edge?: string; hops?: number; text?: string; status?: string }): Promise<ToolResult> {
      const reached = queryGraph(getGraph(), args); // QueryArgs uses string edge/status — no cast needed
      const lines = reached
        .sort((a, b) => a.hops - b.hops)
        .map((r) => {
          const last = r.viaPath[r.viaPath.length - 1];
          return `${r.id} (hops=${r.hops})${last ? ' via ' + last : ''}`;
        });
      return { content: [{ type: 'text', text: lines.join('\n') || '(no matches)' }] };
    },
    async kg_rebuild(_args: Record<string, never>): Promise<ToolResult> {
      const { graph, indexPath } = rebuild();
      const text = `rebuilt: nodes=${Object.keys(graph.nodes).length} edges=${graph.edges.length} warnings=${graph.warnings.length} -> ${indexPath}`;
      return { content: [{ type: 'text', text }] };
    },
  };
}

/** Boot the MCP server over stdio. Rebuilds the index on start; kg_rebuild refreshes. */
export async function main(): Promise<void> {
  let graph = loadOrBuildIndex();
  const tools = makeTools(() => graph);
  const server = new McpServer({ name: 'devloop-knowledge-graph', version: '0.1.0' });

  server.tool(
    'kg_context',
    'Warm-start context pack: given a free-text task, return the relevant rules, decisions, and lessons from the cluster knowledge graph.',
    { task: z.string(), budget: z.number().optional() },
    async (a) => tools.kg_context(a),
  );
  server.tool(
    'kg_query',
    'Traverse the knowledge graph: from a node id and/or text, optionally filtered by edge type or status.',
    { from: z.string().optional(), edge: z.string().optional(), hops: z.number().optional(), text: z.string().optional(), status: z.string().optional() },
    async (a) => tools.kg_query(a),
  );
  server.tool('kg_rebuild', 'Re-derive the knowledge-graph index from the corpus.', {}, async () => {
    const r = await tools.kg_rebuild({});
    graph = loadOrBuildIndex();
    return r;
  });

  await server.connect(new StdioServerTransport());
}

// Side-effectful entry: run when invoked directly. Use pathToFileURL so the
// comparison is correct on Windows (`file:///D:/...` with forward slashes) — the
// naive `file://${process.argv[1]}` template never matches a win32 path and the
// server would silently never start.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```
Note: verify the installed `@modelcontextprotocol/sdk` exposes `McpServer` at `server/mcp.js` and `server.tool(name, desc, zodShape, handler)`. If the installed major version differs, adapt the import paths / registration call to that version's README — the `makeTools` factory and its tests are SDK-agnostic and must stay unchanged.

- [ ] **Step 4: Exclude the entry from coverage + add scripts**

Modify `vitest.config.ts` — add the server entry to the existing `exclude` array:
```ts
      exclude: ['src/cli.ts', 'src/persist/plan-tree-store.ts', 'src/persist/persist-cascade.ts', 'src/knowledge-graph/mcp/server.ts'],
```

Modify `package.json` scripts — add:
```json
    "kg:mcp": "tsx src/knowledge-graph/mcp/server.ts",
    "kg:rebuild": "tsx -e \"import('./src/knowledge-graph/index.js').then(m => { const r = m.rebuildIndex(); console.log('nodes=' + Object.keys(r.graph.nodes).length, 'edges=' + r.graph.edges.length); })\"",
```

- [ ] **Step 5: Run to verify the handler test passes**

Run: `npx vitest run test/knowledge-graph/mcp-tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Real-corpus smoke (manual, not a CI test)**

Run (from `domains/devloop`, with the memory dir set):
```bash
DEVLOOP_MEMORY_DIR="$HOME/.claude/projects/D--development-projects-de-braighter/memory" npm run kg:rebuild
```
Expected: prints `nodes=NNN edges=MMM` with NNN in the hundreds (≈200 ADRs + ~150 concepts + policies + memories). Eyeball that `data/kg-index.json` was written and contains `adr-176`, `adr-200`. If counts are ~0, the cluster-root resolution is wrong — re-check `resolveConfig` against the actual on-disk layout.

- [ ] **Step 7: Register the MCP server (verify first, then do)**

FIRST confirm the canonical registration surface — do NOT assume. There is no `.mcp.json` at the cluster root and `.claude/settings.json` has no `mcpServers` section. Search the cluster for how an existing MCP server is wired (`mcpServers` / `.mcp.json`) and match that shape + launch convention. Then register with an explicit `cwd` so `tsx` resolves `domains/devloop/node_modules` (the SDK is installed there, not at cluster root):
```json
{
  "mcpServers": {
    "devloop-knowledge-graph": {
      "command": "npx",
      "args": ["tsx", "src/knowledge-graph/mcp/server.ts"],
      "cwd": "domains/devloop",
      "env": { "DEVLOOP_MEMORY_DIR": "${DEVLOOP_MEMORY_DIR}" }
    }
  }
}
```
The memory dir is machine-specific (the `D--development-projects-de-braighter` segment encodes this exact checkout path), so pass it via the `DEVLOOP_MEMORY_DIR` env var rather than hardcoding — the memory reader fails soft (warns + skips) when unset, so a machine without it still serves specs+governance. Restart the session, then confirm `kg_context` / `kg_query` / `kg_rebuild` appear and return sane results for "touch kernel persistence".

- [ ] **Step 8: Write the module README**

Create `src/knowledge-graph/README.md`:
```markdown
# devloop — SDLC Knowledge Graph (read-side)

Derives the cluster's procedural knowledge (ADR/concept frontmatter, governance
docs, the auto-memory graph) into a graph an agent queries via MCP instead of
greps. Read-side of an eventual read+write loop.

Spec: `../../../../docs/superpowers/specs/2026-05-31-sdlc-knowledge-graph-read-side-design.md`

## Tools (MCP server `devloop-knowledge-graph`)
- `kg_context(task, budget?)` — warm-start context pack (rules + decisions + lessons + WHY + files).
- `kg_query({from?, edge?, hops?, text?, status?})` — explicit traversal.
- `kg_rebuild()` — re-derive `data/kg-index.json` from the corpus.

## Run locally
- Rebuild index: `DEVLOOP_MEMORY_DIR=... npm run kg:rebuild`
- Serve MCP: `npm run kg:mcp`

## Config
Roots resolve from the devloop package location (cluster = ../.. ). Override the
external memory dir with `DEVLOOP_MEMORY_DIR`. Budget is a char cap (≈4 chars/token).

## Out of scope (phase 2+)
Write-side emit-loop, embeddings/semantic search, human viewer, activity spine.
```

- [ ] **Step 9: Full local gate + commit**

Run: `npm run ci:local` (typecheck + coverage + Sonar — the real gate, not just `vitest run`).
Expected: typecheck clean; full suite green. Coverage note: the new module enters devloop's coverage denominator (`vitest.config.ts` `include: ['src/**/*.ts']`); only `mcp/server.ts` is excluded (side-effectful entry). Readers/retrieval are well-covered by their tests, but `index.ts`'s `rebuildIndex`/`loadOrBuildIndex` disk paths bind to the real config — if the coverage gate dips, either add a temp-path round-trip test (extend `loadOrBuildIndex`/`readIndex` to accept an injected path) or justify the exclusion in `vitest.config.ts`.

```bash
git add src/knowledge-graph/mcp/server.ts src/knowledge-graph/README.md vitest.config.ts package.json test/knowledge-graph/mcp-tools.test.ts
git commit -m "feat(kg): MCP server (kg_context/kg_query/kg_rebuild) + registration + docs"
```

- [ ] **Step 10: Open the PR**

```bash
git push -u origin feat/knowledge-graph-read-side
gh pr create --base main --title "feat(kg): SDLC knowledge-graph read-side (devloop module)" --body-file - <<'EOF'
Implements docs/superpowers/specs/2026-05-31-sdlc-knowledge-graph-read-side-design.md (workbench#44).

Read-side SDLC knowledge graph as a devloop module: derives ADR/concept frontmatter + governance + memory into a graph queried via MCP (`kg_context` / `kg_query` / `kg_rebuild`). Lexical+tag seeding -> typed-edge traversal -> ranked, token-bounded context pack. Golden-query fixtures guard retrieval quality. No kernel change (ADR-176: internal tooling). Embeddings/viewer/write-side deferred.

Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
EOF
```
Then run the devloop verifier wave (reviewer + qa-engineer + local-ci) per `workflows/verifier-wave.md`, and the post-merge devloop feeding ritual per `policies/git.md`.

---

## Self-Review

**Spec coverage** (against `2026-05-31-sdlc-knowledge-graph-read-side-design.md`):
- §4 four-unit architecture → Tasks 2–4 (sources), 5 (graph), 6–8 (retrieval), 10 (mcp). ✓
- §5 node/edge model → `graph-model.ts` (Task 1), readers (Tasks 3–4), derived edges (Task 5). ✓
- §6 retrieval + context-pack contract (RULES/DECIDED/LEARNED/WHY/FILES/MORE, superseded annotation, budget cap) → Tasks 6–8 + assertions. ✓
- §7 MCP surface (`kg_context`/`kg_query`/`kg_rebuild`) → Task 10. ✓
- §8 freshness (rebuild on start + `kg_rebuild`) → `loadOrBuildIndex` + `kg_rebuild` (Tasks 9–10). ✓
- §9 testing tiers (golden queries, per-reader units, graph integrity) → Tasks 3/4 (readers), 5 (integrity/dangling), 9 (golden). ✓
- §1.2/§1.3 governance (no kernel, derive-not-author, configurable multi-root, workbench declarative) → config + readers read external roots, write nothing back. ✓
- §10 out-of-scope (write-side/embeddings/viewer/activity-spine) → not implemented; README + PR note them as deferred. ✓

**Placeholder scan:** every code step shows complete code; no TBD/TODO; the one SDK-version caveat (Task 10 Step 3) is a verification instruction with a concrete fallback, not a placeholder.

**Type consistency:** `KgNode`/`KgEdge`/`KgGraph`/`RawSlice` (Task 1) used verbatim throughout; `SeedHit` (Task 6), `Reached` (Task 7), `RankedNode` (Task 8) flow into `index.ts` (Task 9) and the MCP factory (Task 10). `findSeeds`/`traverse`/`rankNodes`/`buildContextPack`/`contextFor`/`queryGraph`/`buildIndexFrom`/`rebuildIndex`/`makeTools` names are consistent across definition and use.

## QA wave dispositions (2026-05-31)

Verifier wave: charter-checker **COHERENT** (no kernel creep — accepted as-is); reviewer **BLOCKED**; qa-engineer **PASS-WITH-FIXES**. Each finding's disposition:

| Finding (severity) | Source | Disposition |
|---|---|---|
| Windows MCP entry guard never fires (BLOCKING) | reviewer + qa | Fixed — `pathToFileURL(process.argv[1]).href` (Task 10 §3). |
| `noUncheckedIndexedAccess` breaks typecheck (BLOCKING) | reviewer + qa | Fixed — every regex group + indexed read guarded (`!`/`?.`); typecheck-scope note added (Tasks 2–8, 9 §5). |
| Config test asserts POSIX paths win32 can't produce (BLOCKING) | reviewer | Fixed — platform-agnostic test via `path` ops (Task 1 §3). |
| Plan authored against idealized corpus (BLOCKING) | qa | Fixed — new **Task 0** reconnaissance; `domain` added to tag sources; area derived from path (Tasks 0, 3, 5). |
| Golden net is a toy / vacuous assertion (BLOCKING) | qa | Fixed — non-vacuous superseded assertion, distractor-fixture instruction, `DEVLOOP_KG_REAL`-gated real-corpus test (Task 9). |
| `zod` floor below SDK requirement (SHOULD-FIX) | reviewer | Fixed — bumped to `^3.25.0` (Task 1 §1). |
| `kg_rebuild` test not hermetic (SHOULD-FIX) | reviewer | Fixed — injectable `rebuild` stub (Task 10 §1, §3). |
| `as never` cast launders type mismatch (SHOULD-FIX) | reviewer | Fixed — `QueryArgs.edge/status` widened to `string`; cast removed (Tasks 9, 10). |
| `firstHeading` `''` vs `id` dead fallback (SHOULD-FIX) | reviewer | Fixed — `||` fallback (Task 3). |
| `mentions` substring false positives (SHOULD-FIX) | reviewer + qa | Fixed — word-boundary + digit-bearing distinctive ids + negative test (Task 5). |
| traverse backward-label direction (SHOULD-FIX) | reviewer | Resolved — labels state the canonical (truthful) relationship by design; documented + the existing test covers the backward case (Task 7). |
| no cycle / reached-set cap test (SHOULD-FIX) | qa | Fixed — `maxNodes` cap + cycle + cap tests (Task 7). |
| budget cap order-dependent / `MORE` undercount (SHOULD-FIX) | qa | Fixed — keep highest-ranked prefix, break on overflow, exact drop count + test (Task 8). |
| MCP registration under-specified / wrong cwd / non-portable memory path (SHOULD-FIX) | qa | Fixed — verify-first, explicit `cwd`, `DEVLOOP_MEMORY_DIR` env (Task 10 §7). |
| typecheck doesn't cover tests / coverage delta (SHOULD-FIX) | qa | Documented — scope note (Task 9 §5) + coverage note + `ci:local` gate (Task 10 §9). |
| test dir diverges from flat convention (SHOULD-FIX) | qa | Documented — intentional, noted in File Structure + first commit. |

NITs (status-weight tie, `MORE` pluralization, `EXTERNAL_REF_RE` breadth) acknowledged; left as-is or folded into Task 0's enum reconciliation.
