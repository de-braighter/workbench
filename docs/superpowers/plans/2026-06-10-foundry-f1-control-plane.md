# Foundry F1 — Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `domains/foundry` — a new standalone repo containing the Foundry claim-MCP server: event-sourced store (devloop-compatible envelopes), atomic cross-process claims at issue grain with TTL/stale-reclaim, work queue, founder gates, and session-prompt generation.

**Architecture:** Event-sourced: an append-only JSONL of `DomainEventEnvelope`s (same schema devloop uses, so foundry exhaust is twin-ingestible) + a pure `fold()` to derived state. ALL mutations funnel through a cross-process file lock (`withStoreLock`, atomic `mkdirSync`) because each Claude Code session spawns its OWN stdio MCP server process — in-process serialization gives zero cross-session atomicity. The MCP layer is a thin guard over pure ops functions (mirrors devloop's KG server: testable `makeTools(deps)` + side-effectful `main()`).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsx, vitest 2 + v8 coverage, zod 3, `@modelcontextprotocol/sdk` ^1.29.0, `@de-braighter/substrate-contracts` ^0.10.0 (envelope schema only — same pin as devloop). No NestJS, no Postgres, no Prisma (ADR-176 minimality: arbitration + queue + gates, nothing else).

**Spec:** `docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md` (§4 control plane, §7 failure stances, §8 testing).

**Conventions copied from `domains/devloop` (the sibling reference):** ESM imports with explicit `.js` extensions; zod-validate on write AND read; `pathToFileURL` guard for the MCP entry (Windows); vitest excludes `**/.claude/**` (agent worktrees); `.npmrc` GitHub-Packages scope registry (no secret).

---

## File structure (lock-in)

```text
domains/foundry/
├── package.json, tsconfig.json, vitest.config.ts, .npmrc, .gitignore, README.md
├── src/
│   ├── scope.ts          # PACK_ID, tenant id, uuidv5, aggregate-id helpers
│   ├── events.ts         # 8 event types: payload schemas + envelope constructors
│   ├── log.ts            # append-only JSONL (append / readEnvelopes)
│   ├── store-lock.ts     # withStoreLock — cross-process mutex (atomic mkdir + stale takeover)
│   ├── state.ts          # fold(events) → DerivedState; claim TTL; scopesDisjoint
│   ├── ops.ts            # queuePush, claim, heartbeat, release, handoff, gates, nextItems, sessionPrompts
│   ├── prompts.ts        # renderSessionPrompt (the hybrid-spawn template)
│   ├── status.ts         # statusText board readout
│   └── mcp/
│       ├── tools.ts      # makeTools(deps) — pure, covered
│       └── server.ts     # main() boot — registerTool ×10, stdio (coverage-excluded)
└── test/                 # one test file per module + e2e flow
```

Every module has one responsibility; `ops.ts` is the only file that composes lock + log + state.

---

### Task 1: Repo bootstrap + GitHub repo

**Files:**
- Create: `domains/foundry/package.json`
- Create: `domains/foundry/tsconfig.json`
- Create: `domains/foundry/vitest.config.ts`
- Create: `domains/foundry/.npmrc`
- Create: `domains/foundry/.gitignore`
- Create: `domains/foundry/README.md`

- [ ] **Step 1: Create the directory and files**

`domains/foundry/package.json`:

```json
{
  "name": "@de-braighter/foundry",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "The Foundry control plane — claim-MCP server for the multi-product machine: event-sourced queue, atomic cross-session claims, founder gates, session prompts. Arbitration + queue + gates, nothing else.",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "mcp": "tsx src/mcp/server.ts",
    "ci:local": "npm run typecheck && npm run test:coverage"
  },
  "dependencies": {
    "@de-braighter/substrate-contracts": "^0.10.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^2.1.9",
    "tsx": "^4.7.0",
    "typescript": "^5.4.5",
    "vitest": "^2.1.0"
  }
}
```

`domains/foundry/tsconfig.json` (identical to devloop's):

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

`domains/foundry/vitest.config.ts`:

```typescript
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude sibling agent worktrees from discovery (same rationale as devloop#29:
    // they hold full copies of this suite on other branches).
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // server.ts is the side-effectful stdio boot (registerTool + connect); the
      // pure handlers live in tools.ts and ARE covered.
      exclude: ['src/mcp/server.ts'],
    },
  },
});
```

`domains/foundry/.npmrc`:

```ini
# @de-braighter scope resolves from GitHub Packages. The auth token is inherited
# from the user-level ~/.npmrc (//npm.pkg.github.com/:_authToken=...), so this
# file carries no secret and is safe to commit.
@de-braighter:registry=https://npm.pkg.github.com
always-auth=true
```

`domains/foundry/.gitignore`:

```gitignore
node_modules/
dist/
coverage/
data/
*.tsbuildinfo
# agent reviewer scratch worktrees (same rationale as devloop#29)
.claude/worktrees/
.env
.env.*
```

`domains/foundry/README.md`:

```markdown
# foundry — the multi-product machine's control plane

Claim-MCP server: event-sourced work queue, atomic cross-session claims at issue
grain (TTL + stale-reclaim), founder gates as records, ready-to-paste session
prompts (hybrid spawn). Arbitration + queue + gates — nothing else; intelligence
lives in the calling skills.

Spec: `workbench:docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md`

- `npm run mcp` — start the stdio MCP server (registered in the workbench `.mcp.json`)
- `npm run ci:local` — typecheck + tests + coverage
- Store: `data/events.jsonl` — append-only devloop-compatible `DomainEventEnvelope`s.
  Atomicity: every mutation runs inside `withStoreLock` (atomic `mkdir`) because each
  Claude Code session spawns its own stdio server process.
```

- [ ] **Step 2: Init git, install, verify typecheck runs**

```bash
cd domains/foundry
git init -b main
npm install
npm run typecheck
```

Expected: install succeeds (contracts package resolves from GitHub Packages via user-level `~/.npmrc` token); typecheck passes trivially (no src yet — if tsc errors on empty include, create `src/` in Task 2; that is fine).

- [ ] **Step 3: Initial commit on main, create GitHub repo, push, branch**

`git add -A` is correct HERE (fresh repo, not the workbench):

```bash
cd domains/foundry
git add -A
git commit -m "chore: bootstrap foundry control plane (F1 scaffold)"
gh repo create de-braighter/foundry --private --source . --push --description "Foundry control plane — claim-MCP server for the multi-product machine"
git checkout -b feat/f1-control-plane
```

Expected: repo exists at github.com/de-braighter/foundry, main pushed, now on `feat/f1-control-plane`. All subsequent tasks commit to this branch.

---

### Task 2: `scope.ts` — pack identity + deterministic ids

**Files:**
- Create: `domains/foundry/src/scope.ts`
- Test: `domains/foundry/test/scope.test.ts`

- [ ] **Step 1: Write the failing test**

`test/scope.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  FOUNDRY_TENANT_PACK_ID, PACK_ID,
  gateAggregateId, itemAggregateId, productAggregateId, uuidv5,
} from '../src/scope.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('scope', () => {
  it('exposes pack identity', () => {
    expect(PACK_ID).toBe('foundry');
    expect(FOUNDRY_TENANT_PACK_ID).toMatch(UUID_RE);
  });
  it('uuidv5 is deterministic and RFC-4122 v5-shaped', () => {
    expect(uuidv5('a')).toBe(uuidv5('a'));
    expect(uuidv5('a')).not.toBe(uuidv5('b'));
    expect(uuidv5('a')).toMatch(UUID_RE);
  });
  it('aggregate ids are namespaced per type (no cross-type collisions)', () => {
    expect(productAggregateId('x')).not.toBe(itemAggregateId('x'));
    expect(itemAggregateId('x')).not.toBe(gateAggregateId('x'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/scope.test.ts`
Expected: FAIL — cannot find module `../src/scope.js`.

- [ ] **Step 3: Implement**

`src/scope.ts` (the uuidv5 implementation is devloop's, proven):

```typescript
// Single-tenant scope + deterministic ids. The foundry has one tenant (the
// founder's machine), so the kernel envelope's required UUIDs are minted
// deterministically rather than resolved from a tenant registry.
import { createHash } from 'node:crypto';

export const PACK_ID = 'foundry';

/** Fixed scope for the single foundry tenant (valid v5-variant UUID). */
export const FOUNDRY_TENANT_PACK_ID = 'f0d40000-0000-5000-8000-0000000000f1';

/** Namespace for deriving aggregate ids from domain identity. */
const FOUNDRY_NAMESPACE = 'f0d40000-0000-5000-8000-000000000000';

/** RFC 4122 v5 UUID (SHA-1, name-based) — stable id from a string key. */
export function uuidv5(name: string, namespace: string = FOUNDRY_NAMESPACE): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1').update(nsBytes).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const productAggregateId = (productKey: string): string => uuidv5(`product:${productKey}`);
export const itemAggregateId = (itemId: string): string => uuidv5(`item:${itemId}`);
export const gateAggregateId = (gateId: string): string => uuidv5(`gate:${gateId}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/scope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/scope.ts test/scope.test.ts
git commit -m "feat: pack identity + deterministic aggregate ids"
```

---

### Task 3: `events.ts` — payload schemas + envelope constructors

**Files:**
- Create: `domains/foundry/src/events.ts`
- Test: `domains/foundry/test/events.test.ts`

- [ ] **Step 1: Write the failing test**

`test/events.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  EVENT, claimAcquired, claimHandedOff, claimHeartbeat, claimReleased,
  gateDecided, gateRequested, itemQueued, productRegistered,
} from '../src/events.js';
import { FOUNDRY_TENANT_PACK_ID, itemAggregateId } from '../src/scope.js';

const TS = '2026-06-10T12:00:00.000Z';

describe('events', () => {
  it('productRegistered builds a validated envelope with defaults applied', () => {
    const e = productRegistered({ productKey: 'agri', name: 'Agri Twin', repo: 'de-braighter/agri', riskTier: 'T0', ts: TS });
    expect(e.eventType).toBe(EVENT.PRODUCT_REGISTERED);
    expect(e.tenantPackId).toBe(FOUNDRY_TENANT_PACK_ID);
    expect(e.aggregateType).toBe('Product');
    expect(e.occurredAt).toBe(TS);
    expect(e.payload).toMatchObject({ priority: 100, stage: 'execution' });
  });
  it('itemQueued validates scope and defaults arrays', () => {
    const e = itemQueued({ itemId: 'agri/E1.1', productKey: 'agri', title: 'Scaffold', scope: { repo: 'de-braighter/agri' }, ts: TS });
    expect(e.aggregateId).toBe(itemAggregateId('agri/E1.1'));
    expect(e.payload).toMatchObject({ dependsOn: [], qualityObligations: [] });
  });
  it('claim lifecycle constructors carry the session as actor provenance', () => {
    const a = claimAcquired({ claimId: 'c1', itemId: 'agri/E1.1', sessionId: 's1', ts: TS });
    expect(a.metadata?.['actorRef']).toBe('session:s1');
    expect(a.payload).toMatchObject({ ttlMinutes: 240 });
    expect(claimHeartbeat({ claimId: 'c1', itemId: 'agri/E1.1', sessionId: 's1', ts: TS }).eventType).toBe(EVENT.CLAIM_HEARTBEAT);
    expect(claimReleased({ claimId: 'c1', itemId: 'agri/E1.1', sessionId: 's1', outcome: 'done', ts: TS }).eventType).toBe(EVENT.CLAIM_RELEASED);
    expect(claimHandedOff({ claimId: 'c1', itemId: 'agri/E1.1', sessionId: 's1', note: 'overlap found', ts: TS }).eventType).toBe(EVENT.CLAIM_HANDED_OFF);
  });
  it('gate constructors', () => {
    const r = gateRequested({ gateId: 'g1', productKey: 'agri', gateType: 'greenlight', ts: TS });
    expect(r.aggregateType).toBe('Gate');
    const d = gateDecided({ gateId: 'g1', decision: 'approved', ts: TS });
    expect(d.metadata?.['actorRef']).toBe('founder');
  });
  it('rejects invalid payloads loudly', () => {
    expect(() => itemQueued({ itemId: '', productKey: 'agri', title: 'x', scope: { repo: 'r' }, ts: TS })).toThrow();
    expect(() => claimReleased({ claimId: 'c', itemId: 'i', sessionId: 's', outcome: 'shrug' as never, ts: TS })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/events.test.ts`
Expected: FAIL — cannot find module `../src/events.js`.

- [ ] **Step 3: Implement**

`src/events.ts`:

```typescript
// Foundry events ARE kernel domain events (devloop-compatible envelopes): every
// constructor returns a validated DomainEventEnvelope, so the foundry's
// operational exhaust is directly ingestible by the devloop twin (F6) with no
// transformation. The kernel never inspects the payload (ADR-027/030).
import { z } from 'zod';
import {
  DomainEventEnvelopeSchema,
  type DomainEventEnvelope,
} from '@de-braighter/substrate-contracts/events';
import {
  FOUNDRY_TENANT_PACK_ID, PACK_ID,
  gateAggregateId, itemAggregateId, productAggregateId,
} from './scope.js';

export const EVENT = {
  PRODUCT_REGISTERED: 'foundry:ProductRegistered.v1',
  ITEM_QUEUED: 'foundry:WorkItemQueued.v1',
  CLAIM_ACQUIRED: 'foundry:ClaimAcquired.v1',
  CLAIM_HEARTBEAT: 'foundry:ClaimHeartbeat.v1',
  CLAIM_RELEASED: 'foundry:ClaimReleased.v1',
  CLAIM_HANDED_OFF: 'foundry:ClaimHandedOff.v1',
  GATE_REQUESTED: 'foundry:GateRequested.v1',
  GATE_DECIDED: 'foundry:GateDecided.v1',
} as const;

export const RISK_TIERS = ['T0', 'T1', 'T2'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
export const GATE_TYPES = ['greenlight', 'architecture', 'adr', 'ship'] as const;
export type GateType = (typeof GATE_TYPES)[number];
export const RELEASE_OUTCOMES = ['done', 'blocked', 'abandoned'] as const;
export type ReleaseOutcome = (typeof RELEASE_OUTCOMES)[number];
export const GATE_DECISIONS = ['approved', 'rejected'] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

/** Claim grain (spec §4): issue-first; pathPrefix refines, repo is the coarsest. */
export const ItemScopeSchema = z.object({
  repo: z.string().min(1),
  issue: z.number().int().positive().optional(),
  pathPrefix: z.string().min(1).optional(),
});
export type ItemScope = z.infer<typeof ItemScopeSchema>;

// ---- pack-local payload schemas (opaque to the kernel) ----
const ProductRegistered = z.object({
  productKey: z.string().min(1), name: z.string().min(1), repo: z.string().min(1),
  riskTier: z.enum(RISK_TIERS), priority: z.number().int().default(100),
  charterRef: z.string().optional(), stage: z.string().default('execution'),
});
const WorkItemQueued = z.object({
  itemId: z.string().min(1), productKey: z.string().min(1), epic: z.string().optional(),
  title: z.string().min(1), scope: ItemScopeSchema, lane: z.string().optional(),
  dependsOn: z.array(z.string()).default([]), qualityObligations: z.array(z.string()).default([]),
});
const ClaimAcquired = z.object({
  claimId: z.string().min(1), itemId: z.string().min(1), sessionId: z.string().min(1),
  worktree: z.string().optional(), branch: z.string().optional(),
  ttlMinutes: z.number().int().positive().default(240),
});
const ClaimHeartbeat = z.object({ claimId: z.string().min(1), itemId: z.string().min(1) });
const ClaimReleased = z.object({
  claimId: z.string().min(1), itemId: z.string().min(1),
  outcome: z.enum(RELEASE_OUTCOMES), note: z.string().optional(), prRef: z.string().optional(),
});
const ClaimHandedOff = z.object({ claimId: z.string().min(1), itemId: z.string().min(1), note: z.string().min(1) });
const GateRequested = z.object({
  gateId: z.string().min(1), productKey: z.string().min(1),
  gateType: z.enum(GATE_TYPES), payloadRef: z.string().optional(),
});
const GateDecided = z.object({
  gateId: z.string().min(1), decision: z.enum(GATE_DECISIONS), note: z.string().optional(),
});

export type ProductRegisteredPayload = z.infer<typeof ProductRegistered>;
export type WorkItemQueuedPayload = z.infer<typeof WorkItemQueued>;
export type ClaimAcquiredPayload = z.infer<typeof ClaimAcquired>;
export type ClaimReleasedPayload = z.infer<typeof ClaimReleased>;
export type GateRequestedPayload = z.infer<typeof GateRequested>;
export type GateDecidedPayload = z.infer<typeof GateDecided>;

function envelope(
  eventType: string, aggregateType: string, aggregateId: string,
  occurredAt: string, payload: Record<string, unknown>, actorRef: string,
): DomainEventEnvelope {
  return DomainEventEnvelopeSchema.parse({
    tenantPackId: FOUNDRY_TENANT_PACK_ID,
    packId: PACK_ID,
    aggregateType,
    aggregateId,
    eventType,
    payload,
    metadata: { actorRef },
    occurredAt,
  });
}

// ---- typed constructors (validate payload, then build + validate the envelope) ----
export const productRegistered = (i: z.input<typeof ProductRegistered> & { ts: string }) =>
  envelope(EVENT.PRODUCT_REGISTERED, 'Product', productAggregateId(i.productKey), i.ts, ProductRegistered.parse(i), 'foundry:queue');

export const itemQueued = (i: z.input<typeof WorkItemQueued> & { ts: string }) =>
  envelope(EVENT.ITEM_QUEUED, 'WorkItem', itemAggregateId(i.itemId), i.ts, WorkItemQueued.parse(i), 'foundry:queue');

export const claimAcquired = (i: z.input<typeof ClaimAcquired> & { ts: string }) =>
  envelope(EVENT.CLAIM_ACQUIRED, 'WorkItem', itemAggregateId(i.itemId), i.ts, ClaimAcquired.parse(i), `session:${i.sessionId}`);

export const claimHeartbeat = (i: z.input<typeof ClaimHeartbeat> & { ts: string; sessionId: string }) =>
  envelope(EVENT.CLAIM_HEARTBEAT, 'WorkItem', itemAggregateId(i.itemId), i.ts, ClaimHeartbeat.parse(i), `session:${i.sessionId}`);

export const claimReleased = (i: z.input<typeof ClaimReleased> & { ts: string; sessionId: string }) =>
  envelope(EVENT.CLAIM_RELEASED, 'WorkItem', itemAggregateId(i.itemId), i.ts, ClaimReleased.parse(i), `session:${i.sessionId}`);

export const claimHandedOff = (i: z.input<typeof ClaimHandedOff> & { ts: string; sessionId: string }) =>
  envelope(EVENT.CLAIM_HANDED_OFF, 'WorkItem', itemAggregateId(i.itemId), i.ts, ClaimHandedOff.parse(i), `session:${i.sessionId}`);

export const gateRequested = (i: z.input<typeof GateRequested> & { ts: string }) =>
  envelope(EVENT.GATE_REQUESTED, 'Gate', gateAggregateId(i.gateId), i.ts, GateRequested.parse(i), 'foundry:session');

/** Gate decisions are founder acts — the actor is always 'founder'. */
export const gateDecided = (i: z.input<typeof GateDecided> & { ts: string }) =>
  envelope(EVENT.GATE_DECIDED, 'Gate', gateAggregateId(i.gateId), i.ts, GateDecided.parse(i), 'founder');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/events.ts test/events.test.ts
git commit -m "feat: foundry event constructors (devloop-compatible envelopes)"
```

---

### Task 4: `log.ts` — append-only JSONL store

**Files:**
- Create: `domains/foundry/src/log.ts`
- Test: `domains/foundry/test/log.test.ts`

- [ ] **Step 1: Write the failing test**

`test/log.test.ts`:

```typescript
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemQueued, productRegistered } from '../src/events.js';
import { append, readEnvelopes } from '../src/log.js';

const TS = '2026-06-10T12:00:00.000Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'foundry-log-'));

describe('log', () => {
  it('appends validated envelopes and reads them back in order', () => {
    const logPath = join(tmp(), 'events.jsonl');
    append(productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: TS }), logPath);
    append(itemQueued({ itemId: 'p/1', productKey: 'p', title: 'x', scope: { repo: 'r/p' }, ts: TS }), logPath);
    const all = readEnvelopes(logPath);
    expect(all).toHaveLength(2);
    expect(all[0]?.eventType).toBe('foundry:ProductRegistered.v1');
    expect(all[1]?.eventType).toBe('foundry:WorkItemQueued.v1');
  });
  it('returns [] for a missing log', () => {
    expect(readEnvelopes(join(tmp(), 'nope.jsonl'))).toEqual([]);
  });
  it('throws loudly on a corrupt line', () => {
    const logPath = join(tmp(), 'events.jsonl');
    writeFileSync(logPath, '{"not":"an envelope"}\n');
    expect(() => readEnvelopes(logPath)).toThrow(/corrupt log line 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/log.test.ts`
Expected: FAIL — cannot find module `../src/log.js`.

- [ ] **Step 3: Implement**

`src/log.ts`:

```typescript
// The control plane's observation log — append-only JSONL of validated
// DomainEventEnvelopes. Never mutated; all state derives from it via fold().
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DomainEventEnvelopeSchema,
  type DomainEventEnvelope,
} from '@de-braighter/substrate-contracts/events';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DATA_DIR = process.env['FOUNDRY_DATA_DIR'] ?? join(PKG_ROOT, 'data');
export const DEFAULT_LOG = process.env['FOUNDRY_LOG'] ?? join(DEFAULT_DATA_DIR, 'events.jsonl');

/** Append one validated envelope. Append-only — we never edit or delete a line. */
export function append(env: DomainEventEnvelope, logPath: string = DEFAULT_LOG): void {
  const valid = DomainEventEnvelopeSchema.parse(env); // validate on write
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(valid) + '\n');
}

/** Read + validate every envelope. Throws on a corrupt line (fail loud). */
export function readEnvelopes(logPath: string = DEFAULT_LOG): DomainEventEnvelope[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      try {
        return DomainEventEnvelopeSchema.parse(JSON.parse(line));
      } catch (e) {
        throw new Error(`corrupt log line ${i + 1}: ${(e as Error).message}`);
      }
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/log.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/log.ts test/log.test.ts
git commit -m "feat: append-only JSONL event log"
```

---

### Task 5: `store-lock.ts` — cross-process mutex

**Files:**
- Create: `domains/foundry/src/store-lock.ts`
- Test: `domains/foundry/test/store-lock.test.ts`

**Why this exists (context for the implementer):** each Claude Code session spawns its OWN stdio MCP server process, so claim atomicity CANNOT come from in-process serialization. `mkdirSync` is atomic on NTFS and POSIX (fails `EEXIST` if the dir exists) — the same primitive git uses for `.git/index.lock`. Stale takeover uses `renameSync` (atomic; exactly one renamer wins a race).

- [ ] **Step 1: Write the failing test**

`test/store-lock.test.ts`:

```typescript
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withStoreLock } from '../src/store-lock.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'foundry-lock-'));

describe('withStoreLock', () => {
  it('runs the fn and releases the lock dir afterwards', () => {
    const dir = tmp();
    const out = withStoreLock(dir, () => {
      expect(existsSync(join(dir, '.lock'))).toBe(true);
      return 42;
    });
    expect(out).toBe(42);
    expect(existsSync(join(dir, '.lock'))).toBe(false);
  });
  it('releases the lock even when fn throws', () => {
    const dir = tmp();
    expect(() => withStoreLock(dir, () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(join(dir, '.lock'))).toBe(false);
  });
  it('times out when another holder has a FRESH lock', () => {
    const dir = tmp();
    const lockDir = join(dir, '.lock');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'meta.json'), JSON.stringify({ pid: 99999, ts: new Date().toISOString() }));
    expect(() => withStoreLock(dir, () => 1, { timeoutMs: 200, retryMs: 20 })).toThrow(/lock timeout/);
  });
  it('takes over a STALE lock (old meta timestamp)', () => {
    const dir = tmp();
    const lockDir = join(dir, '.lock');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'meta.json'), JSON.stringify({ pid: 99999, ts: '2020-01-01T00:00:00.000Z' }));
    expect(withStoreLock(dir, () => 'won', { staleMs: 1000 })).toBe('won');
    expect(existsSync(lockDir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/store-lock.test.ts`
Expected: FAIL — cannot find module `../src/store-lock.js`.

- [ ] **Step 3: Implement**

`src/store-lock.ts`:

```typescript
// Cross-process mutex for store mutations. Each Claude Code session spawns its
// own stdio MCP server process, so in-process serialization is worthless —
// atomicity must live at the filesystem. mkdirSync is atomic (EEXIST if held);
// stale takeover renames the dir first (atomic, single winner), then removes it.
// Windows-safe by construction (mkdir-dir pattern, NOT flock) — per the
// workbench comparison's concurrency ruling.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LockOptions {
  /** A lock older than this is considered abandoned and may be taken over. */
  staleMs?: number;
  /** Poll interval while waiting. */
  retryMs?: number;
  /** Give up (throw) after this long. */
  timeoutMs?: number;
}

/** Synchronous sleep without busy-spinning the CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryAcquire(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

/** Age of the lock: prefer meta.json's ts; fall back to the dir mtime (covers the
 *  window between a holder's mkdir and its meta write — a fresh dir is NOT stale). */
function lockAgeMs(lockDir: string): number {
  try {
    const meta = JSON.parse(readFileSync(join(lockDir, 'meta.json'), 'utf8')) as { ts?: string };
    const t = meta.ts ? Date.parse(meta.ts) : Number.NaN;
    if (!Number.isNaN(t)) return Date.now() - t;
  } catch { /* missing/corrupt meta — fall through to mtime */ }
  try {
    return Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return 0; // dir vanished — treat as fresh; the acquire loop will retry
  }
}

/** Atomic takeover: rename wins exactly once even when several waiters race. */
function tryTakeoverStale(lockDir: string): void {
  const grave = `${lockDir}-stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(lockDir, grave);
    rmSync(grave, { recursive: true, force: true });
  } catch { /* another waiter won the rename — fine, loop and retry */ }
}

/** Run `fn` while holding the store's exclusive lock. NOT reentrant — never nest. */
export function withStoreLock<T>(dataDir: string, fn: () => T, opts: LockOptions = {}): T {
  const { staleMs = 30_000, retryMs = 50, timeoutMs = 15_000 } = opts;
  const lockDir = join(dataDir, '.lock');
  mkdirSync(dataDir, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (tryAcquire(lockDir)) break;
    if (lockAgeMs(lockDir) > staleMs) {
      tryTakeoverStale(lockDir);
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`foundry store lock timeout after ${timeoutMs}ms (${lockDir}) — another session is mid-mutation or a stale lock is younger than staleMs`);
    }
    sleepSync(retryMs);
  }
  try {
    writeFileSync(join(lockDir, 'meta.json'), JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
```

**Deliberate non-goal:** no spawn-based multi-process test — `mkdirSync` atomicity is an OS guarantee, not our code; the in-process tests prove our algorithm (EEXIST path, stale takeover, timeout, release-on-throw), which is the part that can be wrong.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/store-lock.test.ts`
Expected: PASS (4 tests). The timeout test takes ~200ms by design.

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/store-lock.ts test/store-lock.test.ts
git commit -m "feat: cross-process store lock (atomic mkdir + stale takeover)"
```

---

### Task 6: `state.ts` — fold to derived state + scope disjointness

**Files:**
- Create: `domains/foundry/src/state.ts`
- Test: `domains/foundry/test/state.test.ts`

- [ ] **Step 1: Write the failing test**

`test/state.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  claimAcquired, claimHeartbeat, claimReleased, gateDecided, gateRequested,
  itemQueued, productRegistered,
} from '../src/events.js';
import {
  activeClaim, claimStale, depsSatisfied, fold, itemStatus, scopesDisjoint, staleClaims,
} from '../src/state.js';

const T0 = '2026-06-10T12:00:00.000Z';
const T1 = '2026-06-10T13:00:00.000Z'; // +60min
const T9 = '2026-06-10T20:00:00.000Z'; // +480min (past a 240min TTL)
const ms = (iso: string) => Date.parse(iso);

const base = () => [
  productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T1', ts: T0 }),
  itemQueued({ itemId: 'p/1', productKey: 'p', title: 'one', scope: { repo: 'r/p', issue: 1 }, ts: T0 }),
  itemQueued({ itemId: 'p/2', productKey: 'p', title: 'two', scope: { repo: 'r/p', issue: 2 }, dependsOn: ['p/1'], ts: T0 }),
];

describe('fold', () => {
  it('builds products, items, gates', () => {
    const s = fold([...base(), gateRequested({ gateId: 'g1', productKey: 'p', gateType: 'ship', ts: T0 })]);
    expect(s.products.get('p')?.riskTier).toBe('T1');
    expect(s.items.size).toBe(2);
    expect(s.gates.get('g1')?.decision).toBeUndefined();
  });
  it('claim lifecycle: queued -> claimed -> done; deps gate on done', () => {
    const evs = [...base(), claimAcquired({ claimId: 'c1', itemId: 'p/1', sessionId: 's1', ts: T0 })];
    let s = fold(evs);
    expect(itemStatus(s.items.get('p/1')!, ms(T1))).toBe('claimed');
    expect(depsSatisfied(s, s.items.get('p/2')!)).toBe(false);
    s = fold([...evs, claimReleased({ claimId: 'c1', itemId: 'p/1', sessionId: 's1', outcome: 'done', ts: T1 })]);
    expect(itemStatus(s.items.get('p/1')!, ms(T1))).toBe('done');
    expect(depsSatisfied(s, s.items.get('p/2')!)).toBe(true);
  });
  it('TTL: an unbeaten claim expires; heartbeat extends it', () => {
    const evs = [...base(), claimAcquired({ claimId: 'c1', itemId: 'p/1', sessionId: 's1', ts: T0 })];
    let s = fold(evs);
    expect(itemStatus(s.items.get('p/1')!, ms(T9))).toBe('queued'); // expired at +480min
    expect(staleClaims(s, ms(T9)).map((c) => c.claimId)).toEqual(['c1']);
    s = fold([...evs, claimHeartbeat({ claimId: 'c1', itemId: 'p/1', sessionId: 's1', ts: T1 })]);
    expect(claimStale(s.items.get('p/1')!.claims[0]!, ms(T9))).toBe(true); // 13:00+240m=17:00 < 20:00
    expect(activeClaim(s.items.get('p/1')!, ms('2026-06-10T16:00:00.000Z'))?.claimId).toBe('c1');
  });
  it('released "blocked" returns the item to queued (re-claimable)', () => {
    const s = fold([...base(),
      claimAcquired({ claimId: 'c1', itemId: 'p/1', sessionId: 's1', ts: T0 }),
      claimReleased({ claimId: 'c1', itemId: 'p/1', sessionId: 's1', outcome: 'blocked', note: 'floor red', ts: T1 }),
    ]);
    expect(itemStatus(s.items.get('p/1')!, ms(T1))).toBe('queued');
  });
  it('gate decisions are recorded once (first decision wins)', () => {
    const s = fold([
      ...base(),
      gateRequested({ gateId: 'g1', productKey: 'p', gateType: 'ship', ts: T0 }),
      gateDecided({ gateId: 'g1', decision: 'approved', ts: T1 }),
      gateDecided({ gateId: 'g1', decision: 'rejected', ts: T9 }),
    ]);
    expect(s.gates.get('g1')?.decision?.decision).toBe('approved');
  });
  it('ignores unknown event types (forward compat)', () => {
    const alien = { ...base()[0]!, eventType: 'foundry:FutureThing.v9' };
    expect(() => fold([alien])).not.toThrow();
  });
});

describe('scopesDisjoint (fail closed)', () => {
  const r = (s: Partial<{ issue: number; pathPrefix: string }> = {}) => ({ repo: 'r/p', ...s });
  it('different repos are always disjoint', () => {
    expect(scopesDisjoint({ repo: 'a/x' }, { repo: 'b/y' })).toBe(true);
  });
  it('same repo, different issues are disjoint; same issue overlaps', () => {
    expect(scopesDisjoint(r({ issue: 1 }), r({ issue: 2 }))).toBe(true);
    expect(scopesDisjoint(r({ issue: 1 }), r({ issue: 1 }))).toBe(false);
  });
  it('non-nested pathPrefixes are disjoint; nested overlap', () => {
    expect(scopesDisjoint(r({ pathPrefix: 'src/a/' }), r({ pathPrefix: 'src/b/' }))).toBe(true);
    expect(scopesDisjoint(r({ pathPrefix: 'src/' }), r({ pathPrefix: 'src/b/' }))).toBe(false);
  });
  it('unprovable disjointness = overlap (whole-repo scope, issue vs path)', () => {
    expect(scopesDisjoint(r(), r({ issue: 1 }))).toBe(false);
    expect(scopesDisjoint(r({ issue: 1 }), r({ pathPrefix: 'src/' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/state.test.ts`
Expected: FAIL — cannot find module `../src/state.js`.

- [ ] **Step 3: Implement**

`src/state.ts`:

```typescript
// Derived state: a pure fold over the event log. Never persisted — the log is
// the only authority ("store generators, derive graphs" applied to the machine).
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import {
  EVENT,
  type GateDecision, type GateType, type ItemScope, type ReleaseOutcome, type RiskTier,
} from './events.js';

export interface ProductState {
  productKey: string; name: string; repo: string; riskTier: RiskTier;
  priority: number; charterRef?: string; stage: string;
}
export interface ClaimState {
  claimId: string; itemId: string; sessionId: string;
  worktree?: string; branch?: string; ttlMinutes: number;
  acquiredAt: string; lastBeatAt: string;
  released?: { outcome: ReleaseOutcome; note?: string; prRef?: string; at: string };
  handedOff?: { note: string; at: string };
}
export interface ItemState {
  itemId: string; productKey: string; epic?: string; title: string;
  scope: ItemScope; lane?: string; dependsOn: string[]; qualityObligations: string[];
  queuedAt: string; claims: ClaimState[];
}
export interface GateState {
  gateId: string; productKey: string; gateType: GateType; payloadRef?: string;
  requestedAt: string;
  decision?: { decision: GateDecision; note?: string; at: string };
}
export interface DerivedState {
  products: Map<string, ProductState>;
  items: Map<string, ItemState>;
  gates: Map<string, GateState>;
}

export const claimEnded = (c: ClaimState): boolean => c.released != null || c.handedOff != null;
export const claimExpired = (c: ClaimState, nowMs: number): boolean =>
  nowMs - Date.parse(c.lastBeatAt) >= c.ttlMinutes * 60_000;
export const claimActive = (c: ClaimState, nowMs: number): boolean => !claimEnded(c) && !claimExpired(c, nowMs);
export const claimStale = (c: ClaimState, nowMs: number): boolean => !claimEnded(c) && claimExpired(c, nowMs);

export function fold(events: DomainEventEnvelope[]): DerivedState {
  const s: DerivedState = { products: new Map(), items: new Map(), gates: new Map() };
  for (const e of events) {
    // Payloads were zod-validated on write (events.ts) and the whole envelope on
    // read (log.ts); the cast narrows to the constructor-guaranteed shape.
    const p = e.payload as Record<string, never>;
    switch (e.eventType) {
      case EVENT.PRODUCT_REGISTERED:
        s.products.set(p['productKey'], { ...(p as object) } as ProductState);
        break;
      case EVENT.ITEM_QUEUED:
        s.items.set(p['itemId'], {
          itemId: p['itemId'], productKey: p['productKey'], epic: p['epic'], title: p['title'],
          scope: p['scope'], lane: p['lane'],
          dependsOn: p['dependsOn'] ?? [], qualityObligations: p['qualityObligations'] ?? [],
          queuedAt: e.occurredAt, claims: [],
        });
        break;
      case EVENT.CLAIM_ACQUIRED: {
        const it = s.items.get(p['itemId']);
        if (it) it.claims.push({
          claimId: p['claimId'], itemId: p['itemId'], sessionId: p['sessionId'],
          worktree: p['worktree'], branch: p['branch'], ttlMinutes: p['ttlMinutes'] ?? 240,
          acquiredAt: e.occurredAt, lastBeatAt: e.occurredAt,
        });
        break;
      }
      case EVENT.CLAIM_HEARTBEAT: {
        const c = findClaim(s, p['claimId']);
        if (c && !claimEnded(c)) c.lastBeatAt = e.occurredAt;
        break;
      }
      case EVENT.CLAIM_RELEASED: {
        const c = findClaim(s, p['claimId']);
        if (c && !claimEnded(c)) c.released = { outcome: p['outcome'], note: p['note'], prRef: p['prRef'], at: e.occurredAt };
        break;
      }
      case EVENT.CLAIM_HANDED_OFF: {
        const c = findClaim(s, p['claimId']);
        if (c && !claimEnded(c)) c.handedOff = { note: p['note'], at: e.occurredAt };
        break;
      }
      case EVENT.GATE_REQUESTED:
        s.gates.set(p['gateId'], {
          gateId: p['gateId'], productKey: p['productKey'], gateType: p['gateType'],
          payloadRef: p['payloadRef'], requestedAt: e.occurredAt,
        });
        break;
      case EVENT.GATE_DECIDED: {
        const g = s.gates.get(p['gateId']);
        if (g && !g.decision) g.decision = { decision: p['decision'], note: p['note'], at: e.occurredAt };
        break;
      }
      default:
        break; // forward compat: unknown event types are ignored, never fatal
    }
  }
  return s;
}

export function findClaim(s: DerivedState, claimId: string): ClaimState | undefined {
  for (const it of s.items.values()) {
    const c = it.claims.find((x) => x.claimId === claimId);
    if (c) return c;
  }
  return undefined;
}

export const activeClaim = (it: ItemState, nowMs: number): ClaimState | undefined =>
  it.claims.find((c) => claimActive(c, nowMs));

export const itemDone = (it: ItemState): boolean => it.claims.some((c) => c.released?.outcome === 'done');

export type ItemStatus = 'done' | 'claimed' | 'queued';
export const itemStatus = (it: ItemState, nowMs: number): ItemStatus =>
  itemDone(it) ? 'done' : activeClaim(it, nowMs) ? 'claimed' : 'queued';

export const depsSatisfied = (s: DerivedState, it: ItemState): boolean =>
  it.dependsOn.every((d) => {
    const dep = s.items.get(d);
    return dep != null && itemDone(dep);
  });

/** Disjointness is FAIL CLOSED: same repo without provable separation = overlap.
 *  Provable: non-nested pathPrefixes (strongest), else distinct issues. An item
 *  with neither issue nor pathPrefix claims the whole repo. */
export function scopesDisjoint(a: ItemScope, b: ItemScope): boolean {
  if (a.repo !== b.repo) return true;
  if (a.pathPrefix && b.pathPrefix
    && !a.pathPrefix.startsWith(b.pathPrefix) && !b.pathPrefix.startsWith(a.pathPrefix)) return true;
  if (a.issue != null && b.issue != null && a.issue !== b.issue) return true;
  return false;
}

/** Stale claims worth surfacing: expired, unended, and still the LAST claim of a
 *  not-yet-done item (older superseded claims are history, not actionable). */
export function staleClaims(s: DerivedState, nowMs: number): ClaimState[] {
  const out: ClaimState[] = [];
  for (const it of s.items.values()) {
    if (itemDone(it)) continue;
    const last = it.claims.at(-1);
    if (last && claimStale(last, nowMs)) out.push(last);
  }
  return out;
}
```

Note on the `p['key']` index style: `payload` is typed `Record<string, unknown>`-ish by the envelope schema; with `noUncheckedIndexedAccess` the bracket access keeps the file honest while staying cast-light. If the implementing engineer finds `as Record<string, never>` too clever, an equivalent per-case `as` to the payload type imported from `events.ts` is acceptable — keep whichever typechecks cleanly, do NOT loosen tsconfig.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/state.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/state.ts test/state.test.ts
git commit -m "feat: derived state fold + TTL claims + fail-closed scope disjointness"
```

---

### Task 7: `ops.ts` part 1 — queuePush + claim (the atomic core)

**Files:**
- Create: `domains/foundry/src/ops.ts`
- Test: `domains/foundry/test/ops-queue-claim.test.ts`

- [ ] **Step 1: Write the failing test**

`test/ops-queue-claim.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claim, queuePush, type FoundryDeps } from '../src/ops.js';

const T0 = '2026-06-10T12:00:00.000Z';

function testDeps(ids: string[] = ['id-1', 'id-2', 'id-3']): FoundryDeps & { setNow: (iso: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-ops-'));
  let now = T0;
  const queue = [...ids];
  return {
    dataDir: dir, logPath: join(dir, 'events.jsonl'),
    now: () => now, newId: () => queue.shift() ?? 'id-overflow',
    setNow: (iso: string) => { now = iso; },
  };
}

const product = { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0' as const };
const twoItems = [
  { itemId: 'p/1', title: 'one', scope: { repo: 'r/p', issue: 1 } },
  { itemId: 'p/2', title: 'two', scope: { repo: 'r/p', issue: 2 } },
];

describe('queuePush', () => {
  it('registers the product once and queues items', () => {
    const deps = testDeps();
    const r1 = queuePush(deps, { product, items: twoItems });
    expect(r1).toEqual({ productRegistered: true, queued: ['p/1', 'p/2'] });
    const r2 = queuePush(deps, { product, items: [{ itemId: 'p/3', title: 'three', scope: { repo: 'r/p', issue: 3 } }] });
    expect(r2.productRegistered).toBe(false);
  });
  it('rejects duplicate itemIds (already queued and within batch)', () => {
    const deps = testDeps();
    queuePush(deps, { product, items: twoItems });
    expect(() => queuePush(deps, { product, items: [twoItems[0]!] })).toThrow(/already queued: p\/1/);
    expect(() => queuePush(deps, { product, items: [{ itemId: 'x', title: 'a', scope: { repo: 'r/p' } }, { itemId: 'x', title: 'b', scope: { repo: 'r/p' } }] }))
      .toThrow(/duplicate itemId/);
  });
});

describe('claim', () => {
  it('claims a queued item and rejects a second claim on the same item', () => {
    const deps = testDeps();
    queuePush(deps, { product, items: twoItems });
    const c = claim(deps, { itemId: 'p/1', sessionId: 's1' });
    expect(c).toEqual({ claimId: 'id-1', itemId: 'p/1', ttlMinutes: 240 });
    expect(() => claim(deps, { itemId: 'p/1', sessionId: 's2' })).toThrow(/already claimed by session s1/);
  });
  it('rejects a claim whose scope overlaps another ACTIVE claim', () => {
    const deps = testDeps();
    queuePush(deps, {
      product, items: [
        { itemId: 'p/a', title: 'a', scope: { repo: 'r/p', pathPrefix: 'src/' } },
        { itemId: 'p/b', title: 'b', scope: { repo: 'r/p', pathPrefix: 'src/deep/' } },
      ],
    });
    claim(deps, { itemId: 'p/a', sessionId: 's1' });
    expect(() => claim(deps, { itemId: 'p/b', sessionId: 's2' })).toThrow(/scope overlap with active claim on p\/a/);
  });
  it('allows claiming after the prior claim expired (stale-reclaim)', () => {
    const deps = testDeps();
    queuePush(deps, { product, items: twoItems });
    claim(deps, { itemId: 'p/1', sessionId: 's1', ttlMinutes: 60 });
    deps.setNow('2026-06-10T14:00:00.000Z'); // +120min > 60min TTL
    const c2 = claim(deps, { itemId: 'p/1', sessionId: 's2' });
    expect(c2.claimId).toBe('id-2');
  });
  it('enforces dependencies and rejects unknown items', () => {
    const deps = testDeps();
    queuePush(deps, { product, items: [
      { itemId: 'p/base', title: 'base', scope: { repo: 'r/p', issue: 10 } },
      { itemId: 'p/dep', title: 'dep', scope: { repo: 'r/p', issue: 11 }, dependsOn: ['p/base'] },
    ] });
    expect(() => claim(deps, { itemId: 'p/dep', sessionId: 's1' })).toThrow(/dependencies not done: p\/base/);
    expect(() => claim(deps, { itemId: 'nope', sessionId: 's1' })).toThrow(/unknown item/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/ops-queue-claim.test.ts`
Expected: FAIL — cannot find module `../src/ops.js`.

- [ ] **Step 3: Implement**

`src/ops.ts` (this task implements through `claim`; later tasks append to this file):

```typescript
// The mutation layer: every write funnels through withStoreLock -> re-read the
// log -> validate against fresh state -> append. Reads (nextItems, status) are
// lock-free snapshots — advisory by design; the claim re-validates under lock.
import { randomUUID } from 'node:crypto';
import * as ev from './events.js';
import type { ItemScope, ReleaseOutcome, RiskTier, GateType, GateDecision } from './events.js';
import { append, readEnvelopes } from './log.js';
import {
  activeClaim, claimEnded, depsSatisfied, findClaim, fold,
  itemStatus, scopesDisjoint,
  type DerivedState, type ItemState,
} from './state.js';
import { withStoreLock } from './store-lock.js';

export interface FoundryDeps {
  dataDir: string;
  logPath: string;
  now?: () => string;
  newId?: () => string;
}

const nowOf = (d: FoundryDeps): string => (d.now ?? (() => new Date().toISOString()))();
const idOf = (d: FoundryDeps): string => (d.newId ?? randomUUID)();
const load = (d: FoundryDeps): DerivedState => fold(readEnvelopes(d.logPath));

export interface ProductInput {
  productKey: string; name: string; repo: string; riskTier: RiskTier;
  priority?: number; charterRef?: string; stage?: string;
}
export interface ItemInput {
  itemId: string; title: string; epic?: string; scope: ItemScope;
  lane?: string; dependsOn?: string[]; qualityObligations?: string[];
}
export interface QueuePushInput { product: ProductInput; items: ItemInput[] }

export function queuePush(deps: FoundryDeps, input: QueuePushInput): { productRegistered: boolean; queued: string[] } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const seen = new Set<string>();
    for (const it of input.items) {
      if (seen.has(it.itemId)) throw new Error(`duplicate itemId in push: ${it.itemId}`);
      seen.add(it.itemId);
    }
    const dup = input.items.filter((i) => s.items.has(i.itemId)).map((i) => i.itemId);
    if (dup.length) throw new Error(`items already queued: ${dup.join(', ')}`);
    const isNew = !s.products.has(input.product.productKey);
    if (isNew) append(ev.productRegistered({ ...input.product, ts }), deps.logPath);
    for (const it of input.items) {
      append(ev.itemQueued({ ...it, productKey: input.product.productKey, ts }), deps.logPath);
    }
    return { productRegistered: isNew, queued: input.items.map((i) => i.itemId) };
  });
}

export interface ClaimInput { itemId: string; sessionId: string; worktree?: string; branch?: string; ttlMinutes?: number }

export function claim(deps: FoundryDeps, input: ClaimInput): { claimId: string; itemId: string; ttlMinutes: number } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const nowMs = Date.parse(ts);
    const s = load(deps);
    const item = s.items.get(input.itemId);
    if (!item) throw new Error(`unknown item: ${input.itemId}`);
    if (itemStatus(item, nowMs) === 'done') throw new Error(`item already done: ${input.itemId}`);
    const missing = item.dependsOn.filter((d) => !depsSatisfied(s, { ...item, dependsOn: [d] }));
    if (missing.length) throw new Error(`dependencies not done: ${missing.join(', ')}`);
    for (const other of s.items.values()) {
      const c = activeClaim(other, nowMs);
      if (!c) continue;
      if (other.itemId === item.itemId) {
        throw new Error(`item already claimed by session ${c.sessionId} (claim ${c.claimId})`);
      }
      if (!scopesDisjoint(item.scope, other.scope)) {
        throw new Error(`scope overlap with active claim on ${other.itemId} (session ${c.sessionId})`);
      }
    }
    const claimId = idOf(deps);
    const ttlMinutes = input.ttlMinutes ?? 240;
    append(ev.claimAcquired({
      claimId, itemId: input.itemId, sessionId: input.sessionId,
      worktree: input.worktree, branch: input.branch, ttlMinutes, ts,
    }), deps.logPath);
    return { claimId, itemId: input.itemId, ttlMinutes };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/ops-queue-claim.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/ops.ts test/ops-queue-claim.test.ts
git commit -m "feat: queue push + atomic claim with overlap rejection and stale-reclaim"
```

---

### Task 8: `ops.ts` part 2 — heartbeat, release, handoff

**Files:**
- Modify: `domains/foundry/src/ops.ts` (append functions)
- Test: `domains/foundry/test/ops-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

`test/ops-lifecycle.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claim, handoff, heartbeat, queuePush, release, type FoundryDeps } from '../src/ops.js';

const T0 = '2026-06-10T12:00:00.000Z';

function testDeps(): FoundryDeps & { setNow: (iso: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-life-'));
  let now = T0;
  let n = 0;
  return {
    dataDir: dir, logPath: join(dir, 'events.jsonl'),
    now: () => now, newId: () => `id-${++n}`,
    setNow: (iso: string) => { now = iso; },
  };
}

const seed = (deps: FoundryDeps) => {
  queuePush(deps, {
    product: { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0' },
    items: [{ itemId: 'p/1', title: 'one', scope: { repo: 'r/p', issue: 1 } }],
  });
  return claim(deps, { itemId: 'p/1', sessionId: 's1', ttlMinutes: 60 });
};

describe('heartbeat', () => {
  it('extends a live claim', () => {
    const deps = testDeps();
    const { claimId } = seed(deps);
    deps.setNow('2026-06-10T12:50:00.000Z');
    expect(heartbeat(deps, { claimId })).toMatchObject({ claimId, itemId: 'p/1' });
    deps.setNow('2026-06-10T13:30:00.000Z'); // would be expired from T0, alive from the beat
    expect(heartbeat(deps, { claimId })).toMatchObject({ claimId });
  });
  it('revives an expired-but-unsuperseded claim, but rejects a superseded one', () => {
    const deps = testDeps();
    const { claimId } = seed(deps);
    deps.setNow('2026-06-10T14:00:00.000Z'); // expired
    expect(heartbeat(deps, { claimId })).toMatchObject({ claimId }); // revive: nobody else took it
    deps.setNow('2026-06-10T18:00:00.000Z'); // expired again
    const second = claim(deps, { itemId: 'p/1', sessionId: 's2' });
    expect(() => heartbeat(deps, { claimId })).toThrow(new RegExp(`superseded by ${second.claimId}`));
  });
  it('rejects unknown and ended claims', () => {
    const deps = testDeps();
    const { claimId } = seed(deps);
    release(deps, { claimId, outcome: 'done' });
    expect(() => heartbeat(deps, { claimId })).toThrow(/already ended/);
    expect(() => heartbeat(deps, { claimId: 'ghost' })).toThrow(/unknown claim/);
  });
});

describe('release / handoff', () => {
  it('release records outcome + prRef and completes the item', () => {
    const deps = testDeps();
    const { claimId } = seed(deps);
    const r = release(deps, { claimId, outcome: 'done', prRef: 'r/p#7' });
    expect(r).toEqual({ claimId, itemId: 'p/1', outcome: 'done' });
    expect(() => release(deps, { claimId, outcome: 'done' })).toThrow(/already ended/);
  });
  it('handoff returns the item to the queue with a note', () => {
    const deps = testDeps();
    const { claimId } = seed(deps);
    const h = handoff(deps, { claimId, note: 'discovered overlap with p/2' });
    expect(h).toEqual({ claimId, itemId: 'p/1' });
    // item is claimable again
    expect(claim(deps, { itemId: 'p/1', sessionId: 's2' }).itemId).toBe('p/1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/ops-lifecycle.test.ts`
Expected: FAIL — `heartbeat` / `release` / `handoff` are not exported.

- [ ] **Step 3: Implement — append to `src/ops.ts`**

```typescript
/** Common guard: resolve a claim that is allowed to be acted on. */
function liveClaim(s: DerivedState, claimId: string) {
  const c = findClaim(s, claimId);
  if (!c) throw new Error(`unknown claim: ${claimId}`);
  if (claimEnded(c)) throw new Error(`claim already ended: ${claimId}`);
  return c;
}

export function heartbeat(deps: FoundryDeps, input: { claimId: string }): { claimId: string; itemId: string; beatAt: string } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const nowMs = Date.parse(ts);
    const s = load(deps);
    const c = liveClaim(s, input.claimId);
    const item = s.items.get(c.itemId);
    const act = item ? activeClaim(item, nowMs) : undefined;
    if (act && act.claimId !== c.claimId) {
      throw new Error(`claim ${c.claimId} superseded by ${act.claimId} — do not continue working; re-claim or hand off`);
    }
    append(ev.claimHeartbeat({ claimId: c.claimId, itemId: c.itemId, sessionId: c.sessionId, ts }), deps.logPath);
    return { claimId: c.claimId, itemId: c.itemId, beatAt: ts };
  });
}

export function release(
  deps: FoundryDeps,
  input: { claimId: string; outcome: ReleaseOutcome; note?: string; prRef?: string },
): { claimId: string; itemId: string; outcome: ReleaseOutcome } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const c = liveClaim(s, input.claimId);
    append(ev.claimReleased({
      claimId: c.claimId, itemId: c.itemId, sessionId: c.sessionId,
      outcome: input.outcome, note: input.note, prRef: input.prRef, ts,
    }), deps.logPath);
    return { claimId: c.claimId, itemId: c.itemId, outcome: input.outcome };
  });
}

export function handoff(deps: FoundryDeps, input: { claimId: string; note: string }): { claimId: string; itemId: string } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const c = liveClaim(s, input.claimId);
    append(ev.claimHandedOff({ claimId: c.claimId, itemId: c.itemId, sessionId: c.sessionId, note: input.note, ts }), deps.logPath);
    return { claimId: c.claimId, itemId: c.itemId };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/ops-lifecycle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/ops.ts test/ops-lifecycle.test.ts
git commit -m "feat: claim lifecycle — heartbeat (revive/supersede), release, handoff"
```

---

### Task 9: `ops.ts` part 3 — gates + next-item selection

**Files:**
- Modify: `domains/foundry/src/ops.ts` (append functions)
- Test: `domains/foundry/test/ops-gates-next.test.ts`

- [ ] **Step 1: Write the failing test**

`test/ops-gates-next.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claim, gateDecide, gateRequest, nextItems, queuePush, release, type FoundryDeps } from '../src/ops.js';

const T0 = '2026-06-10T12:00:00.000Z';

function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-next-'));
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => T0, newId: () => `id-${++n}` };
}

describe('gates', () => {
  it('request -> decide roundtrip; double-decide and unknown product rejected', () => {
    const deps = testDeps();
    queuePush(deps, { product: { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T2' }, items: [] });
    const g = gateRequest(deps, { productKey: 'p', gateType: 'ship', payloadRef: 'r/p#9' });
    expect(g.gateId).toBe('id-1');
    expect(gateDecide(deps, { gateId: g.gateId, decision: 'approved' })).toEqual({ gateId: 'id-1', decision: 'approved' });
    expect(() => gateDecide(deps, { gateId: g.gateId, decision: 'rejected' })).toThrow(/already decided/);
    expect(() => gateRequest(deps, { productKey: 'ghost', gateType: 'ship' })).toThrow(/unknown product/);
  });
});

describe('nextItems', () => {
  it('orders by product priority then queue order; excludes claimed/done/dep-blocked/conflicting', () => {
    const deps = testDeps();
    queuePush(deps, {
      product: { productKey: 'hot', name: 'Hot', repo: 'r/hot', riskTier: 'T0', priority: 10 },
      items: [
        { itemId: 'hot/1', title: 'h1', scope: { repo: 'r/hot', issue: 1 } },
        { itemId: 'hot/2', title: 'h2', scope: { repo: 'r/hot', issue: 2 }, dependsOn: ['hot/1'] },
      ],
    });
    queuePush(deps, {
      product: { productKey: 'cold', name: 'Cold', repo: 'r/cold', riskTier: 'T0', priority: 90 },
      items: [
        { itemId: 'cold/1', title: 'c1', scope: { repo: 'r/cold', issue: 1 } },
        { itemId: 'cold/2', title: 'c2', scope: { repo: 'r/cold' } }, // whole-repo scope
      ],
    });
    // initial: hot/1 (prio 10) first; hot/2 dep-blocked; cold/1 + cold/2 conflict-free until one is claimed
    let next = nextItems(deps, 10);
    expect(next.map((i) => i.itemId)).toEqual(['hot/1', 'cold/1', 'cold/2']);
    // claim cold/1 -> cold/2 (whole-repo) now conflicts with the active cold/1 claim
    claim(deps, { itemId: 'cold/1', sessionId: 's1' });
    next = nextItems(deps, 10);
    expect(next.map((i) => i.itemId)).toEqual(['hot/1']);
    // finish hot/1 -> hot/2 unblocks
    const c = claim(deps, { itemId: 'hot/1', sessionId: 's2' });
    release(deps, { claimId: c.claimId, outcome: 'done' });
    next = nextItems(deps, 10);
    expect(next.map((i) => i.itemId)).toEqual(['hot/2']);
    // enrichment: carries product facts the prompt needs
    expect(next[0]).toMatchObject({ riskTier: 'T0', repo: 'r/hot', priority: 10, productKey: 'hot' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/ops-gates-next.test.ts`
Expected: FAIL — `gateRequest` / `gateDecide` / `nextItems` are not exported.

- [ ] **Step 3: Implement — append to `src/ops.ts`**

```typescript
export function gateRequest(
  deps: FoundryDeps,
  input: { productKey: string; gateType: GateType; payloadRef?: string },
): { gateId: string } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    if (!s.products.has(input.productKey)) throw new Error(`unknown product: ${input.productKey}`);
    const gateId = idOf(deps);
    append(ev.gateRequested({ gateId, productKey: input.productKey, gateType: input.gateType, payloadRef: input.payloadRef, ts }), deps.logPath);
    return { gateId };
  });
}

export function gateDecide(
  deps: FoundryDeps,
  input: { gateId: string; decision: GateDecision; note?: string },
): { gateId: string; decision: GateDecision } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const g = s.gates.get(input.gateId);
    if (!g) throw new Error(`unknown gate: ${input.gateId}`);
    if (g.decision) throw new Error(`gate already decided: ${input.gateId} (${g.decision.decision})`);
    append(ev.gateDecided({ gateId: input.gateId, decision: input.decision, note: input.note, ts }), deps.logPath);
    return { gateId: input.gateId, decision: input.decision };
  });
}

export interface NextItem {
  itemId: string; title: string; epic?: string; scope: ItemScope; lane?: string;
  qualityObligations: string[]; productKey: string; priority: number;
  riskTier: RiskTier; repo: string;
}

function toNextItem(s: DerivedState, it: ItemState): NextItem {
  const prod = s.products.get(it.productKey);
  if (!prod) throw new Error(`item ${it.itemId} references unknown product ${it.productKey} — corrupt log?`);
  return {
    itemId: it.itemId, title: it.title, epic: it.epic, scope: it.scope, lane: it.lane,
    qualityObligations: it.qualityObligations, productKey: it.productKey,
    priority: prod.priority, riskTier: prod.riskTier, repo: prod.repo,
  };
}

/** Lock-free advisory read: what a fresh session should pick up. The claim op
 *  re-validates everything under the lock, so a racing read is harmless. */
export function nextItems(deps: FoundryDeps, limit = 5): NextItem[] {
  const ts = nowOf(deps);
  const nowMs = Date.parse(ts);
  const s = load(deps);
  const actives = [...s.items.values()].filter((i) => activeClaim(i, nowMs));
  const claimable = [...s.items.values()].filter((i) =>
    itemStatus(i, nowMs) === 'queued'
    && depsSatisfied(s, i)
    && actives.every((a) => scopesDisjoint(i.scope, a.scope)));
  const prio = (i: ItemState): number => s.products.get(i.productKey)?.priority ?? 100;
  claimable.sort((a, b) =>
    (prio(a) - prio(b))
    || (Date.parse(a.queuedAt) - Date.parse(b.queuedAt))
    || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return claimable.slice(0, limit).map((i) => toNextItem(s, i));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/ops-gates-next.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd domains/foundry
git add src/ops.ts test/ops-gates-next.test.ts
git commit -m "feat: founder gates + priority-ordered conflict-free next-item selection"
```

---

### Task 10: `prompts.ts` + `sessionPrompts` op + `status.ts`

**Files:**
- Create: `domains/foundry/src/prompts.ts`
- Create: `domains/foundry/src/status.ts`
- Modify: `domains/foundry/src/ops.ts` (append `sessionPrompts`)
- Test: `domains/foundry/test/prompts-status.test.ts`

- [ ] **Step 1: Write the failing test**

`test/prompts-status.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEnvelopes } from '../src/log.js';
import { claim, gateRequest, queuePush, sessionPrompts, type FoundryDeps } from '../src/ops.js';
import { fold } from '../src/state.js';
import { statusText } from '../src/status.js';

const T0 = '2026-06-10T12:00:00.000Z';

function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-ps-'));
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => T0, newId: () => `id-${++n}` };
}

const seed = (deps: FoundryDeps) => queuePush(deps, {
  product: { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T1', priority: 10 },
  items: [
    { itemId: 'p/1', title: 'build the thing', scope: { repo: 'r/p', issue: 1 }, qualityObligations: ['mutation>=60'] },
    { itemId: 'p/2', title: 'whole repo job', scope: { repo: 'r/p' } },
    { itemId: 'p/3', title: 'other repo', scope: { repo: 'r/q', issue: 5 } },
  ],
});

describe('sessionPrompts', () => {
  it('returns mutually scope-disjoint prompts embedding the protocol', () => {
    const deps = testDeps();
    seed(deps);
    const prompts = sessionPrompts(deps, 3);
    // p/1 picked; p/2 (whole-repo r/p) conflicts with p/1 -> skipped; p/3 disjoint
    expect(prompts.map((p) => p.itemId)).toEqual(['p/1', 'p/3']);
    const text = prompts[0]!.prompt;
    expect(text).toContain('foundry_claim');
    expect(text).toContain('p/1');
    expect(text).toContain('worktree');
    expect(text).toContain('foundry_release');
    expect(text).toContain('risk tier T1');
    expect(text).toContain('mutation>=60');
    expect(text).toContain('Producer:');
  });
  it('generating prompts claims NOTHING (a prompt never holds a lock)', () => {
    const deps = testDeps();
    seed(deps);
    sessionPrompts(deps, 2);
    const types = readEnvelopes(deps.logPath).map((e) => e.eventType);
    expect(types.filter((t) => t.includes('Claim'))).toEqual([]);
  });
});

describe('statusText', () => {
  it('renders products, claims, stale claims, pending gates, next-up', () => {
    const deps = testDeps();
    seed(deps);
    claim(deps, { itemId: 'p/1', sessionId: 's1', worktree: 'D:/wt/p1' });
    gateRequest(deps, { productKey: 'p', gateType: 'architecture' });
    const text = statusText(fold(readEnvelopes(deps.logPath)), T0);
    expect(text).toContain('PRODUCTS');
    expect(text).toContain('p [T1] prio=10');
    expect(text).toContain('ACTIVE CLAIMS');
    expect(text).toContain('p/1');
    expect(text).toContain('s1');
    expect(text).toContain('PENDING GATES');
    expect(text).toContain('architecture');
    expect(text).toContain('NEXT UP');
    expect(text).toContain('p/3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd domains/foundry && npx vitest run test/prompts-status.test.ts`
Expected: FAIL — missing modules/exports.

- [ ] **Step 3: Implement**

`src/prompts.ts`:

```typescript
// The hybrid-spawn surface: ready-to-paste worker-session prompts. The prompt
// encodes the session protocol (spec §5) — claim, isolate, execute, quality,
// land, release — so a pasted session needs zero additional briefing.
import type { NextItem } from './ops.js';

export function renderSessionPrompt(i: NextItem): string {
  const scopeBits = [
    i.scope.repo,
    i.scope.issue != null ? `issue #${i.scope.issue}` : null,
    i.scope.pathPrefix ? `paths under ${i.scope.pathPrefix}` : null,
  ].filter(Boolean).join(' — ');
  const quality = i.qualityObligations.length
    ? `\nQuality obligations (tier floor): ${i.qualityObligations.join(', ')}`
    : '';
  return `You are a Foundry worker session. Work EXACTLY one work item, then stop.

Item: ${i.itemId} — ${i.title}
Product: ${i.productKey} (risk tier ${i.riskTier}) · Repo: ${i.repo}
Scope (hard boundary — do not touch anything outside it): ${scopeBits}${quality}

Protocol — mandatory, in order:
1. CLAIM — call foundry MCP tool foundry_claim with { itemId: "${i.itemId}", sessionId: "<your session id>" }. If rejected, STOP immediately; never work unclaimed.
2. ISOLATE — create a git worktree for this claim and work only there; never in the shared clone. Pass the worktree path and branch to foundry_claim.
3. EXECUTE — implement the item within its scope. Route through existing skills (superpowers:subagent-driven-development for plan execution).
4. QUALITY — run the repo's local gates (ci:local) and the verifier wave per risk tier ${i.riskTier}; post findings to the PR before merge.
5. LAND — open a PR carrying Producer:/Effort:/Effect: lines; merge per tier policy; run the devloop twin ritual (drain -> backfill -> reconcile).
6. RELEASE — call foundry_release with { claimId, outcome: "done", prRef: "<repo>#<pr>" }; if you cannot finish, release with outcome "blocked" and a note instead.

During long work call foundry_heartbeat with your claimId at least every 2 hours, or the claim goes stale and may be reclaimed.`;
}
```

Append to `src/ops.ts`:

```typescript
import { renderSessionPrompt } from './prompts.js';
```

(put the import at the top of the file with the others)

```typescript
export interface SessionPrompt { itemId: string; title: string; prompt: string }

/** Top-N MUTUALLY disjoint claimable items rendered as paste-ready prompts.
 *  Read-only: prompts never claim (a prompt that is never launched must not
 *  hold a lock — spec §4). */
export function sessionPrompts(deps: FoundryDeps, count = 3): SessionPrompt[] {
  const candidates = nextItems(deps, 50);
  const picked: NextItem[] = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => scopesDisjoint(c.scope, p.scope))) picked.push(c);
  }
  return picked.map((i) => ({ itemId: i.itemId, title: i.title, prompt: renderSessionPrompt(i) }));
}
```

`src/status.ts`:

```typescript
// The board: a single human-readable snapshot (foundry_status). Read-only.
import {
  activeClaim, depsSatisfied, itemStatus, scopesDisjoint, staleClaims,
  type DerivedState, type ItemState,
} from './state.js';

const ageMin = (iso: string, nowMs: number): number => Math.round((nowMs - Date.parse(iso)) / 60_000);

export function statusText(s: DerivedState, nowIso: string): string {
  const nowMs = Date.parse(nowIso);
  const lines: string[] = [];

  lines.push('PRODUCTS');
  if (s.products.size === 0) lines.push('  (none)');
  for (const p of [...s.products.values()].sort((a, b) => a.priority - b.priority)) {
    const items = [...s.items.values()].filter((i) => i.productKey === p.productKey);
    const by = { queued: 0, claimed: 0, done: 0 };
    for (const i of items) by[itemStatus(i, nowMs)] += 1;
    lines.push(`  ${p.productKey} [${p.riskTier}] prio=${p.priority} stage=${p.stage} — items: ${by.queued} queued / ${by.claimed} claimed / ${by.done} done`);
  }

  lines.push('', 'ACTIVE CLAIMS');
  const actives = [...s.items.values()]
    .map((i) => ({ i, c: activeClaim(i, nowMs) }))
    .filter((x): x is { i: ItemState; c: NonNullable<ReturnType<typeof activeClaim>> } => x.c != null);
  if (actives.length === 0) lines.push('  (none)');
  for (const { i, c } of actives) {
    lines.push(`  ${i.itemId} — session ${c.sessionId}, ${ageMin(c.lastBeatAt, nowMs)}min since beat, ttl ${c.ttlMinutes}min${c.worktree ? `, worktree ${c.worktree}` : ''}`);
  }

  const stale = staleClaims(s, nowMs);
  lines.push('', 'STALE CLAIMS (reclaimable — clean up the worktree)');
  if (stale.length === 0) lines.push('  (none)');
  for (const c of stale) {
    lines.push(`  ${c.itemId} — session ${c.sessionId}, last beat ${ageMin(c.lastBeatAt, nowMs)}min ago${c.worktree ? `, worktree ${c.worktree}` : ''}`);
  }

  lines.push('', 'PENDING GATES (awaiting founder)');
  const pending = [...s.gates.values()].filter((g) => !g.decision);
  if (pending.length === 0) lines.push('  (none)');
  for (const g of pending) {
    lines.push(`  ${g.gateId} — ${g.productKey} ${g.gateType}${g.payloadRef ? ` (${g.payloadRef})` : ''}, requested ${ageMin(g.requestedAt, nowMs)}min ago`);
  }

  lines.push('', 'NEXT UP (claimable now)');
  const activeItems = actives.map((x) => x.i);
  const claimable = [...s.items.values()].filter((i) =>
    itemStatus(i, nowMs) === 'queued'
    && depsSatisfied(s, i)
    && activeItems.every((a) => scopesDisjoint(i.scope, a.scope)));
  const prio = (i: ItemState): number => s.products.get(i.productKey)?.priority ?? 100;
  claimable.sort((a, b) => (prio(a) - prio(b)) || (Date.parse(a.queuedAt) - Date.parse(b.queuedAt)));
  if (claimable.length === 0) lines.push('  (none)');
  for (const i of claimable.slice(0, 5)) lines.push(`  ${i.itemId} — ${i.title}`);

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd domains/foundry && npx vitest run test/prompts-status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `cd domains/foundry && npm run typecheck && npx vitest run`
Expected: all green. Fix any cross-module type drift NOW (this is the first task where every module is loaded together).

- [ ] **Step 6: Commit**

```bash
cd domains/foundry
git add src/prompts.ts src/status.ts src/ops.ts test/prompts-status.test.ts
git commit -m "feat: session prompts (hybrid spawn) + status board"
```

---

### Task 11: MCP tools + server + end-to-end flow test

**Files:**
- Create: `domains/foundry/src/mcp/tools.ts`
- Create: `domains/foundry/src/mcp/server.ts`
- Test: `domains/foundry/test/mcp-tools.test.ts`
- Test: `domains/foundry/test/e2e.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/mcp-tools.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTools } from '../src/mcp/tools.js';
import type { FoundryDeps } from '../src/ops.js';

function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-mcp-'));
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => '2026-06-10T12:00:00.000Z', newId: () => `id-${++n}` };
}

const push = { product: { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0' as const }, items: [{ itemId: 'p/1', title: 'one', scope: { repo: 'r/p', issue: 1 } }] };

describe('makeTools', () => {
  it('happy path: push -> next -> claim -> status -> release', async () => {
    const t = makeTools(testDeps());
    expect((await t.foundry_queue_push(push)).isError).toBeUndefined();
    const next = await t.foundry_next({});
    expect(next.content[0]?.type).toBe('text');
    expect((next.content[0] as { text: string }).text).toContain('p/1');
    const c = await t.foundry_claim({ itemId: 'p/1', sessionId: 's1' });
    expect((c.content[0] as { text: string }).text).toContain('id-1');
    const st = await t.foundry_status({});
    expect((st.content[0] as { text: string }).text).toContain('ACTIVE CLAIMS');
    const r = await t.foundry_release({ claimId: 'id-1', outcome: 'done' });
    expect(r.isError).toBeUndefined();
  });
  it('domain errors come back as isError results, not throws', async () => {
    const t = makeTools(testDeps());
    const res = await t.foundry_claim({ itemId: 'ghost', sessionId: 's1' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/ERROR: unknown item/);
  });
  it('session prompts round-trip through the tool layer', async () => {
    const t = makeTools(testDeps());
    await t.foundry_queue_push(push);
    const p = await t.foundry_session_prompt({ count: 1 });
    expect((p.content[0] as { text: string }).text).toContain('foundry_claim');
  });
});
```

`test/e2e.test.ts` — the spec §8 acceptance shape in miniature:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTools } from '../src/mcp/tools.js';
import type { FoundryDeps } from '../src/ops.js';

const text = (r: { content: Array<{ type: string }> }): string => (r.content[0] as { text: string }).text;

describe('e2e: one product through the control plane', () => {
  it('queue -> gate -> prompts -> parallel claims collide correctly -> done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-e2e-'));
    let now = '2026-06-10T12:00:00.000Z';
    let n = 0;
    const deps: FoundryDeps = { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => now, newId: () => `id-${++n}` };
    const t = makeTools(deps);

    // 1. build-path designer pushes the product + 3 items (2 disjoint lanes + 1 dependent)
    await t.foundry_queue_push({
      product: { productKey: 'agri', name: 'Agri Twin', repo: 'de-braighter/agri', riskTier: 'T1', priority: 20 },
      items: [
        { itemId: 'agri/E1.1', title: 'scaffold', scope: { repo: 'de-braighter/agri', pathPrefix: 'libs/spine/' } },
        { itemId: 'agri/E1.2', title: 'api', scope: { repo: 'de-braighter/agri', pathPrefix: 'apps/api/' } },
        { itemId: 'agri/E2.1', title: 'ui on api', scope: { repo: 'de-braighter/agri', pathPrefix: 'apps/web/' }, dependsOn: ['agri/E1.2'] },
      ],
    });

    // 2. architecture gate (T1) requested + approved
    const g = await t.foundry_gate_request({ productKey: 'agri', gateType: 'architecture', payloadRef: 'specs/adr-xxx' });
    const gateId = /id-\d+/.exec(text(g))![0];
    await t.foundry_gate_decide({ gateId, decision: 'approved' });

    // 3. founder asks for 3 session prompts -> only the 2 disjoint lanes come back
    const prompts = await t.foundry_session_prompt({ count: 3 });
    expect(text(prompts)).toContain('agri/E1.1');
    expect(text(prompts)).toContain('agri/E1.2');
    expect(text(prompts)).not.toContain('agri/E2.1'); // dep-blocked

    // 4. two sessions claim the two lanes; a third session's overlap is rejected
    const c1 = await t.foundry_claim({ itemId: 'agri/E1.1', sessionId: 'sess-A', worktree: 'D:/wt/a' });
    const c2 = await t.foundry_claim({ itemId: 'agri/E1.2', sessionId: 'sess-B', worktree: 'D:/wt/b' });
    expect(c1.isError).toBeUndefined();
    expect(c2.isError).toBeUndefined();
    const again = await t.foundry_claim({ itemId: 'agri/E1.1', sessionId: 'sess-C' });
    expect(again.isError).toBe(true);

    // 5. lanes finish; the dependent item unblocks; status reflects everything
    const idA = /id-\d+/.exec(text(c1))![0];
    const idB = /id-\d+/.exec(text(c2))![0];
    await t.foundry_release({ claimId: idA, outcome: 'done', prRef: 'de-braighter/agri#1' });
    await t.foundry_release({ claimId: idB, outcome: 'done', prRef: 'de-braighter/agri#2' });
    now = '2026-06-10T14:00:00.000Z';
    const next = await t.foundry_next({});
    expect(text(next)).toContain('agri/E2.1');
    const status = await t.foundry_status({});
    expect(text(status)).toContain('2 done');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd domains/foundry && npx vitest run test/mcp-tools.test.ts test/e2e.test.ts`
Expected: FAIL — cannot find module `../src/mcp/tools.js`.

- [ ] **Step 3: Implement**

`src/mcp/tools.ts`:

```typescript
// Pure tool handlers, parameterized by deps — directly unit-testable and
// hermetic (same pattern as devloop's KG server). Domain errors become
// isError results: an MCP client must never see a transport-level throw
// for a rejected claim.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readEnvelopes } from '../log.js';
import * as ops from '../ops.js';
import { fold } from '../state.js';
import { statusText } from '../status.js';

type ToolResult = CallToolResult;

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown): ToolResult => ({
  content: [{ type: 'text', text: `ERROR: ${(e as Error).message}` }],
  isError: true,
});

function guard<A extends unknown[]>(fn: (...a: A) => unknown) {
  return async (...a: A): Promise<ToolResult> => {
    try {
      return ok(await fn(...a));
    } catch (e) {
      return fail(e);
    }
  };
}

export function makeTools(deps: ops.FoundryDeps) {
  const nowIso = (): string => (deps.now ?? (() => new Date().toISOString()))();
  return {
    foundry_status: guard((_a: Record<string, never>) => statusText(fold(readEnvelopes(deps.logPath)), nowIso())),
    foundry_next: guard((a: { limit?: number }) => ops.nextItems(deps, a.limit ?? 5)),
    foundry_claim: guard((a: ops.ClaimInput) => ops.claim(deps, a)),
    foundry_heartbeat: guard((a: { claimId: string }) => ops.heartbeat(deps, a)),
    foundry_release: guard((a: Parameters<typeof ops.release>[1]) => ops.release(deps, a)),
    foundry_handoff: guard((a: { claimId: string; note: string }) => ops.handoff(deps, a)),
    foundry_session_prompt: guard((a: { count?: number }) => ops.sessionPrompts(deps, a.count ?? 3)),
    foundry_queue_push: guard((a: ops.QueuePushInput) => ops.queuePush(deps, a)),
    foundry_gate_request: guard((a: Parameters<typeof ops.gateRequest>[1]) => ops.gateRequest(deps, a)),
    foundry_gate_decide: guard((a: Parameters<typeof ops.gateDecide>[1]) => ops.gateDecide(deps, a)),
  };
}
```

`src/mcp/server.ts`:

```typescript
// Stdio MCP boot. One process PER Claude Code session — never assume this
// process is the only writer; all atomicity lives in the store (withStoreLock).
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GATE_DECISIONS, GATE_TYPES, RELEASE_OUTCOMES, RISK_TIERS } from '../events.js';
import { DEFAULT_DATA_DIR, DEFAULT_LOG } from '../log.js';
import { makeTools } from './tools.js';

const scopeShape = z.object({
  repo: z.string(),
  issue: z.number().int().positive().optional(),
  pathPrefix: z.string().optional(),
});

export async function main(): Promise<void> {
  const tools = makeTools({ dataDir: DEFAULT_DATA_DIR, logPath: DEFAULT_LOG });
  const server = new McpServer({ name: 'foundry', version: '0.1.0' });

  server.registerTool('foundry_status', {
    description: 'The Foundry board: products, in-flight claims, stale claims, pending founder gates, next claimable items.',
    inputSchema: {},
  }, async () => tools.foundry_status({}));

  server.registerTool('foundry_next', {
    description: 'Highest-value claimable work items across all products (priority-ordered, dependency- and conflict-filtered).',
    inputSchema: { limit: z.number().int().positive().optional() },
  }, async (a) => tools.foundry_next(a));

  server.registerTool('foundry_claim', {
    description: 'Atomically claim a work item for this session. Rejected if the item or any scope-overlapping item is actively claimed. Call at session START; pass your worktree + branch.',
    inputSchema: {
      itemId: z.string(), sessionId: z.string(),
      worktree: z.string().optional(), branch: z.string().optional(),
      ttlMinutes: z.number().int().positive().optional(),
    },
  }, async (a) => tools.foundry_claim(a));

  server.registerTool('foundry_heartbeat', {
    description: 'Keep a claim alive during long work (TTL default 240min). Errors if the claim was superseded — stop working if so.',
    inputSchema: { claimId: z.string() },
  }, async (a) => tools.foundry_heartbeat(a));

  server.registerTool('foundry_release', {
    description: 'Release a claim with its outcome: done (with prRef), blocked (with note — item re-queues), or abandoned.',
    inputSchema: {
      claimId: z.string(), outcome: z.enum(RELEASE_OUTCOMES),
      note: z.string().optional(), prRef: z.string().optional(),
    },
  }, async (a) => tools.foundry_release(a));

  server.registerTool('foundry_handoff', {
    description: 'Hand a claim back to the queue with a note for the next session (e.g. discovered scope overlap).',
    inputSchema: { claimId: z.string(), note: z.string() },
  }, async (a) => tools.foundry_handoff(a));

  server.registerTool('foundry_session_prompt', {
    description: 'Generate N ready-to-paste worker-session prompts for the top N mutually disjoint claimable items (hybrid spawn). Claims nothing.',
    inputSchema: { count: z.number().int().positive().optional() },
  }, async (a) => tools.foundry_session_prompt(a));

  server.registerTool('foundry_queue_push', {
    description: 'Register a product (idempotent by productKey) and queue its work items (itemIds must be new).',
    inputSchema: {
      product: z.object({
        productKey: z.string(), name: z.string(), repo: z.string(),
        riskTier: z.enum(RISK_TIERS), priority: z.number().int().optional(),
        charterRef: z.string().optional(), stage: z.string().optional(),
      }),
      items: z.array(z.object({
        itemId: z.string(), title: z.string(), epic: z.string().optional(),
        scope: scopeShape, lane: z.string().optional(),
        dependsOn: z.array(z.string()).optional(),
        qualityObligations: z.array(z.string()).optional(),
      })),
    },
  }, async (a) => tools.foundry_queue_push(a));

  server.registerTool('foundry_gate_request', {
    description: 'Request a founder gate (greenlight | architecture | adr | ship) for a product. Returns the gateId.',
    inputSchema: { productKey: z.string(), gateType: z.enum(GATE_TYPES), payloadRef: z.string().optional() },
  }, async (a) => tools.foundry_gate_request(a));

  server.registerTool('foundry_gate_decide', {
    description: 'FOUNDER ONLY: decide a pending gate (approved | rejected). Decisions are auditable records.',
    inputSchema: { gateId: z.string(), decision: z.enum(GATE_DECISIONS), note: z.string().optional() },
  }, async (a) => tools.foundry_gate_decide(a));

  await server.connect(new StdioServerTransport());
}

// Side-effectful entry: run when invoked directly. pathToFileURL so the
// comparison is correct on Windows (file:///D:/... with forward slashes) —
// naive string compare never matches a win32 path and the server would
// silently never start (devloop lesson).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd domains/foundry && npx vitest run test/mcp-tools.test.ts test/e2e.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Smoke-boot the server**

Run: `cd domains/foundry && timeout 5 npx tsx src/mcp/server.ts < NUL` (PowerShell: `npx tsx src/mcp/server.ts` then Ctrl-C, or pipe empty stdin)
Expected: process starts, waits on stdio, exits cleanly when stdin closes. No stack trace.

- [ ] **Step 6: Commit**

```bash
cd domains/foundry
git add src/mcp/ test/mcp-tools.test.ts test/e2e.test.ts
git commit -m "feat: foundry MCP server — 10-tool surface over the claim store"
```

---

### Task 12: CI green, PR, workbench wiring

**Files:**
- Modify: `domains/foundry/*` (fixes only)
- Create (workbench repo): `projects/foundry/project.yaml`
- Modify (workbench repo): `.mcp.json`

- [ ] **Step 1: Full local gate**

```bash
cd domains/foundry
npm run ci:local
```

Expected: typecheck green; all ~38 tests green; coverage report prints (target: >85% lines on src/ excluding mcp/server.ts — if below, the missing lines are usually error branches; add the missing error-path test, do NOT chase 100%).

- [ ] **Step 2: Push branch + open the PR (foundry repo)**

```bash
cd domains/foundry
git push -u origin feat/f1-control-plane
gh pr create --repo de-braighter/foundry --title "feat: F1 control plane — claim-MCP server (queue, atomic claims, gates, session prompts)" --body "$(cat <<'EOF'
## F1 — Foundry control plane

Event-sourced control plane per the approved design
(workbench: docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md §4):

- Append-only JSONL of devloop-compatible DomainEventEnvelopes (8 foundry:* event types)
- Cross-process atomicity via withStoreLock (atomic mkdir + stale takeover) — each
  Claude Code session spawns its own stdio MCP process, so atomicity lives in the store
- Claims at issue grain, fail-closed scope disjointness, TTL 240min + heartbeat + stale-reclaim
- Founder gates as auditable records
- foundry_session_prompt: the hybrid-spawn surface (prompts never claim)
- 10-tool MCP surface; pure handlers (tools.ts) covered, stdio boot excluded

Producer: orchestrator/claude-fable-5 [superpowers:writing-plans, superpowers:subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then run the verifier wave on this PR (orchestrator does this, not a plan step): `local-ci` + `reviewer` + `qa-engineer` in parallel with `isolation: "worktree"`; `charter-checker` is N/A (foundry is not kernel/pack-on-substrate yet — note this in the PR if skipped). After the wave: `post-findings`, merge, twin ritual (`drain` → `backfill` → `reconcile` from `domains/devloop`).

- [ ] **Step 3: Workbench wiring — project descriptor + MCP registration**

In the WORKBENCH repo (`D:/development/projects/de-braighter`), on a new branch `feat/foundry-wiring` (never `git add -A` here):

`projects/foundry/project.yaml`:

```yaml
# foundry — the multi-product machine's control plane (F1 of the Foundry design)
# Status: v1 — claim-MCP server live (queue, atomic claims, gates, session prompts).
# Form: standalone control-plane repo (NOT a substrate pack; ADR-176 applied to the
#       machine: arbitration + queue + gates, nothing else). Event log is
#       devloop-envelope-compatible for twin ingestion (F6).
# Design: docs/superpowers/specs/2026-06-09-foundry-multi-product-machine-design.md
#         (plan: docs/superpowers/plans/2026-06-10-foundry-f1-control-plane.md)

name: foundry
domain: control-plane
status: v1
repo: github.com/de-braighter/foundry
local: domains/foundry/

enabled:
  agents:
    suggested:
      - implementer
      - reviewer
      - qa-engineer
      - local-ci
      - test-pro
  skills:
    suggested:
      - md-quality-review
```

`.mcp.json` — add the foundry server alongside the KG server:

```json
{
  "mcpServers": {
    "devloop-knowledge-graph": { "...": "(unchanged)" },
    "foundry": {
      "command": "node",
      "args": [
        "domains/foundry/node_modules/tsx/dist/cli.mjs",
        "domains/foundry/src/mcp/server.ts"
      ]
    }
  }
}
```

(Edit the real file by adding ONLY the `foundry` key — the snippet above shows placement, not literal content for the KG entry.)

- [ ] **Step 4: Commit + PR (workbench repo)**

```bash
cd D:/development/projects/de-braighter
git checkout -b feat/foundry-wiring
git add projects/foundry/project.yaml .mcp.json
git commit -m "feat(workbench): register foundry control plane (project descriptor + MCP server)

Producer: orchestrator/claude-fable-5 [superpowers:subagent-driven-development]
Effort: light

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/foundry-wiring
gh pr create --repo de-braighter/workbench --title "feat(workbench): register foundry control plane" --body "Registers domains/foundry: project descriptor + foundry MCP server in .mcp.json. Companion to de-braighter/foundry PR #1.

Producer: orchestrator/claude-fable-5
Effort: light

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
git checkout main
```

- [ ] **Step 5: Acceptance check (manual, after merge + session restart)**

A fresh Claude Code session from the workbench root should see the `foundry_*` tools. Smoke: `foundry_status` → "(none)" sections; `foundry_queue_push` a toy product; `foundry_session_prompt` returns a protocol prompt; `foundry_claim`/`foundry_release` round-trip. This is the F1 done-bar; the spec §6 full proof (real dossier end-to-end) lands with F3/F4.

---

## Self-review notes (run during plan-writing)

- **Spec coverage:** §4 data model (Product/WorkItem/Claim/Gate → state.ts), 10-tool surface (server.ts), claim protocol incl. claim-at-session-start + prompts-never-claim (Task 10 test), TTL/stale (state + ops tests), devloop-ingestible exhaust (envelope reuse), §7 stances: stale-claims surface in status (Task 10), fail-closed lock + fail-loud corrupt log (Tasks 4–5), blocked-item re-queue (Task 6 test), handoff (Task 8). Deferred per spec §9: conductor, cross-machine, dashboards beyond statusText.
- **Type consistency:** `FoundryDeps` is the single deps shape; `NextItem` defined in ops (Task 9) before prompts uses it (Task 10); enums exported once from events.ts and reused by server.ts zod shapes.
- **Placeholder scan:** none — every step carries the code or the exact command.
