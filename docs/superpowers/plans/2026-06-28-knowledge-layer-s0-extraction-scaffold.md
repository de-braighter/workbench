# Knowledge Layer — S0 (Extraction Precondition + Scaffold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `layers/knowledge` — a new published `@de-braighter/*` cluster layer (two libs: `knowledge-contracts` + `knowledge-runtime`) that builds, tests, and is registered in the cluster — and perform the **one real extraction MOVE** from `domains/foundry` that the base layer needs now (the dependency-free content-addressing hash), flipping foundry to consume it from the published layer. Zero kernel change; the larger blueprint/compiler core is catalogued for the §8 follow-on, not moved here.

**Architecture:** A new sibling repo `de-braighter/knowledge` cloned at `layers/knowledge/`, a pnpm workspace with two libraries, mirroring the **substrate** contracts/runtime split and the **charter-runtime** ADR-283 precedent (typed lens over `PlanNode.metadata`, Kernel-Untouched Invariant proven by a boundary-acid test + a zero-diff guard). S0 is foundation only: the knowledge-node lens, ContentPort, citation vocabulary, retrieval, and the twin are S1–S3. The extraction is scoped to `domains/foundry/src/generation/hash.ts` (`canonicalJson` + `sha256Hex` + `hashModel`/`hashContextPack`) — the only foundry primitive that is (a) genuinely reusable/domain-agnostic, (b) substrate-free (safe for foundry's old substrate pin), and (c) load-bearing for the base layer (contentRef integrity in S1; "what we knew at T" hashing in S3).

**Tech Stack:** TypeScript 5.6 (ESM/NodeNext), pnpm 9, Zod 3.23, Vitest 2.1; `@de-braighter/substrate-contracts` (type-only peer dep) + `@de-braighter/substrate-runtime` (runtime lib dep, S1+). No NestJS/Prisma in S0 (they enter in S1 with the pgvector store).

**Spec:** `docs/superpowers/specs/2026-06-28-knowledge-pack-design.md` — D1 (cluster layer), D2 (persistence = substrate/Postgres), D4 (ContentPort, NOT `importRef`), D8 (origin = foundry, via extraction), §7 (origin: foundry extract), §9 (kernel untouched), OQ4 (the exact module boundary to lift). ADR precedent: `layers/specs/adr/adr-283-charter-runtime-cluster-layer.md`.

**Cross-repo note:** Task 1 is read-only across `domains/foundry`. Tasks 2–4 create files in the **new** `layers/knowledge/` repo (its own git repo, gitignored from the workbench). Task 3 also edits `domains/foundry/` (consumer-flip, its own branch + PR). Task 5 edits the **workbench** repo (`repos.yaml` + `projects/knowledge/project.yaml`) and the **specs** repo (the new ADR) on separate branches. Task 6 opens the PRs. The GitHub remote for `de-braighter/knowledge` is created in Task 2 Step 1 (confirm-with-user, like the markets foundation plan).

---

## Global Constraints

- **ESM/NodeNext** — every relative import carries an explicit `.js` extension (e.g. `from './content-hash.js'`). Each `package.json` has `"type": "module"`.
- **ZERO kernel change (STOP/escalate guardrail)** — no file under `layers/substrate` production surface may be edited. These paths MUST stay byte-identical vs `origin/main`: `libs/substrate-contracts/src/plan-tree/*`, `libs/substrate-runtime/src/plan-tree/*`, any `kernel.*` Prisma schema/migration. **Any task that would edit a `layers/substrate` production file is a STOP — escalate; do not proceed.** Adding a *test* file under substrate is the only allowed substrate touch (and S0 needs none).
- **Everything rides `metadata` + the published plan-tree port** — the layer consumes substrate only through the published `@de-braighter/substrate-{contracts,runtime}` package surface (never a relative reach into the sibling repo, never a deep `dist/` path). Enforced by the boundary-acid test (Task 4).
- **The moved content-hash module stays substrate-free** — `content-hash.ts` imports only `node:crypto`. It MUST NOT import anything from `@de-braighter/substrate-*`, so `domains/foundry` (pinned to `@de-braighter/substrate-contracts@^0.10.0`, npm + tsx) can consume it without dragging the layer's `^2.7.0` peer dep into foundry. **If the foundry consumer-flip transitively pulls substrate-contracts 2.7.0 into foundry, STOP** and take the documented fallback (Task 3 Step 6).
- **Extraction is a MOVE, not a copy** — `hash.ts` is deleted from foundry and its importers re-pointed at the published package. A lingering duplicate is a plan failure (the fallback in Task 3 Step 6 is the only sanctioned exception, and it is tracked as debt).
- **Respect the spec's open questions (do not pre-decide them here):** OQ1 (sub-document granularity → S1), OQ2 (relationship to `devloop-knowledge-graph` → sibling source for now), OQ3 (embedding model/dim/cadence → S1/S2), **OQ4 (the exact extraction boundary → resolved by Task 1 + recorded in the ADR)**.
- **Branch discipline** — work on a feature branch in each repo you own; never run `git add -A`, `git checkout`, `git stash`, `git reset`, or `git clean` in a shared clone (workbench, substrate, foundry-main). Commit frequently. Do NOT run git ops in clones other than the feature branch you created.

---

## File Structure

```text
layers/knowledge/                          NEW repo de-braighter/knowledge (pnpm workspace)
├── package.json                           workspace root: pnpm -r scripts, ci:local
├── pnpm-workspace.yaml                     packages: libs/*
├── tsconfig.base.json                      ES2022 + NodeNext
├── .npmrc                                  @de-braighter -> GitHub Packages
├── .gitignore                              node_modules, dist, *.tsbuildinfo, coverage
├── README.md                               what the layer is + how to build/test
├── libs/knowledge-contracts/               pure TS + zod (no NestJS); the S1 contract surface seed
│   ├── package.json                        @de-braighter/knowledge-contracts
│   ├── tsconfig.json, tsconfig.build.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                        barrel
│       ├── content-hash.ts                 MOVED from foundry/src/generation/hash.ts
│       ├── content-hash.spec.ts            moved test (+ canonical-JSON acid)
│       └── boundary-acid.spec.ts           import-boundary guard (Kernel-Untouched Invariant)
└── libs/knowledge-runtime/                 NestJS/Prisma adapters seed (filled in S1+)
    ├── package.json                        @de-braighter/knowledge-runtime
    ├── tsconfig.json, tsconfig.build.json
    ├── vitest.config.ts
    └── src/
        ├── index.ts                        barrel
        └── smoke.spec.ts                   scaffold smoke

domains/foundry/                            EXISTING repo (consumer-flip, own branch)
├── package.json                            + dependency on @de-braighter/knowledge-contracts
└── src/generation/
    ├── hash.ts                             DELETED (moved to the layer)
    ├── propose.ts                          import re-pointed
    ├── generate.ts                         import re-pointed
    └── context-packs/index.ts              import re-pointed

de-braighter/ (WORKBENCH repo, own branch)
├── repos.yaml                              + knowledge under layers:
└── projects/knowledge/project.yaml         NEW project descriptor

layers/specs/ (SPECS repo, own branch)
└── adr/adr-XXX-knowledge-layer-cluster.md  NEW ADR (records the OQ4 boundary decision)
```

---

### Task 1: Read-only extraction investigation — confirm the boundary (OQ4)

**Files:** none (read-only investigation; the output is the recorded decision in Task 5's ADR).

This task confirms what `domains/foundry` actually stores re: artifacts/references/versions and finalizes the exact module boundary to lift (spec §7, OQ4). A prior investigation (captured below) is the **starting hypothesis to verify**, not a substitute for looking — confirm each claim against the live code before acting, because foundry moves fast.

- [ ] **Step 1: Verify the foundry persistence model.** Read `domains/foundry/src/log.ts`, `src/state.ts`, `src/metamodel/blueprint.ts`, `src/metamodel/vocabulary.ts`, `src/plan/cascade.ts`. Confirm the hypothesis:
  - Foundry has **no first-class document store**. The only persistent store is the append-only event log `data/events.jsonl` (`DomainEventEnvelope`s). All state is a pure `fold(readEnvelopes(...))` (never persisted).
  - "Artifacts" = a derived `ProductBlueprint = { productKey, process: PlanTree, done: string[] }` + `SubstanceRef[]` (`SUBSTANCE_KINDS = ['pack','board','policy','indicator']`), extracted on demand (`extractBlueprint`), never stored (ADR-242 — substance is derived).
  - "References" = **unenforced, unindexed** `metadata.crossRefs: { ratifies, relatesTo }` on cascade nodes + per-item `ancestry`/`dependsOn` (no backlink/impact index).
  - "Versions" = content-address hashing of **generation runs** (`generation/hash.ts`: `sha256(canonicalJson(...))`), surfaced via `GenerationRun` events; **blueprints carry no version field** (round-trip identity via `_cascadeKey`).

- [ ] **Step 2: Confirm the move-able vs stays buckets.** Confirm `domains/foundry/src/generation/hash.ts` is **pure** (only `node:crypto`; no `Date.now`, no queue coupling, no substrate import) and that its only importers are `src/generation/{propose.ts,generate.ts,context-packs/index.ts}` (all of which stay in foundry). Confirm the larger pure core (`metamodel/{blueprint,generate,vocabulary,substance-log}.ts`, `plan/cascade.ts`, `compiler/{compile-target,registry,target-*}.ts`) is reusable but **blueprint/compiler-shaped, not document-shaped** — it belongs to the §8 blueprint-pack-skin follow-on, not the S1 document core.

- [ ] **Step 3: Record the OQ4 boundary decision** (verbatim into the Task 5 ADR draft, do not write code here):
  - **MOVE now (S0):** `domains/foundry/src/generation/hash.ts` → `@de-braighter/knowledge-contracts` (the substrate-free content-addressing primitive the base layer needs for contentRef integrity + provenance).
  - **MOVE later (§8 follow-on, when the blueprint pack-skin is built):** `metamodel/{blueprint,generate,vocabulary,substance-log}.ts`, `plan/cascade.ts`, `compiler/*`. Not now — moving them now imports dead code into the layer (YAGNI; ADR-176 "as simple as required").
  - **STAYS in foundry forever:** `log/state/events/ops/store-lock`, `plan/{tree-from-queue,frontier,plan-frontier-all,workflow-conductor}`, `generation/` (renderers), `dispatch/`, `dashboard/`, `derivations/`, `mcp/` (queue/claim/conductor control plane).
  - **Headline finding to flag in the ADR + the PR:** the spec's S1 document-management core (knowledge nodes with `contentRef` + `cites[]` + `whoCites` backlinks + pgvector) **does not exist in foundry** and is built NEW in S1. The "extract from a demonstrated need" framing (D8/§7) holds for the *blueprint/version* pillar (the §8 follow-on) but NOT for the *document/citation* pillar — S1 is genuinely new, and the foundry "architecture-knowledge pack-skin" is the first *consumer* of that new core, not an extraction of it.

---

### Task 2: Scaffold `layers/knowledge` (pnpm workspace, two libs, green)

**Files:**

- Create: `layers/knowledge/{package.json,pnpm-workspace.yaml,tsconfig.base.json,.npmrc,.gitignore,README.md}`
- Create: `layers/knowledge/libs/knowledge-contracts/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts}`
- Create: `layers/knowledge/libs/knowledge-runtime/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,src/index.ts,src/smoke.spec.ts}`

**Interfaces:**

- Produces: a building, test-running pnpm workspace with two published-shaped libs (`@de-braighter/knowledge-contracts`, `@de-braighter/knowledge-runtime`) that S1–S3 fill in.

- [ ] **Step 1: Create the GitHub repo + clone (confirm-with-user).** Outward-facing — do NOT run without explicit confirmation.

```bash
# Confirm with the user, then:
gh repo create de-braighter/knowledge --private --description "knowledge — shared document/artifact layer on substrate (the knowledge twin)"
cd D:/development/projects/de-braighter/layers
git clone git@github.com-de-braighter:de-braighter/knowledge.git   # SSH; mirror the charter-runtime clone
cd knowledge
git checkout -b feat/s0-scaffold
```

Expected: empty repo cloned at `layers/knowledge/` on branch `feat/s0-scaffold`. (If `gh`/clone is unavailable, scaffold the files locally on the branch and defer the remote to Task 6 — the local repo + commits are usable without a remote.)

- [ ] **Step 2: Resolve the real published substrate versions**

```bash
pnpm view @de-braighter/substrate-contracts version
pnpm view @de-braighter/substrate-runtime version
```

Use the printed versions (caret-ranged) in place of `^2.7.0` / `^2.8.0` below if they differ.

- [ ] **Step 3: Write the workspace root files.**

`layers/knowledge/package.json`:

```json
{
  "name": "@de-braighter/knowledge-workspace",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "knowledge — a shared, domain-agnostic document/artifact-management cluster layer on the de-braighter substrate. knowledge-contracts (pure lens + ports) + knowledge-runtime (Prisma/pgvector + NestJS adapters). Zero kernel change (ADR-176).",
  "scripts": {
    "build": "pnpm -r run build",
    "typecheck": "pnpm -r run typecheck",
    "test": "pnpm -r run test",
    "ci:local": "pnpm run typecheck && pnpm run build && pnpm run test"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  },
  "engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" },
  "packageManager": "pnpm@9.1.0"
}
```

`layers/knowledge/pnpm-workspace.yaml`:

```yaml
packages:
  - 'libs/*'
```

`layers/knowledge/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "baseUrl": "."
  }
}
```

`layers/knowledge/.npmrc` (mirror charter-runtime):

```ini
@de-braighter:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
always-auth=true
```

`layers/knowledge/.gitignore`:

```gitignore
node_modules/
dist/
*.tsbuildinfo
coverage/
.env
.env.*
!.env.example
```

`layers/knowledge/README.md`:

```markdown
# knowledge

A shared, domain-agnostic **document/artifact-management cluster layer** on the
de-braighter substrate (the "knowledge twin"). A knowledge corpus is a plan tree of
knowledge nodes; references are a second (citation) graph; specialization is by
pack-skin. **Zero kernel change** (ADR-176): everything rides `plan_node.metadata`
+ the published plan-tree port + event log + inference backbone + a layer-owned
pgvector table.

Design: `de-braighter/workbench` → `docs/superpowers/specs/2026-06-28-knowledge-pack-design.md`
ADR: `layers/specs/adr/adr-XXX-knowledge-layer-cluster.md`

## Packages

- `@de-braighter/knowledge-contracts` — pure TS + zod: the knowledge-node lens over
  `PlanNode.metadata`, the citation vocabulary, the `ContentPort` interface,
  retrieval/event types, and the content-addressing hash. Type-only peer dep on
  `@de-braighter/substrate-contracts`. No NestJS.
- `@de-braighter/knowledge-runtime` — NestJS/Prisma adapters: `ContentPort`
  adapters, the layer-owned pgvector retrieval store, the derived backlink index,
  event-log appenders, inference wiring, and the async workers. Depends on
  `@de-braighter/substrate-runtime` + `@de-braighter/knowledge-contracts`.

## Develop

    pnpm install
    pnpm run ci:local        # typecheck + build + test (all packages)

S0 = this scaffold + the content-hash extraction. S1 = document management
(retrieval + references). S2 = the twin (assessment). S3 = provenance.
```

- [ ] **Step 4: Write `libs/knowledge-contracts` scaffolding.**

`libs/knowledge-contracts/package.json`:

```json
{
  "name": "@de-braighter/knowledge-contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "knowledge layer contracts — knowledge-node lens, citation vocabulary, ContentPort, content-addressing hash. Pure TS + zod.",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "peerDependencies": { "@de-braighter/substrate-contracts": "^2.7.0" },
  "devDependencies": {
    "@de-braighter/substrate-contracts": "^2.7.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`libs/knowledge-contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "composite": true, "types": ["node", "vitest/globals"] },
  "include": ["src/**/*.ts"]
}
```

`libs/knowledge-contracts/tsconfig.build.json`:

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "types": ["node"] }, "exclude": ["src/**/*.spec.ts"] }
```

`libs/knowledge-contracts/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, environment: 'node', include: ['src/**/*.spec.ts'] } });
```

`libs/knowledge-contracts/src/index.ts` (placeholder; filled by Task 3 + S1):

```typescript
export const KNOWLEDGE_CONTRACTS = '@de-braighter/knowledge-contracts';
```

- [ ] **Step 5: Write `libs/knowledge-runtime` scaffolding** (same file shapes; name `@de-braighter/knowledge-runtime`; deps left empty in S0 — substrate-runtime + knowledge-contracts enter in S1):

`libs/knowledge-runtime/package.json`:

```json
{
  "name": "@de-braighter/knowledge-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "knowledge layer runtime — ContentPort adapters, pgvector retrieval store, backlink index, event-log appenders, inference wiring, async workers.",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

`libs/knowledge-runtime/tsconfig.json` / `tsconfig.build.json` / `vitest.config.ts`: identical shape to knowledge-contracts (adjust nothing but the directory).

`libs/knowledge-runtime/src/index.ts`:

```typescript
export const KNOWLEDGE_RUNTIME = '@de-braighter/knowledge-runtime';
```

`libs/knowledge-runtime/src/smoke.spec.ts`:

```typescript
import { KNOWLEDGE_RUNTIME } from './index.js';
describe('scaffold', () => {
  it('exports the package marker', () => {
    expect(KNOWLEDGE_RUNTIME).toBe('@de-braighter/knowledge-runtime');
  });
});
```

- [ ] **Step 6: Install + verify the workspace is green**

```bash
cd D:/development/projects/de-braighter/layers/knowledge
pnpm install
pnpm run ci:local
```

Expected: typecheck clean, both libs build to `dist/`, the runtime smoke test passes. (knowledge-contracts has no spec yet — Task 3 adds `content-hash.spec.ts`.)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .npmrc .gitignore README.md libs
git commit -m "chore(knowledge): scaffold pnpm workspace — knowledge-contracts + knowledge-runtime"
```

---

### Task 3: The extraction MOVE — content-hash, foundry consumer-flip (TDD)

**Files:**

- Create: `layers/knowledge/libs/knowledge-contracts/src/content-hash.ts`
- Create: `layers/knowledge/libs/knowledge-contracts/src/content-hash.spec.ts`
- Modify: `layers/knowledge/libs/knowledge-contracts/src/index.ts`
- Modify (foundry branch): `domains/foundry/package.json`, `domains/foundry/src/generation/{propose.ts,generate.ts,context-packs/index.ts}`
- Delete (foundry branch): `domains/foundry/src/generation/hash.ts` (+ its co-located spec, if any)

**Interfaces:**

- Produces (from `@de-braighter/knowledge-contracts`): `canonicalJson(value: unknown): string`, `sha256Hex(input: string): string`, `hashModel(model: unknown): string`, `hashContextPack(pack: unknown): string` — byte-identical to foundry's `generation/hash.ts`.

- [ ] **Step 1: Write the failing test** `libs/knowledge-contracts/src/content-hash.spec.ts` (a canonical-JSON acid that pins determinism + key-sorting + undefined handling, plus a known-vector sha256):

```typescript
import { canonicalJson, sha256Hex, hashModel, hashContextPack } from './content-hash.js';

describe('content-hash (moved from foundry/src/generation/hash.ts)', () => {
  it('canonicalJson sorts object keys recursively and is order-independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
  });

  it('canonicalJson omits undefined object values and nulls undefined array elements', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('sha256Hex is a stable 64-char hex digest of the canonical form', () => {
    const h = sha256Hex(canonicalJson({ a: 1 }));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashModel({ a: 1 })).toBe(h);
    expect(hashModel({ a: 1 })).toBe(hashModel({ a: 1 })); // deterministic
  });

  it('hashContextPack is hashModel over the same canonical form', () => {
    expect(hashContextPack({ k: [3, 2, 1] })).toBe(hashModel({ k: [3, 2, 1] }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd layers/knowledge/libs/knowledge-contracts && pnpm exec vitest run src/content-hash.spec.ts`
Expected: FAIL — cannot find module `./content-hash.js`.

- [ ] **Step 3: Move the implementation.** Copy `domains/foundry/src/generation/hash.ts` verbatim to `libs/knowledge-contracts/src/content-hash.ts` (it is already substrate-free — only `node:crypto`). Keep the exact function bodies; update the header comment to name the layer:

```typescript
// Deterministic, dependency-free canonical JSON + sha256 — the content-addressing
// primitive for contentRef integrity (S1) and "what we knew at T" provenance (S3).
// Pure: no wall-clock, no randomness. Substrate-free by design (foundry, pinned to
// an older substrate-contracts, consumes this without a peer-dep conflict).
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => v === undefined ? 'null' : canonicalJson(v)).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export const hashModel = (model: unknown): string => sha256Hex(canonicalJson(model));
export const hashContextPack = (pack: unknown): string => sha256Hex(canonicalJson(pack));
```

- [ ] **Step 4: Export from the barrel.** Replace `libs/knowledge-contracts/src/index.ts` body:

```typescript
export * from './content-hash.js';
```

- [ ] **Step 5: Run the test + the layer gate**

Run: `cd layers/knowledge && pnpm run ci:local`
Expected: typecheck clean; `content-hash.spec.ts` passes; both libs build.

- [ ] **Step 6: De-risk the foundry consumer-flip BEFORE editing foundry imports.** In a foundry feature branch, add the dependency and confirm it does NOT drag substrate-contracts 2.7.0 into foundry:

```bash
cd D:/development/projects/de-braighter/domains/foundry
git checkout -b feat/consume-knowledge-content-hash
# add the dep (match the layer's published version once it is published; until then
# the layer is unpublished — see the fallback below)
```

**Decision gate:**

- **If `@de-braighter/knowledge-contracts` is published and resolvable** (Task 6 publishes it, or it is workspace-linked): add `"@de-braighter/knowledge-contracts": "^0.0.x"` to `domains/foundry/package.json` deps, `npm install`, then confirm with `npm ls @de-braighter/substrate-contracts` that foundry's substrate-contracts is **still 0.10.x** (the content-hash import pulls no substrate peer because `content-hash.ts` imports none). If it resolves clean → proceed to Step 7.
- **If the install drags substrate-contracts 2.7.0 into foundry, OR the layer is not yet publishable** → **STOP and take the fallback:** do NOT flip foundry now. Keep foundry's `hash.ts` in place, mark the layer's `content-hash.ts` as the canonical home in the ADR, and file a debt item `foundry/de-fork-content-hash` (flip after foundry's substrate-contracts bump). Record which path was taken in the PR body. (This preserves "MOVE not re-invent" as an intent with a tracked completion, rather than forcing a risky foundry-wide substrate upgrade in S0.)

- [ ] **Step 7: Flip the foundry importers + delete the duplicate** (only on the happy path of Step 6). Re-point the three importers from `'./hash.js'` (or `'../hash.js'`) to `'@de-braighter/knowledge-contracts'`:
  - `src/generation/propose.ts`: `import { sha256Hex } from '@de-braighter/knowledge-contracts';`
  - `src/generation/generate.ts`: `import { hashModel } from '@de-braighter/knowledge-contracts';`
  - `src/generation/context-packs/index.ts`: `import { sha256Hex, canonicalJson } from '@de-braighter/knowledge-contracts';`
  Then delete `src/generation/hash.ts` (and any co-located `hash.spec.ts` — the canonical test now lives in the layer).

- [ ] **Step 8: Prove foundry is still green**

Run: `cd D:/development/projects/de-braighter/domains/foundry && npm run ci:local`
Expected: typecheck + coverage tests pass (foundry's `generation/*` now consumes the published hash; behaviour unchanged). If anything fails, the move is not behaviour-preserving — fix before committing (the hash output must be byte-identical, so the only failure modes are import paths or a transitive version conflict → fall back per Step 6).

- [ ] **Step 9: Commit both repos** (each on its own branch)

```bash
cd D:/development/projects/de-braighter/layers/knowledge
git add libs/knowledge-contracts
git commit -m "feat(knowledge-contracts): content-addressing hash (moved from foundry generation/hash.ts)"

cd D:/development/projects/de-braighter/domains/foundry
git add package.json src/generation
git commit -m "refactor(foundry): consume @de-braighter/knowledge-contracts content-hash (de-fork hash.ts)"
```

---

### Task 4: Kernel-Untouched Invariant — boundary-acid test

**Files:**

- Create: `layers/knowledge/libs/knowledge-contracts/src/boundary-acid.spec.ts`

**Interfaces:**

- Consumes: the layer source files (filesystem scan). Mirrors charter-runtime's `boundary-acid.spec.ts`.

- [ ] **Step 1: Write the boundary-acid test** (proves the layer reaches substrate only through the published package surface — the executable form of "everything rides the published plan-tree port; zero kernel change"):

```typescript
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const files = readdirSync(SRC, { recursive: true })
  .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'));

describe('Kernel-Untouched Invariant — import boundary (knowledge-contracts)', () => {
  it('imports substrate ONLY via the published @de-braighter package surface', () => {
    for (const f of files) {
      const text = readFileSync(join(SRC, f), 'utf8');
      // no relative reach into a sibling substrate repo, no deep dist path
      expect(text).not.toMatch(/from ['"]\.\.\/\.\.\/.*substrate/);
      const imports = [...text.matchAll(/from ['"](@de-braighter\/[^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(imp).toMatch(/^@de-braighter\/(substrate-contracts|substrate-runtime)(\/[a-z-]+)?$/);
      }
    }
  });

  it('the content-hash module imports nothing from @de-braighter (substrate-free)', () => {
    const text = readFileSync(join(SRC, 'content-hash.ts'), 'utf8');
    expect(text).not.toMatch(/@de-braighter\//);
  });
});
```

- [ ] **Step 2: Run it + the full gate**

Run: `cd layers/knowledge && pnpm run ci:local`
Expected: boundary-acid passes; full workspace green.

- [ ] **Step 3: Commit**

```bash
cd D:/development/projects/de-braighter/layers/knowledge
git add libs/knowledge-contracts/src/boundary-acid.spec.ts
git commit -m "test(knowledge-contracts): import-boundary acid (Kernel-Untouched Invariant)"
git push -u origin feat/s0-scaffold
```

---

### Task 5: Cluster registration + ADR

**Files (WORKBENCH repo, own branch):**

- Modify: `repos.yaml`
- Create: `projects/knowledge/project.yaml`

**Files (SPECS repo, own branch):**

- Create: `layers/specs/adr/adr-XXX-knowledge-layer-cluster.md`

- [ ] **Step 1: Branch the workbench + register the layer.**

```bash
cd D:/development/projects/de-braighter
git checkout -b chore/register-knowledge-layer main
```

In `repos.yaml`, under `repos: → layers:`, append after `foundation`:

```yaml
    - knowledge       # shared document/artifact layer on substrate (the knowledge twin); ADR-XXX
```

`projects/knowledge/project.yaml`:

```yaml
# knowledge — shared document/artifact-management cluster layer on the substrate.
# Status: bootstrapping — S0 (scaffold + content-hash extraction) landed; S1 (document
#         management), S2 (the twin), S3 (provenance) follow.
# Form: cluster LAYER (not kernel, not domain pack), zero kernel change (ADR-176, ADR-283
#       precedent). Consumed across domains via published @de-braighter/* packages.
# Design: docs/superpowers/specs/2026-06-28-knowledge-pack-design.md
# ADR: layers/specs/adr/adr-XXX-knowledge-layer-cluster.md

name: knowledge
domain: document-artifact-management
status: bootstrapping
repo: github.com/de-braighter/knowledge
local: layers/knowledge/

enabled:
  agents:
    suggested:
      - substrate-architect
      - substrate-coder-pro
      - designer
      - implementer
      - reviewer
      - charter-checker
      - qa-engineer
      - local-ci
      - prisma-pro
      - test-pro
  skills:
    suggested:
      - architecture-concierge
      - diff-refactor-engine
      - nx-tag-architecture-governance
      - public-api-stabilizer
      - md-quality-review
```

- [ ] **Step 2: Stage exactly the two intended files** (workbench carries unrelated untracked WIP — never `git add -A`):

```bash
git add repos.yaml projects/knowledge/project.yaml
git status --short
```

Expected: exactly `M repos.yaml` and `A projects/knowledge/project.yaml`.

```bash
git commit -m "chore(manifest): register knowledge layer in repos.yaml + project descriptor"
```

- [ ] **Step 3: Author the ADR** (specs repo, own branch). Use `/adr-scaffolder` to get the next free number; the ADR records the OQ4 boundary decision (Task 1 Step 3) and the Kernel-Untouched Invariant. Mirror `adr-283-charter-runtime-cluster-layer.md`.

```bash
cd D:/development/projects/de-braighter/layers/specs
git checkout -b adr-knowledge-layer-cluster main
```

The ADR (`status: proposed`) must contain:

- **Context** — document management keeps becoming a plan tree; the spec's reframe.
- **Decision** — cluster LAYER (D1), persistence = substrate/Postgres (D2), references as stored generators + derived graphs (D3), ContentPort not `importRef` (D4), pack-skin specialization (D5), declarative-only behaviour (D6), parametric tenancy (D7), **origin = foundry via extraction (D8) with the OQ4 boundary recorded verbatim** (MOVE-now = content-hash; MOVE-later = blueprint/compiler core for the §8 follow-on; STAYS = foundry queue/claim control plane).
- **ADR-176 inclusion test** — fails (a) [a composition of the four concerns, not a fifth] and (b) [kernel need not understand documents] → layer territory, not kernel.
- **Kernel-Untouched Invariant** — the layer touches no `layers/substrate` production file; proven by the boundary-acid test + the S0 zero-diff posture; the reference relation graduates to a typed kernel `PlanNodeId` relation only on demonstrated ≥2-pack need (§9, never speculative).
- **Consequences** — S1 document core is NEW (not extracted); the foundry architecture-knowledge pack-skin is the first *consumer*; the blueprint pack-skin + charter-runtime `instantiates` seam (§8) is a follow-on.

```bash
git add adr/adr-XXX-knowledge-layer-cluster.md docs/adr-index.md   # whatever adr-scaffolder updates
git commit -m "docs(adr): ADR-XXX knowledge layer as a cluster layer (zero kernel change; OQ4 boundary)"
```

---

### Task 6: PRs + verifier wave

**Files:** none (PR plumbing).

- [ ] **Step 1: Push branches + open PRs.** Four PRs (each `--body-file`; PS 5.1 mangles multi-line `--body`):
  1. `de-braighter/knowledge#1` (branch `feat/s0-scaffold`) — scaffold + content-hash + boundary-acid. **Publish `@de-braighter/knowledge-contracts` from this PR** (so foundry can resolve it) per the layer's publish flow once green.
  2. `de-braighter/foundry#N` (branch `feat/consume-knowledge-content-hash`) — consumer-flip (or the documented fallback debt note if Step 6 fell back).
  3. `de-braighter/workbench` (branch `chore/register-knowledge-layer`) — manifest + descriptor.
  4. `de-braighter/specs` (branch `adr-knowledge-layer-cluster`) — the ADR.

Each PR body carries the twin-ritual lines:

```text
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Verifier wave** (non-trivial, cross-repo, new layer → full wave). For the knowledge + foundry PRs run the wave in parallel, each agent with `isolation: "worktree"`: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer`. `charter-checker` certifies the Kernel-Untouched Invariant (zero substrate production diff) and the ADR-176 inclusion-test reasoning. `exercir-charter-checker` does NOT apply (no exercir change). The workbench manifest PR + specs ADR PR get the review floor (one `/code-review` + `spec-auditor` on the ADR). Post findings to each PR before merge (`post-findings`), then merge in dependency order: **knowledge#1 (publish first) → foundry#N → workbench → specs**.

- [ ] **Step 3: Twin ritual** after each merge: `npm run ritual:post-merge -- de-braighter/<repo>#<pr>`.

---

## Self-Review

**Spec coverage (S0 portion):** D1 cluster layer + registration → Tasks 2/5. D2 persistence-on-substrate posture (libs shape) → Task 2. D4 ContentPort/not-importRef → recorded in the ADR (Task 5); the interface itself is S1. D8/§7 origin = foundry via extraction → Tasks 1/3 (the real move = content-hash; the rest catalogued). §9 kernel untouched → Tasks 3/4 (boundary-acid) + ADR. OQ4 → Task 1 + ADR. OQ1/OQ2/OQ3 → explicitly deferred (Global Constraints). The knowledge-node lens, citation graph, pgvector, twin, provenance are S1–S3 by design — not S0.

**Placeholder scan:** no TBD/TODO; every code block is complete and runnable. `adr-XXX` is an intentional placeholder resolved by `/adr-scaffolder` (Task 5 Step 3). Version `^2.7.0`/`^2.8.0` are resolved live (Task 2 Step 2).

**Type consistency:** `canonicalJson`/`sha256Hex`/`hashModel`/`hashContextPack` defined in Task 3 Step 3, consumed in Task 3 Steps 1/7 and Task 4 Step 1; package names `@de-braighter/knowledge-{workspace,contracts,runtime}` consistent across all `package.json` + imports + the ADR + the descriptor.

## Risks / open questions surfaced (carry into S1)

- **The extraction is thinner than the spec's narrative.** Foundry has no document/citation store; its reusable core is blueprint/compiler/hash-shaped. The S1 document core is built NEW; foundry's "architecture-knowledge pack-skin" is the first *consumer*, not an extraction. (Flagged in the ADR + PR.)
- **Foundry's substrate pin (`substrate-contracts@^0.10.0`) is a consumer-flip hazard.** The content-hash move is engineered substrate-free to dodge it; if it still drags 2.7.0 in, S0 falls back to a tracked debt item rather than a foundry-wide substrate bump (Task 3 Step 6).
- **Package split (`contracts` + `runtime`) is asserted now but only exercised in S1** (runtime stays a smoke-only stub through S0). If S1 reveals the layer needs no NestJS runtime (pure-lib sufficient), collapse to one package — re-evaluate at the S1 pgvector task.
- **Two patent-sensitive runtimes** (context-navigation; stale propagation — spec §10) live in S2; keep design detail internal until attorney review.
