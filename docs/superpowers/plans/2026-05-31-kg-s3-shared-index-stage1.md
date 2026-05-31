# KG S3-shared index — Stage 1 (local, Docker + MinIO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the knowledge-graph index shareable across machines via an S3-compatible store — proven locally with MinIO + Docker — with a shared-base (specs+governance) + local-memory-overlay model.

**Architecture:** Add an S3 index store (`@aws-sdk/client-s3`, MinIO/Infomaniak-compatible) to the existing devloop knowledge-graph module. A memory-free `buildBaseIndex` + `kg:publish` writes the base to S3; the MCP server's load path becomes `loadServingIndex` (S3 → local cache → full local build) then merges the machine's local memory as an overlay. A Dockerfile + `docker-compose.kg.yml` (MinIO) run the publish loop locally.

**Tech Stack:** TypeScript ESM (`.js` imports, `moduleResolution: bundler`, `noUncheckedIndexedAccess`), `tsx`, vitest (tests in `test/knowledge-graph/`), `@aws-sdk/client-s3` (new dep), Docker + MinIO.

**Spec:** `docs/superpowers/specs/2026-05-31-kg-s3-shared-index-stage1-design.md`

**Where the work happens:** the `domains/devloop` repo (the read-side module is on `main`). Create a feature branch (e.g. `feat/kg-s3-shared-index`). All commits below are in that repo.

**Pre-existing module shape (do not re-create):** `src/knowledge-graph/` has `index.ts` (exports `buildIndexFrom`, `rebuildIndex`, `loadOrBuildIndex`, `contextFor`, `queryGraph`, `QueryArgs`, re-exports graph-model), `config.ts` (`resolveConfig` → `{clusterRoot, specsRoot, workbenchRoot, memoryDir, indexPath}`), `graph/build-graph.ts` (`buildGraph`, internal `deriveMentionEdges`), `graph/index-store.ts` (`writeIndex`, `readIndex`), `sources/{adr-reader,concept-reader,governance-reader,memory-reader}.ts`, `mcp/server.ts` (`makeTools(getGraph, rebuild)`, `main()`). `data/` is gitignored. Tests are nested under `test/knowledge-graph/`.

---

## File Structure

- `src/knowledge-graph/graph/s3-store.ts` (new) — `S3Config`, `resolveS3Config(env)`, `publishBase(graph, cfg)`, `fetchBase(cfg)`.
- `src/knowledge-graph/graph/build-graph.ts` (modify) — export `deriveMentionEdges`.
- `src/knowledge-graph/config.ts` (modify) — add `basePath` (cache for the shared base).
- `src/knowledge-graph/index.ts` (modify) — add `buildBaseIndex`, `mergeMemoryOverlay`, `loadServingIndex`; re-export the s3-store fns.
- `src/knowledge-graph/mcp/server.ts` (modify) — boot + `kg_rebuild` use `loadServingIndex` (async rebuild contract).
- `src/cli.ts` (modify) — add a `publish` command.
- `package.json` (modify) — add `@aws-sdk/client-s3` dep + `kg:publish` script.
- `Dockerfile` (new, repo root `domains/devloop/Dockerfile`) — the rebuild-and-publish job image.
- `docker-compose.kg.yml` (new, `domains/devloop/`) — MinIO + bucket-init + kg-publish.
- `src/knowledge-graph/README.md` (modify) — document publish/serve + the compose loop.
- Tests under `test/knowledge-graph/`: `s3-store.test.ts`, `overlay.test.ts`, `serving.test.ts`.

---

## Task 1: S3 store + config resolver

**Files:**
- Modify: `domains/devloop/package.json`
- Create: `domains/devloop/src/knowledge-graph/graph/s3-store.ts`
- Test: `domains/devloop/test/knowledge-graph/s3-store.test.ts`

- [ ] **Step 1: Add the dependency**

Run (in `domains/devloop`): `npm install @aws-sdk/client-s3@^3.0.0`
Expected: added to `dependencies`, `npm install` exits 0.

- [ ] **Step 2: Write the failing test**

Create `test/knowledge-graph/s3-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveS3Config, publishBase, fetchBase } from '../../src/knowledge-graph/graph/s3-store.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

describe('resolveS3Config', () => {
  it('returns null when required env is missing', () => {
    expect(resolveS3Config({})).toBeNull();
    expect(resolveS3Config({ KG_S3_ENDPOINT: 'http://x', KG_S3_BUCKET: 'b' })).toBeNull(); // no creds
  });
  it('builds config with defaults for key + region', () => {
    const c = resolveS3Config({
      KG_S3_ENDPOINT: 'http://localhost:9100', KG_S3_BUCKET: 'kg-index',
      KG_S3_ACCESS_KEY_ID: 'minioadmin', KG_S3_SECRET_ACCESS_KEY: 'minioadmin',
    });
    expect(c).toEqual({
      endpoint: 'http://localhost:9100', bucket: 'kg-index', key: 'kg-index.json',
      accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin', region: 'us-east-1',
    });
  });
});

// Gated round-trip — needs a running MinIO (docker-compose.kg.yml up minio createbuckets)
// and KG_S3_TEST=1 + KG_S3_* env. Skipped in plain CI so the suite stays green.
const RT = process.env.KG_S3_TEST === '1';
describe.skipIf(!RT)('S3 round-trip (gated)', () => {
  it('publishBase then fetchBase returns an identical graph', async () => {
    const cfg = resolveS3Config(process.env)!;
    const g: KgGraph = { nodes: { 'adr-200': { id: 'adr-200', kind: 'adr', title: 't', status: 'ratified', summary: 's', path: 'p', tags: [] } }, edges: [], warnings: [] };
    await publishBase(g, cfg);
    const back = await fetchBase(cfg);
    expect(back).toEqual(g);
  });
  it('fetchBase returns null on a missing key', async () => {
    const cfg = { ...resolveS3Config(process.env)!, key: 'does-not-exist.json' };
    expect(await fetchBase(cfg)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/knowledge-graph/s3-store.test.ts`
Expected: FAIL — module not found. (The gated `describe.skipIf(!RT)` block is skipped.)

- [ ] **Step 4: Implement the S3 store**

Create `src/knowledge-graph/graph/s3-store.ts`:
```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { KgGraph } from '../graph-model.js';

export interface S3Config {
  endpoint: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** Resolve S3 config from env; null when unconfigured (the store is then inactive). */
export function resolveS3Config(env: Record<string, string | undefined>): S3Config | null {
  const endpoint = env['KG_S3_ENDPOINT'];
  const bucket = env['KG_S3_BUCKET'];
  const accessKeyId = env['KG_S3_ACCESS_KEY_ID'];
  const secretAccessKey = env['KG_S3_SECRET_ACCESS_KEY'];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    key: env['KG_S3_KEY'] ?? 'kg-index.json',
    accessKeyId,
    secretAccessKey,
    region: env['KG_S3_REGION'] ?? 'us-east-1',
  };
}

function client(cfg: S3Config): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true, // required by MinIO; harmless on Infomaniak
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

export async function publishBase(graph: KgGraph, cfg: S3Config): Promise<void> {
  await client(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: cfg.key,
      Body: JSON.stringify(graph),
      ContentType: 'application/json',
    }),
  );
}

/** Fetch the published base; null on any miss/unreachable (caller falls back). */
export async function fetchBase(cfg: S3Config): Promise<KgGraph | null> {
  try {
    const res = await client(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: cfg.key }));
    if (!res.Body) return null;
    const body = await res.Body.transformToString();
    return JSON.parse(body) as KgGraph;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/knowledge-graph/s3-store.test.ts`
Expected: PASS — 2 resolver tests pass; the gated round-trip block is SKIPPED (no `KG_S3_TEST`). Then `npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/knowledge-graph/graph/s3-store.ts test/knowledge-graph/s3-store.test.ts
git commit -m "feat(kg): S3 index store (publish/fetch) + config resolver"
```

---

## Task 2: base build + memory overlay + serving precedence

**Files:**
- Modify: `domains/devloop/src/knowledge-graph/graph/build-graph.ts` (export `deriveMentionEdges`)
- Modify: `domains/devloop/src/knowledge-graph/config.ts` (add `basePath`)
- Modify: `domains/devloop/src/knowledge-graph/index.ts` (add the three functions)
- Test: `domains/devloop/test/knowledge-graph/overlay.test.ts`, `domains/devloop/test/knowledge-graph/serving.test.ts`

- [ ] **Step 1: Export `deriveMentionEdges`**

In `src/knowledge-graph/graph/build-graph.ts`, change the `deriveMentionEdges` declaration from `function deriveMentionEdges(` to `export function deriveMentionEdges(`. (No behavior change; it derives whole-word `mentions` edges among the given nodes.)

- [ ] **Step 2: Add `basePath` to config**

In `src/knowledge-graph/config.ts`, add to the `KgConfig` interface: `basePath: string;` and to the returned object in `resolveConfig`: `basePath: join(packRoot, 'data', 'kg-base.json'),` (next to the existing `indexPath`). `join` is already imported.

- [ ] **Step 3: Write the failing overlay test**

Create `test/knowledge-graph/overlay.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeMemoryOverlay } from '../../src/knowledge-graph/index.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

const base: KgGraph = {
  nodes: { 'adr-200': { id: 'adr-200', kind: 'adr', title: 'Persist effects', status: 'ratified', summary: 'persist', path: 'p', tags: ['substrate'] } },
  edges: [],
  warnings: [],
};

function fixtureMemoryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kg-mem-'));
  writeFileSync(join(dir, 'kernel-note-2026-05-30.md'), [
    '---', 'name: kernel-note-2026-05-30', 'description: "Read before kernel work"', 'metadata:', '  node_type: memory', '  type: project', '---', '',
    'Builds on adr-200 and links to [[some-other-note]].',
  ].join('\n'));
  return dir;
}

describe('mergeMemoryOverlay', () => {
  it('adds memory nodes, their links-to edges, and re-derived mentions to base', () => {
    const g = mergeMemoryOverlay(base, fixtureMemoryDir());
    expect(g.nodes['kernel-note-2026-05-30']).toBeTruthy(); // memory node added
    expect(g.nodes['adr-200']).toBeTruthy(); // base preserved
    expect(g.edges).toContainEqual({ from: 'kernel-note-2026-05-30', to: 'some-other-note', type: 'links-to' });
    // re-derived mention from the memory node to a base node (summary mentions adr-200)
    expect(g.edges).toContainEqual({ from: 'kernel-note-2026-05-30', to: 'adr-200', type: 'mentions' });
  });

  it('returns a base copy (no mutation) when memory dir is undefined', () => {
    const g = mergeMemoryOverlay(base, undefined);
    expect(Object.keys(g.nodes)).toEqual(['adr-200']);
    expect(g).not.toBe(base);
  });
});
```

- [ ] **Step 4: Write the failing serving-precedence test**

Create `test/knowledge-graph/serving.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServingIndex } from '../../src/knowledge-graph/index.js';
import { writeIndex } from '../../src/knowledge-graph/graph/index-store.js';
import { resolveConfig } from '../../src/knowledge-graph/config.js';
import type { KgGraph } from '../../src/knowledge-graph/graph-model.js';

describe('loadServingIndex precedence', () => {
  it('serves the local cache when S3 is unconfigured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kg-serve-'));
    const basePath = join(dir, 'kg-base.json');
    const cached: KgGraph = { nodes: { 'adr-176': { id: 'adr-176', kind: 'adr', title: 'Minimality', status: 'ratified', summary: 's', path: 'p', tags: [] } }, edges: [], warnings: [] };
    writeIndex(cached, basePath);
    const cfg = { ...resolveConfig(), basePath, memoryDir: undefined };
    const g = await loadServingIndex({ env: {}, config: cfg }); // env: {} -> S3 unconfigured
    expect(g.nodes['adr-176']).toBeTruthy(); // came from cache, not a rebuild
  });
});
```

- [ ] **Step 5: Run both to verify they fail**

Run: `npx vitest run test/knowledge-graph/overlay.test.ts test/knowledge-graph/serving.test.ts`
Expected: FAIL — `mergeMemoryOverlay` / `loadServingIndex` not exported.

- [ ] **Step 6: Implement the three functions**

In `src/knowledge-graph/index.ts`, add these imports near the top (alongside existing imports):
```ts
import { readAdrs } from './sources/adr-reader.js';
import { readConcepts } from './sources/concept-reader.js';
import { readGovernance } from './sources/governance-reader.js';
import { readMemory } from './sources/memory-reader.js';
import { buildGraph, deriveMentionEdges } from './graph/build-graph.js';
import { writeIndex, readIndex } from './graph/index-store.js';
import { resolveS3Config, publishBase, fetchBase, type S3Config } from './graph/s3-store.js';
```
(Some of these may already be imported — do not duplicate; merge into the existing import lines.)

Re-export the S3 store for the CLI:
```ts
export { resolveS3Config, publishBase, fetchBase } from './graph/s3-store.js';
export type { S3Config } from './graph/s3-store.js';
```

Add the base build (specs + governance only — no memory):
```ts
/** The memory-free shared base: specs + governance. This is what gets published to S3. */
export function buildBaseIndex(): KgGraph {
  const cfg = resolveConfig();
  return buildGraph([
    readAdrs(cfg.specsRoot, cfg.clusterRoot),
    readConcepts(cfg.specsRoot, cfg.clusterRoot),
    readGovernance(cfg.workbenchRoot, cfg.clusterRoot),
  ]);
}
```

Add the overlay merge (re-derives mentions for memory-origin nodes against the merged set):
```ts
/** Merge this machine's local memory onto a shared base. Memory nodes + their
 *  links-to edges are added; `mentions` FROM memory nodes are re-derived against
 *  the merged node set (so a memory note referencing adr-200 links to it). */
export function mergeMemoryOverlay(base: KgGraph, memoryDir: string | undefined): KgGraph {
  const mem = readMemory(memoryDir);
  const nodes: KgGraph['nodes'] = { ...base.nodes };
  if (mem.nodes.length === 0) {
    return { nodes, edges: [...base.edges], warnings: [...base.warnings, ...mem.warnings] };
  }
  for (const n of mem.nodes) nodes[n.id] = n;
  const memIds = new Set(mem.nodes.map((n) => n.id));
  const mentions = deriveMentionEdges(nodes).filter((e) => memIds.has(e.from));
  return { nodes, edges: [...base.edges, ...mem.edges, ...mentions], warnings: [...base.warnings, ...mem.warnings] };
}
```

Add the serving load path (injectable for testing; defaults to real config/env):
```ts
export interface ServingOpts {
  env?: Record<string, string | undefined>;
  config?: ReturnType<typeof resolveConfig>;
}

/** Serve precedence: S3 base -> local cache -> full local build; then overlay memory.
 *  Never throws on the serving path. */
export async function loadServingIndex(opts: ServingOpts = {}): Promise<KgGraph> {
  const cfg = opts.config ?? resolveConfig();
  const env = opts.env ?? process.env;
  const s3: S3Config | null = resolveS3Config(env);
  let base: KgGraph | null = null;
  if (s3) {
    base = await fetchBase(s3);
    if (base) writeIndex(base, cfg.basePath); // refresh local cache
  }
  if (!base) {
    try {
      base = readIndex(cfg.basePath);
    } catch {
      base = null; // no cache
    }
  }
  if (!base) base = buildBaseIndex();
  return mergeMemoryOverlay(base, cfg.memoryDir);
}
```

- [ ] **Step 7: Run both to verify they pass**

Run: `npx vitest run test/knowledge-graph/overlay.test.ts test/knowledge-graph/serving.test.ts`
Expected: PASS (3 tests). Then `npm run typecheck` clean and `npm test` full suite green (prior pass count + the new tests; the 2 pre-existing skips + the gated S3 test remain skipped).

- [ ] **Step 8: Commit**

```bash
git add src/knowledge-graph/graph/build-graph.ts src/knowledge-graph/config.ts src/knowledge-graph/index.ts test/knowledge-graph/overlay.test.ts test/knowledge-graph/serving.test.ts
git commit -m "feat(kg): base build + local-memory overlay + S3->cache->build serving precedence"
```

---

## Task 3: wire the MCP server + the `publish` CLI

**Files:**
- Modify: `domains/devloop/src/knowledge-graph/mcp/server.ts`
- Modify: `domains/devloop/test/knowledge-graph/mcp-tools.test.ts`
- Modify: `domains/devloop/src/cli.ts`
- Modify: `domains/devloop/package.json`

- [ ] **Step 1: Update the MCP-tools test for the async rebuild contract**

In `test/knowledge-graph/mcp-tools.test.ts`, the `tools()` helper currently injects a sync rebuild `() => ({ graph, indexPath: '(stub)' })`. Change it to async:
```ts
  return makeTools(() => graph, async () => ({ graph, indexPath: '(stub)' }));
```
(The `kg_rebuild` test assertion `/nodes=\d+/` stays valid.)

- [ ] **Step 2: Run to verify the test still drives the contract**

Run: `npx vitest run test/knowledge-graph/mcp-tools.test.ts`
Expected: FAIL or type-mismatch until `makeTools`'s `rebuild` param is typed `() => Promise<{ graph: KgGraph; indexPath: string }>` (next step). (If it still passes because the old type was loose, proceed — Step 3 makes the contract explicit and Step 5 re-runs.)

- [ ] **Step 3: Make `makeTools.rebuild` async + boot/reload via `loadServingIndex`**

In `src/knowledge-graph/mcp/server.ts`:

(a) Update imports: replace `loadOrBuildIndex` usage with `loadServingIndex` and `resolveConfig`:
```ts
import { contextFor, queryGraph, loadServingIndex } from '../index.js';
import { resolveConfig } from '../config.js';
```
(remove the now-unused `rebuildIndex`/`loadOrBuildIndex` import if present).

(b) Change `makeTools`'s `rebuild` parameter type to async and await it in `kg_rebuild`:
```ts
export function makeTools(
  getGraph: () => KgGraph,
  rebuild: () => Promise<{ graph: KgGraph; indexPath: string }>,
) {
  return {
    async kg_context(args: { task: string; budget?: number }): Promise<ToolResult> {
      const text = contextFor(args.task, getGraph(), args.budget ?? 4000);
      return { content: [{ type: 'text', text }] };
    },
    async kg_query(args: { from?: string; edge?: string; hops?: number; text?: string; status?: string }): Promise<ToolResult> {
      const reached = queryGraph(getGraph(), args);
      const lines = reached
        .sort((a, b) => a.hops - b.hops)
        .map((r) => {
          const last = r.viaPath.at(-1);
          return `${r.id} (hops=${r.hops})${last ? ' via ' + last : ''}`;
        });
      return { content: [{ type: 'text', text: lines.join('\n') || '(no matches)' }] };
    },
    async kg_rebuild(_args: Record<string, never>): Promise<ToolResult> {
      const { graph, indexPath } = await rebuild();
      const text = `rebuilt: nodes=${Object.keys(graph.nodes).length} edges=${graph.edges.length} warnings=${graph.warnings.length} -> ${indexPath}`;
      return { content: [{ type: 'text', text }] };
    },
  };
}
```
(`rebuild` is now required — no default — because there is no sensible sync default; `main` supplies it.)

(c) In `main()`, boot via `loadServingIndex` and supply an async `rebuild` that reassigns the served graph:
```ts
export async function main(): Promise<void> {
  let graph = await loadServingIndex();
  const tools = makeTools(
    () => graph,
    async () => {
      graph = await loadServingIndex();
      return { graph, indexPath: resolveConfig().basePath };
    },
  );
  const server = new McpServer({ name: 'devloop-knowledge-graph', version: '0.1.0' });

  server.registerTool('kg_context', { description: 'Warm-start context pack: given a free-text task, return the relevant rules, decisions, and lessons from the cluster knowledge graph.', inputSchema: { task: z.string(), budget: z.number().optional() } }, async (a) => tools.kg_context(a));
  server.registerTool('kg_query', { description: 'Traverse the knowledge graph: from a node id and/or text, optionally filtered by edge type or status.', inputSchema: { from: z.string().optional(), edge: z.string().optional(), hops: z.number().optional(), text: z.string().optional(), status: z.string().optional() } }, async (a) => tools.kg_query(a));
  server.registerTool('kg_rebuild', { description: 'Re-pull the shared base (S3 -> cache -> build) and re-merge local memory.', inputSchema: {} }, async () => tools.kg_rebuild({}));

  await server.connect(new StdioServerTransport());
}
```
(Keep the existing Windows-correct entry guard `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)` at the bottom unchanged.)

- [ ] **Step 4: Add the `publish` CLI command + script**

In `src/cli.ts`, add a `publish` case to the command dispatch (match the file's existing switch/if style). It rebuilds the base and uploads to S3:
```ts
// inside the command dispatch
if (cmd === 'publish') {
  const { buildBaseIndex, resolveS3Config, publishBase } = await import('./knowledge-graph/index.js');
  const { resolveConfig } = await import('./knowledge-graph/config.js');
  const { writeIndex } = await import('./knowledge-graph/graph/index-store.js');
  const s3 = resolveS3Config(process.env);
  if (!s3) {
    console.error('kg publish: KG_S3_* env not configured (need KG_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY).');
    process.exit(1);
  }
  const base = buildBaseIndex();
  writeIndex(base, resolveConfig().basePath); // warm the publisher's own cache
  await publishBase(base, s3);
  console.log(`kg publish: nodes=${Object.keys(base.nodes).length} edges=${base.edges.length} -> ${s3.bucket}/${s3.key}`);
  return;
}
```
(Adapt the destructuring to `cli.ts`'s actual import style — if it uses top-level imports rather than dynamic `import()`, add top-level imports instead. Read the file first and match its pattern.)

In `package.json` scripts, add: `"kg:publish": "tsx src/cli.ts publish",`

- [ ] **Step 5: Run the tests + typecheck**

Run: `npx vitest run test/knowledge-graph/mcp-tools.test.ts && npm run typecheck`
Expected: mcp-tools 3/3 PASS; typecheck clean (validates the `registerTool` calls + the async rebuild contract against the installed SDK). Then `npm test` full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/knowledge-graph/mcp/server.ts test/knowledge-graph/mcp-tools.test.ts src/cli.ts package.json
git commit -m "feat(kg): MCP server serves via loadServingIndex; add kg:publish CLI"
```

---

## Task 4: Dockerfile + local MinIO compose loop

**Files:**
- Create: `domains/devloop/Dockerfile`
- Create: `domains/devloop/docker-compose.kg.yml`
- Create: `domains/devloop/.dockerignore`
- Modify: `domains/devloop/src/knowledge-graph/README.md`

No unit tests (infra); verified by a manual smoke (Step 5).

- [ ] **Step 1: Write the `.dockerignore`**

Create `domains/devloop/.dockerignore`:
```
node_modules
dist
data
coverage
.git
```

- [ ] **Step 2: Write the Dockerfile**

Create `domains/devloop/Dockerfile`:
```dockerfile
# Rebuild-and-publish job for the KG shared base. Same image used by the Stage-2
# K8s CronJob. Corpus is provided at runtime: bind-mounted locally (Stage 1),
# git-cloned in K8s (Stage 2).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# Default: publish the base. Corpus roots are resolved relative to the package
# location; mount the cluster so ../../layers/specs + ../.. (workbench) resolve.
ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
CMD ["publish"]
```
Note: `resolveConfig` derives `clusterRoot` as `../../` from the package dir, then reads `layers/specs` + the workbench governance files. So the container must see the cluster at the path that makes `/app/../../layers/specs` resolve — handled by the compose mount in Step 3 (mount the cluster root at `/`, app at `/app` via `/<cluster>/domains/devloop`). Simplest: mount the host cluster root read-only and run with the working dir at `<mount>/domains/devloop`. The compose file encodes this.

- [ ] **Step 3: Write the compose file**

Create `domains/devloop/docker-compose.kg.yml`:
```yaml
# Local KG S3-share loop: MinIO + bucket-init + the publish job.
#   docker compose -f docker-compose.kg.yml up --build
# Then point a local MCP server at the same KG_S3_* to fetch the published base.
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9101"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9100:9000"
      - "9101:9101"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 20

  createbuckets:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/kg-index
      "

  kg-publish:
    build:
      context: .
      dockerfile: Dockerfile
    depends_on:
      createbuckets:
        condition: service_completed_successfully
    working_dir: /cluster/domains/devloop
    volumes:
      # Mount the whole cluster read-only so the corpus (layers/specs + workbench
      # governance) resolves from the package's ../../ clusterRoot.
      - ../../:/cluster:ro
    environment:
      KG_S3_ENDPOINT: http://minio:9000
      KG_S3_BUCKET: kg-index
      KG_S3_KEY: kg-index.json
      KG_S3_ACCESS_KEY_ID: minioadmin
      KG_S3_SECRET_ACCESS_KEY: minioadmin
      KG_S3_REGION: us-east-1
    command: ["publish"]
```
Note: `working_dir` + the read-only cluster mount make `resolveConfig`'s `../../` land on `/cluster`, so `layers/specs` + workbench files resolve. The image's own `/app/node_modules` (from `npm ci`) is used for deps — the mount is `:ro` and only supplies source/corpus, not node_modules. Because `working_dir` is the mounted source, ensure tsx resolves deps from `/app`: run via the image's installed tsx by setting `NODE_PATH=/app/node_modules` if resolution fails — verify in Step 5 and add `NODE_PATH` to `environment` only if needed.

- [ ] **Step 4: Update the README**

In `src/knowledge-graph/README.md`, add a section:
```markdown
## Shared index via S3 (Stage 1)
- Publish the base (specs+governance, memory-free) to S3/MinIO: `KG_S3_* npm run kg:publish`.
- The MCP server serves with precedence S3 -> local cache (`data/kg-base.json`) -> local build, then merges your local memory overlay.
- Local loop: `docker compose -f docker-compose.kg.yml up --build` (MinIO on :9100, console :9101) publishes the base into MinIO.
- Config: `KG_S3_ENDPOINT`, `KG_S3_BUCKET`, `KG_S3_KEY`, `KG_S3_ACCESS_KEY_ID`, `KG_S3_SECRET_ACCESS_KEY`, `KG_S3_REGION`. Unset -> S3 inactive, local-only.
```

- [ ] **Step 5: Manual smoke (not CI)**

Run (in `domains/devloop`):
```bash
docker compose -f docker-compose.kg.yml up --build
```
Expected: MinIO starts, `createbuckets` creates `kg-index`, `kg-publish` prints `kg publish: nodes=NNN edges=MMM -> kg-index/kg-index.json` (NNN in the hundreds — but NOTE: a containerized publish without the memory dir builds the base = specs+governance only, so the node count is ~ADRs+concepts+policies, *fewer* than the 404 local figure that includes 32 memories — that's expected and correct, the base is memory-free).
Then verify the object + a fetch round-trips against the running MinIO:
```bash
KG_S3_TEST=1 KG_S3_ENDPOINT=http://localhost:9100 KG_S3_BUCKET=kg-index \
  KG_S3_ACCESS_KEY_ID=minioadmin KG_S3_SECRET_ACCESS_KEY=minioadmin \
  npx vitest run test/knowledge-graph/s3-store.test.ts
```
Expected: the gated round-trip block now RUNS and passes. If the `kg-publish` container errors on dep resolution, add `NODE_PATH: /app/node_modules` to its `environment` and re-run.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.kg.yml .dockerignore src/knowledge-graph/README.md
git commit -m "feat(kg): Dockerfile + MinIO compose loop for the S3-shared base"
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/kg-s3-shared-index
gh pr create --base main --title "feat(kg): S3-shared index — Stage 1 (local, Docker + MinIO)" --body-file - <<'EOF'
Implements docs/superpowers/specs/2026-05-31-kg-s3-shared-index-stage1-design.md (workbench#47).

Shared base (specs+governance, memory-free) publishes to an S3-compatible store; the MCP server serves with precedence S3 -> local cache -> local build, then merges the machine's local memory overlay. Proven locally with MinIO + Docker. @aws-sdk/client-s3, endpoint-agnostic (Stage 2 swaps env for Infomaniak). No kernel change (ADR-176).

Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
EOF
```
Then run the verifier wave + the Sonar babysit per policy before merge.

---

## Self-Review

**Spec coverage** (against `2026-05-31-kg-s3-shared-index-stage1-design.md`):
- §2 D1/D2 shared-base + local-memory overlay → `buildBaseIndex` (Task 2) + `mergeMemoryOverlay` (Task 2). ✓
- §2 D3 precedence S3→cache→build, fetch-on-boot → `loadServingIndex` (Task 2) + server boot (Task 3). ✓
- §2 D4 manual `kg:publish` → CLI command + script (Task 3). ✓
- §2 D5 `@aws-sdk/client-s3` + `forcePathStyle` → `s3-store.ts` (Task 1). ✓
- §2 D6 bind-mount corpus → compose `volumes` (Task 4). ✓
- §2 D7 S3 inactive when unconfigured → `resolveS3Config` returns null + precedence fallthrough (Tasks 1, 2). ✓
- §3 units (`s3-store`, `buildBaseIndex`, `mergeMemoryOverlay`, `loadServingIndex`) → Tasks 1–2. ✓
- §4 config env table → `resolveS3Config` (Task 1). ✓
- §6 MinIO compose loop → Task 4. ✓
- §7 testing tiers (gated round-trip, hermetic overlay, fallback precedence) → Tasks 1, 2. ✓
- §8 governance (no kernel; cache-not-source) → preserved (local-build fallback always present). ✓

**Placeholder scan:** complete code in every code step. Two steps say "match the file's actual import style" (cli.ts dispatch, server imports) — these are *adaptation instructions with concrete fallbacks shown*, not placeholders. The `NODE_PATH` note is a conditional verified-in-smoke fix, not a TODO.

**Type consistency:** `KgGraph`/`KgNode`/`KgEdge` reused from graph-model; `S3Config` defined in Task 1, consumed in Tasks 2–3; `resolveS3Config`/`publishBase`/`fetchBase`/`buildBaseIndex`/`mergeMemoryOverlay`/`loadServingIndex`/`ServingOpts` names consistent across definition (Tasks 1–2) and use (Tasks 3–4). `makeTools` rebuild contract change (sync→async) is applied in both the impl (Task 3 Step 3) and its test (Task 3 Step 1).
