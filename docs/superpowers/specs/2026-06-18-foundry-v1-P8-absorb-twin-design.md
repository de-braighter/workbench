# Foundry v1 P8 — Absorb the devloop SDLC twin into the foundry repo (Slice 1B, absorb-only)

> Physically consolidates the SDLC twin's code (`domains/devloop`) INTO the foundry repo at
> `foundry/twin/`, so the doing-machine and its self-observing twin live in ONE repo — completing
> the physical side of the canonical-log collapse ([ADR-245](../../../layers/specs/adr/adr-245-foundry-canonical-log-collapse.md))
> that already unified the LOG. **Absorb NOW (reversible); DEFER the irreversible retirement**
> (archive the devloop GitHub repo, rewrite the `.claude` skills/MCP, remove the local clone) to a
> SEPARATE founder go-ahead. The correctness crux is a SMALL, ENUMERATED set of location-dependent
> path resolutions that must re-root from `domains/devloop` to `domains/foundry/twin` and still
> yield the SAME absolute paths — above all the canonical log (`domains/foundry/data/events.jsonl`).
> **Zero kernel change; zero LOGIC change (bit-identical move + surgical re-rooting only).**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (gains `foundry/twin/` — a verbatim copy of `domains/devloop`'s
  `src/`, `test/`, `db/`, `data/` fixtures, `package.json`, `tsconfig.json`, `vitest.config.ts`,
  plus 4 surgical re-rooting edits across 3 files). `layers/specs` (ADR-257, status proposed).
  `domains/devloop` is UNCHANGED and KEPT (the bit-identical acid + the ongoing twin ritual both
  need it parallel until the founder-gated retirement).
- **Predecessors:** [ADR-241](../../../layers/specs/adr/adr-241-sanction-domains-foundry-meta-product-rehome-sdlc-twin.md)
  (foundry is the sanctioned meta-product + the SDLC-twin's home), [ADR-245](../../../layers/specs/adr/adr-245-foundry-canonical-log-collapse.md)
  (the canonical-log collapse — one physical JSONL spine; P8 completes its PHYSICAL side by
  co-locating the code with the log), [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
  (kernel minimality — NOT triggered), [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md)
  (the four kernel concerns — none change).

---

## 1. Context — the log is already unified; this is the PHYSICAL consolidation

The doing-machine (`domains/foundry`) and its SDLC twin (`domains/devloop`) are already
LOGICALLY one system at the data plane:

- **Stage 1A / ADR-245** collapsed the two event logs into ONE physical JSONL spine at
  `domains/foundry/data/events.jsonl`. The twin's `DEFAULT_LOG` (`devloop/src/log.ts:15`) ALREADY
  points at the foundry log (`join(PKG_ROOT, '..', 'foundry', 'data', 'events.jsonl')`), and the
  KG config's `logPath` (`devloop/src/knowledge-graph/config.ts:46`) does the same.
- **ADR-253 (P4)** gave both writers a byte-identical lock convention — `logLockDir = logPath + '.lock'`
  via `withLogLock` — so concurrent appends from a foundry session and a devloop ritual cannot tear
  a line. The lock derivation is purely a function of `logPath`, so it survives any re-rooting that
  keeps `logPath` correct.

What is NOT yet unified is the CODE LOCATION. The twin still lives in a SEPARATE repo
(`domains/devloop`, a sibling clone), with its own `.git`, its own GitHub repo
(`de-braighter/devloop`), and its own `.claude` skill/MCP wiring. P8 is the PHYSICAL move: the
twin's code becomes a subtree of the foundry repo at `foundry/twin/`.

**Recon (verified against source) — the two repos are FULLY code-decoupled.** A grep across
`domains/devloop/src` for any `domains/foundry` or `@de-braighter/foundry` import returns ZERO
hits, and the reverse is also zero. The ONLY shared surface is the on-disk canonical log + the
byte-identical lock convention. There are no cross-package type imports, no shared build, no shared
config. This is what makes the absorb LOW-RISK: nothing in foundry's core needs to know the twin
exists, and the twin needs nothing from foundry's core except a correct path to the shared log.

---

## 2. Founder-gated scope — absorb NOW (reversible), retire LATER (irreversible)

The founder chose **Option 1**: do the reversible half now, gate the irreversible half.

**IN SCOPE (this slice, reversible):**

1. Copy `domains/devloop`'s code into `domains/foundry/twin/` (verbatim — §4).
2. Apply the 4 surgical re-rooting edits (§3 — the crux).
3. Wire the twin ritual to run from `foundry/twin/` (§5).
4. Prove bit-identical behaviour (§7 — the acid).

Every step is reversible: if anything regresses, delete `foundry/twin/` and the absorb never
happened — `domains/devloop` is untouched and remains the live twin.

**OUT OF SCOPE (founder-gated, irreversible — §8):** archiving the `de-braighter/devloop` GitHub
repo, rewriting `.claude/skills/{foundry-pool,foundry-worker,green-desk}` + the
`devloop-knowledge-graph` MCP registration, and removing the local `domains/devloop` clone. These
wait for a SEPARATE founder go-ahead. The `domains/devloop` repo is KEPT PARALLEL — it is REQUIRED
during this slice (the bit-identical acid runs the SAME command from BOTH locations; the twin
ritual keeps running from devloop until the absorbed copy is proven).

---

## 3. The crux — the COMPLETE path re-rooting map

This is the heart of the design. devloop has location-dependent path resolutions that compute
absolute paths RELATIVE to its on-disk location (`domains/devloop`). After the move to
`domains/foundry/twin`, those expressions — UNCHANGED — would resolve to the WRONG absolute paths.
Each must be corrected so it yields the SAME absolute path from the new location.

### 3.1 The depth shift (why the map is small + mechanical)

Both repos use `tsx` at RUNTIME (`devloop` runs `tsx src/cli.ts`, `tsx src/knowledge-graph/...`;
no compiled `dist/` is on any runtime path — verified in `devloop/package.json` `dev`/`kg:*`/`ritual:*`
scripts). So every `import.meta.url` resolves into the `src/` tree, and every `PKG_ROOT` /
`packRoot` / `HERE` anchor (built by counting `'..'` up from the source file's directory) resolves
to the **package root**. In devloop that package root is `domains/devloop`; after the move it is
`domains/foundry/twin`.

The ONLY thing that changes is the package root's DEPTH below the cluster root
(`D:/development/projects/de-braighter/`):

| Layout | Package root | Depth below cluster root |
|---|---|---|
| Before (devloop) | `domains/devloop` | 2 levels |
| After (twin) | `domains/foundry/twin` | 3 levels |

So:

- Any anchor that points INSIDE the package (`<pkgRoot>/data`, `<pkgRoot>/db`,
  `<pkgRoot>/test/fixtures`) is CORRECT UNCHANGED — the whole package moves as a unit, so the
  intra-package relative path is preserved.
- Any anchor that points OUTSIDE the package (the shared foundry log at `../foundry/data`, the
  cluster root at `../..`, the cluster manifest `repos.yaml` at `../../`) needs a CORRECTION,
  because the number of levels between the package root and those external targets changed.

### 3.2 The re-rooting map (`file:line` | current | corrected)

Cluster root abbreviated `C` = `D:/development/projects/de-braighter`. Anchor → package root in
BOTH layouts; the table shows what each external-pointing expression resolves to, why it breaks,
and the fix that re-rooting it to `foundry/twin` makes correct.

| # | file:line | current expression | resolves (devloop) | resolves UNCHANGED from twin | **corrected expression** | resolves (twin) |
|---|---|---|---|---|---|---|
| 1 | `src/log.ts:15` | `join(PKG_ROOT, '..', 'foundry', 'data', 'events.jsonl')` | `C/domains/foundry/data/events.jsonl` ✓ | `C/domains/foundry/twin/../foundry/data/...` = `C/domains/foundry/foundry/data/...` ✗ | `join(PKG_ROOT, '..', 'data', 'events.jsonl')` | `C/domains/foundry/data/events.jsonl` ✓ |
| 2 | `src/knowledge-graph/config.ts:46` | `join(packRoot, '..', 'foundry', 'data', 'events.jsonl')` | `C/domains/foundry/data/events.jsonl` ✓ | `C/domains/foundry/foundry/data/...` ✗ | `join(packRoot, '..', 'data', 'events.jsonl')` | `C/domains/foundry/data/events.jsonl` ✓ |
| 3 | `src/knowledge-graph/config.ts:36` | `resolve(packRoot, '..', '..')` | `C` (cluster root) ✓ | `C/domains` ✗ | `resolve(packRoot, '..', '..', '..')` | `C` (cluster root) ✓ |
| 4 | `src/cluster-repos.ts:16` | `join(PKG_ROOT, '..', '..', 'repos.yaml')` | `C/repos.yaml` ✓ | `C/domains/repos.yaml` ✗ | `join(PKG_ROOT, '..', '..', '..', 'repos.yaml')` | `C/repos.yaml` ✓ |

**That is the COMPLETE set of corrections — exactly 4 edits across 3 files.** Each adds or
swaps a path segment to absorb the one-level depth shift. There is NO logic change: every edit is a
single `node:path` argument list.

### 3.3 The anchors that need NO change (verified — they point INSIDE the package)

These were enumerated in the same grep and DELIBERATELY left untouched; changing them would BREAK
the move. Each resolves to a path inside the package, which travels with it:

| file:line | expression | points to | status |
|---|---|---|---|
| `src/log.ts:14` | `PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')` | package root | UNCHANGED (defines the anchor; `..` from `src/`) |
| `src/log.ts:97` | `DEFAULT_INBOX = join(PKG_ROOT, 'data', 'verdict-inbox.jsonl')` | `<pkgRoot>/data` | UNCHANGED (intra-package) |
| `src/cli.ts:67` | `DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')` | `<pkgRoot>/data` | UNCHANGED (intra-package) |
| `src/cluster-repos.ts:13` | `PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')` | package root | UNCHANGED (anchor; `..` from `src/`) |
| `src/knowledge-graph/config.ts:30` | `packRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')` | package root | UNCHANGED (anchor; `..`,`..` from `src/knowledge-graph/`) |
| `src/knowledge-graph/config.ts:42-43` | `indexPath`/`basePath = join(packRoot, 'data', ...)` | `<pkgRoot>/data` | UNCHANGED (intra-package) |
| `src/persist/plan-tree-store.ts:25-26` | `HERE` + `VENDORED_DDL = join(HERE, '..', '..', 'db', 'kernel-plan-tree.sql')` | `<pkgRoot>/db` | UNCHANGED (intra-package; `..`,`..` from `src/persist/`) |
| `src/inference/check4-flywheel.ts:25-27` | `PKG_ROOT` + `CHECK4_FIXTURE_PATH`/`CHECK4_GOLDEN_PATH = join(PKG_ROOT, 'test', 'fixtures', ...)` | `<pkgRoot>/test/fixtures` | UNCHANGED (intra-package; `..`,`..` from `src/inference/`) |
| `src/knowledge-graph/mcp/server.ts:67` | `import.meta.url === pathToFileURL(process.argv[1]).href` | direct-invoke guard | UNCHANGED (location-independent — compares self vs argv) |

**Note on the comment at `src/cluster-repos.ts:14`** ("The cluster root … sits two levels above
this pack (`domains/devloop`)") — this is PROSE, not a path. After the edit the comment must read
"three levels above … (`domains/foundry/twin`)". Update the comment alongside edit #4 for honesty;
it is not load-bearing for correctness.

### 3.4 Env overrides are layout-INDEPENDENT (a safety margin)

`FOUNDRY_LOG`, `DEVLOOP_CLUSTER_ROOT`, `DEVLOOP_MEMORY_DIR`, and `ACTIVITY_WINDOW_DAYS` all take an
EXPLICIT absolute path / value and bypass the location-derived defaults entirely
(`log.ts:15` `process.env['FOUNDRY_LOG'] ?? ...`; `config.ts:36,41,46`). They need NO change and
are the reason the tests stay isolated (§6): a test that sets `FOUNDRY_LOG` to a temp dir is
indifferent to whether the code lives in devloop or twin.

### 3.5 Two re-rooting edits are PINNED by existing tests (built-in acid)

Two of the four corrections are directly asserted by tests already in the absorbed suite, so a
mis-rooting flips them RED automatically:

- **Edit #1 (`log.ts:15`)** is pinned by `test/canonical-log-path.test.ts:30` and
  `test/log-env.test.ts:22`, both asserting `DEFAULT_LOG.replace(/\\/g,'/')` matches
  `/foundry\/data\/events\.jsonl$/`. The corrected expression
  (`join(PKG_ROOT,'..','data','events.jsonl')` from `foundry/twin`) resolves to
  `…/domains/foundry/data/events.jsonl`, which STILL ends in `foundry/data/events.jsonl` → GREEN.
  The WRONG unchanged expression resolves to `…/foundry/foundry/data/events.jsonl`, which ALSO
  matches the `$`-anchored regex (it still ends in `foundry/data/events.jsonl`) — so this regex
  alone does NOT catch the double-`foundry` bug. The acid that DOES catch it is the bit-identical
  derivation (§7) plus an absolute-path assertion (§7 mutation), not the suffix regex. Flagged so
  the implementer does not over-trust the suffix test.
- **Edit #3 (`config.ts:36`)** is NOT pinned by `test/knowledge-graph/config.test.ts`, because that
  test INJECTS an explicit `packRoot` (`/cluster/domains/devloop`) and asserts the RESOLVER LOGIC
  (`clusterRoot === resolve(packRoot,'..','..')`) — it never exercises the auto-derived default. So
  edit #3 must change ONLY the DEFAULT derivation, and the injected-packRoot test continues to pass
  UNCHANGED (it asserts the `..,..` relationship from a `domains/<pack>` packRoot, which is correct
  for an injected 2-deep packRoot regardless of where the real code lives). The DEFAULT correction
  is exercised by the live `kg:rebuild` + the activity-overlay tests that read the real corpus, and
  by the §7 acid.

---

## 4. The move mechanics — verbatim copy + surgical re-rooting

### 4.1 What is copied (verbatim — bit-identical)

A straight `cp -r` of the devloop package tree into `domains/foundry/twin/`:

- `devloop/src/` → `foundry/twin/src/` (verbatim; THEN apply the 4 edits of §3.2)
- `devloop/test/` → `foundry/twin/test/` (verbatim — the ~396-case suite across 75 files)
- `devloop/db/kernel-plan-tree.sql` → `foundry/twin/db/` (verbatim — the vendored DDL, edit #26
  anchor unchanged)
- `devloop/test/fixtures/` (incl. `check4-*.json`) → `foundry/twin/test/fixtures/` (verbatim — the
  golden + cycle-time fixtures)
- `devloop/package.json`, `tsconfig.json`, `vitest.config.ts`, `knip.json`,
  `sonar-project.properties`, `.npmrc` → `foundry/twin/` (verbatim)
- `devloop/tools/`, `devloop/prisma/`, `devloop/hooks/`, `devloop/scripts/` → `foundry/twin/`
  (verbatim — the opt-in dogfood + sonar tooling; intra-package anchors, no edit)

### 4.2 What is NOT copied (deliberately)

- **The live canonical log.** `domains/devloop/data/events.jsonl` is NOT copied — there IS no live
  log there; the canonical log lives ONLY at `domains/foundry/data/events.jsonl` (ADR-245). What
  `devloop/data/` holds is transient/derived artefacts (`verdict-inbox.jsonl`, `snapshot.json`,
  `dashboard.html`, KG index) which are `.gitignore`d and regenerate. Copy the directory shape (so
  `mkdirSync(dirname(...))` targets exist) but NOT a live log.
- **`devloop/.git`, `.githooks/`, `.gitattributes`, `Dockerfile`, `docker-compose.kg.yml`,
  `.dockerignore`** — repo-root metadata that belongs to the devloop REPO, not the package. The
  twin is now a SUBTREE of the foundry repo; foundry's own repo-root metadata governs. (See §4.4 on
  the `prepare` hazard.)

### 4.3 The surgical edits (the ONLY non-verbatim change)

After the verbatim copy, apply EXACTLY the 4 edits of §3.2 — and the one prose-comment update of
§3.3. No other line of the absorbed code changes. This is the bit-identical guarantee: `git diff`
between `domains/devloop/src` and `domains/foundry/twin/src` should show ONLY those 4 path-segment
changes (+ the comment).

### 4.4 The install-time hazard — neuter the absorbed `prepare` script

**Recon finding (must address):** `devloop/package.json` has
`"prepare": "node tools/install-hooks.mjs"`, and `tools/install-hooks.mjs:7` runs
`git config core.hooksPath .githooks` against the cwd's git repo. If the twin package is installed
from `foundry/twin/` (workspace OR subdir), that `prepare` would repoint the FOUNDRY repo's
`core.hooksPath` at `foundry/twin/.githooks` — silently hijacking foundry's own hook wiring. The
absorbed `package.json` MUST DROP the `prepare` script (or null it): the twin is no longer a repo
root, so it must not configure git hooks. Foundry's repo-root hook wiring is unaffected and
governs. (This is a `package.json` edit, not a `src` edit — it does not break bit-identical
behaviour of the twin's RUNTIME code, only its install-time side effect.)

---

## 5. STRUCTURE decision — workspace vs self-contained subdir

**Recon:** foundry uses **npm** (`package-lock.json`, no `pnpm-workspace.yaml`, no `workspaces`
field). devloop also uses npm. Foundry's CORE `ci:local` is `typecheck && test:coverage`
(`foundry/package.json:14`) over `@de-braighter/foundry`'s own `src/`+`test/` only. The twin's deps
(`substrate-runtime ^0.13.0`, `yaml`, `@aws-sdk/client-s3`, `@modelcontextprotocol/sdk`, `zod`;
devDeps `@prisma/client`, `prisma`, `@vitest/coverage-v8`, `tsx`, `typescript`, `vitest`) are a
SUPERSET of foundry core's (which lacks `substrate-runtime`, `yaml`, the AWS SDK, prisma).

### 5.1 The two options

**Option A — npm workspace.** Add `"workspaces": ["twin"]` to foundry's root `package.json`; keep
`foundry/twin/package.json` as a second package (retaining its `@de-braighter/devloop` name for
maximal bit-identical — renaming is a retirement step). A single root `npm install` hoists both
dependency sets.

- **Pro:** one install; idiomatic monorepo; one `node_modules`.
- **Con:** declaring `workspaces` CHANGES how foundry's root `npm install` resolves — it now hoists
  the twin's superset deps (substrate-runtime, AWS SDK, prisma) into the shared tree, regenerates
  `foundry/package-lock.json`, and any hoisting conflict or peer-dep clash surfaces on foundry
  CORE's install. That is a real (if small) risk to the thing we MUST keep green: foundry core's
  `ci:local`. A workspace also makes the twin's `prepare`/hooks hazard (§4.4) a root-install
  concern.

**Option B — self-contained subdir (RECOMMENDED).** `foundry/twin/` is a self-contained package
with its OWN `package.json` + its OWN `node_modules`, installed and tested INDEPENDENTLY
(`cd foundry/twin && npm install && npx vitest run`). Foundry's root `package.json` is UNTOUCHED
(no `workspaces` field), so foundry core's install + `ci:local` are BYTE-IDENTICAL to today.

- **Pro:** foundry CORE's install, lockfile, and `ci:local` are PROVABLY unchanged — the twin is
  invisible to them. Lowest possible blast radius. The twin's deps never touch foundry core's
  dependency tree. Reversible by `rm -rf foundry/twin`. Mirrors devloop's current self-contained
  shape exactly (so it IS the bit-identical layout).
- **Con:** two installs (foundry core + twin) and two `node_modules`; the twin's coverage/test is
  not folded into foundry core's `ci:local` (it runs as its own gate, exactly as it does in devloop
  today).

### 5.2 Recommendation: Option B (self-contained subdir)

**Lower risk wins.** The slice's hard constraint is that foundry CORE's `ci:local`
(`typecheck && test:coverage`) stays GREEN and UNCHANGED. Option B guarantees that by CONSTRUCTION
— foundry's root `package.json` and lockfile are not edited, so foundry core cannot regress from
the absorb. The two-install cost is exactly what devloop carries today (its suite has always run as
its own gate), so Option B is also the MOST bit-identical: the twin's build/test environment is the
SAME self-contained npm package it is now, only relocated. A workspace is a nicer end-state but
buys monorepo ergonomics at the cost of touching foundry core's dependency resolution — a trade the
absorb-only slice should not take. **Promote to a workspace LATER, as part of (or after) the
founder-gated retirement, once bit-identical is proven and there is appetite for the install
unification.** Final call left to the implementer, but the recommendation is strong: ship Option B.

---

## 6. Test-isolation preservation — the absorbed tests MUST NOT touch the live log

**Recon:** the absorbed suite ALREADY isolates itself from the canonical log — 15 of the 75 test
files drive the log path through `FOUNDRY_LOG` overrides or `mkdtempSync`/`tmpdir()` temp dirs. The
canonical patterns:

- `test/canonical-log-path.test.ts` sets `process.env['FOUNDRY_LOG']` to a fresh
  `mkdtempSync(join(tmpdir(),'devloop-canon-'))` path, appends, asserts, and clears the env in
  `afterEach`. It NEVER writes to the default log.
- `test/log-env.test.ts` sets `FOUNDRY_LOG` + `vi.resetModules()` to re-import `log.ts` with the
  override, asserts `DEFAULT_LOG === custom`, and clears in `afterEach`.
- `test/knowledge-graph/config.test.ts` injects an explicit `packRoot` + `env` into the pure
  `resolveConfig` — it touches no filesystem at all.

The move MUST PRESERVE this, and §3.4 is exactly WHY it does: env overrides are layout-independent,
so a test that sets `FOUNDRY_LOG` to a temp dir behaves identically whether `log.ts` lives in
devloop or twin. The re-rooting changes ONLY the DEFAULT (`??` right-hand side); every test that
sets `FOUNDRY_LOG` bypasses the default and is unaffected by the re-rooting.

**The one risk to actively guard:** a test that DOES exercise the default log path (no
`FOUNDRY_LOG` set) and APPENDS would, post-move with correct re-rooting, write to the REAL
`domains/foundry/data/events.jsonl` — corrupting the live canonical log. Recon confirms the
default-path tests are READ-ONLY assertions on the resolved STRING (`expect(DEFAULT_LOG).toMatch(...)`),
not appends — the only APPEND tests set `FOUNDRY_LOG` first. **Acceptance check for the
implementer:** grep the absorbed `test/` for any `append(` / `appendUnique(` / `wake`/`backfill`
call that does NOT set `FOUNDRY_LOG` (or pass an explicit `logPath`) in the same test; assert that
set is EMPTY. If non-empty, that test must be given an explicit temp `FOUNDRY_LOG` BEFORE the move
is merged (the absorbed suite must not be able to append to the live log). This check is itself an
acid (§7, case 3).

---

## 7. The bit-identical acid — a FALSIFIABLE proof of behavioural identity

The absorb claims the twin's behaviour is byte-identical before and after the move. Three pinned
acids make that claim falsifiable; a deliberate mis-rooting flips them RED.

### Acid 1 — same command, same input, byte-identical output (the core proof)

Take a DETERMINISTIC, self-observing command — `reconcile` (derives `effect.observed` from the log
alone) — and run it from BOTH locations against the SAME input:

1. Copy a representative canonical log to a temp file `T` (a frozen fixture log — e.g. a snapshot
   of `domains/foundry/data/events.jsonl`, or a small hand-built fixture with a few merged-PR +
   effect-declared events).
2. From `domains/devloop`: `FOUNDRY_LOG=T npm run dev -- reconcile > out.devloop.txt`.
3. From `domains/foundry/twin`: `FOUNDRY_LOG=T npm run dev -- reconcile > out.twin.txt`
   (post-move, post-re-rooting).
4. **Assert `out.devloop.txt` is byte-identical to `out.twin.txt`** (`diff` exits 0 / `cmp` is
   silent). `reconcile` is a pure derivation over the log — same log + same code = same bytes.

Repeat with one or two more deterministic readouts (`flowSummary` / `flow`, `findingsSummary` /
`findings <repo>`, or a `backfill` DRY against a fixed fixture log) for breadth. Because both runs
read the SAME `FOUNDRY_LOG=T`, the test is INDIFFERENT to the default-log re-rooting and isolates
the question to "did the move + edits change the derivation?" — the answer must be no.

### Acid 2 — the full absorbed suite passes (broad behaviour-pinning)

Run the absorbed `foundry/twin` suite: `cd foundry/twin && npx vitest run`. All ~396 cases across
75 files must pass — the SAME count and the SAME assertions as `domains/devloop`'s suite. This is
strong behaviour-pinning: it exercises the event constructors, folds, derivations, KG config
resolver, dedup, lock, and the env-override paths. A green absorbed suite proves the move preserved
every unit-level behaviour the twin already tests.

### Acid 3 — the absorbed suite cannot corrupt the live log (isolation pin)

Per §6: grep the absorbed `test/` for any append-path call without a `FOUNDRY_LOG`/explicit-`logPath`
guard; assert that set is EMPTY. Then run the full absorbed suite and assert
`domains/foundry/data/events.jsonl` is BYTE-UNCHANGED before vs after the run (`cmp` / sha256
match). Proves the absorbed tests isolate to temp dirs and never touch the canonical log.

### The mutation — a deliberate mis-rooting flips the acid RED

Inject the WRONG re-rooting at edit #1: revert `log.ts:15` to the unchanged
`join(PKG_ROOT,'..','foundry','data','events.jsonl')`. From `foundry/twin` this resolves to
`…/domains/foundry/foundry/data/events.jsonl` (the double-`foundry` bug). Then:

- Acid 1's DEFAULT-path variant (run `reconcile` with NO `FOUNDRY_LOG`) reads the WRONG (likely
  non-existent → empty) log and produces DIFFERENT bytes than devloop → RED.
- An absolute-path assertion — `expect(DEFAULT_LOG).toBe(resolve(twinPkgRoot,'..','data','events.jsonl'))`
  (the EXACT path, not the `$`-suffix regex which §3.5 showed is too weak) — flips RED.

Because the `$`-anchored suffix regex in the existing tests does NOT catch the double-`foundry`
case (§3.5), the acid MUST include the exact-absolute-path assertion, not rely on the inherited
suffix test. This is the single most important acid line: it is what makes the crux falsifiable.

---

## 8. Deferred — the founder-gated retirement (explicitly OUT of scope)

These are IRREVERSIBLE and wait for a SEPARATE founder go-ahead. Named here so the slice boundary
is unambiguous and nothing is forgotten:

1. **Archive `de-braighter/devloop` on GitHub** (read-only). Until then the repo stays live — the
   bit-identical acid (§7) and the ongoing twin ritual both run from it in parallel.
2. **Rewrite `.claude/skills/{foundry-pool,foundry-worker,green-desk}`** — any skill that invokes
   `cd domains/devloop && npm run dev -- <cmd>` must repoint to the absorbed location (§5's
   `cd domains/foundry/twin && npm run dev -- <cmd>`, or a foundry-root `npm run twin -- <cmd>`
   passthrough if added). The twin ritual invocation changes from `cd domains/devloop` to
   `cd domains/foundry/twin`; behaviour is identical (same `cli.ts`).
3. **Repoint the `devloop-knowledge-graph` MCP registration** — the MCP server entry
   (`kg:mcp` → `tsx src/knowledge-graph/mcp/server.ts`) registered in `.claude/settings*.json` must
   point at `domains/foundry/twin/src/knowledge-graph/mcp/server.ts` instead of
   `domains/devloop/...`.
4. **Remove the local `domains/devloop` clone** — only AFTER 1–3 land and bit-identical is proven.

**The `domains/devloop` repo is KEPT PARALLEL through this entire slice.** Removing it is the LAST
retirement step, not part of the absorb.

---

## 9. ADR-176 analysis — NOT triggered

P8 is a pack/infra-level repo CONSOLIDATION — it adds, changes, or removes NOTHING in the kernel:

- **(a) Is this one of the four kernel concerns?** No. Recurse-the-plan, flat-the-observation,
  inference, reproducibility (ADR-127; north-star §20 P3) are all UNCHANGED. Moving a pack's source
  files between two on-disk locations touches no kernel concern. `@de-braighter/substrate-contracts`
  and `@de-braighter/substrate-runtime` are UNTOUCHED (the twin still consumes
  `substrate-runtime ^0.13.0` as a published dependency, exactly as before).
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate/query/version?**
  No. The move is internal to ONE pack's repository layout. The kernel validates, queries, and
  versions none of it.

Both legs fail → pack territory. The canonical log, the `logLockDir = logPath + '.lock'` lock
convention (ADR-253), and every event contract are BYTE-UNCHANGED — the absorb deliberately keeps
the shared data-plane surface identical (the re-rooting EXISTS to preserve the same absolute log
path). foundry already hosts the SDLC twin home per ADR-241; P8 completes the PHYSICAL side of the
log collapse ADR-245 began. **"Store generators, derive graphs" is UNAFFECTED** — no stored
relationship is added; the twin's derivations (`reconcile`, `flow`, KG overlay) remain pure views
over the same log. Charter-checker is the governance gate.

---

## 10. Slice scope (for the implementer)

- **foundry:** create `domains/foundry/twin/` as a self-contained subdir package (Option B, §5);
  `cp -r` `domains/devloop`'s `src/`, `test/`, `db/`, `prisma/`, `tools/`, `hooks/`, `scripts/`,
  `test/fixtures/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `knip.json`,
  `sonar-project.properties`, `.npmrc` (§4.1); do NOT copy `.git`/`.githooks`/Docker metadata or a
  live log (§4.2); apply EXACTLY the 4 re-rooting edits of §3.2 + the prose-comment update of §3.3
  (the ONLY non-verbatim changes); DROP the `prepare` script from the absorbed `package.json`
  (§4.4); `cd foundry/twin && npm install` (independent install). Foundry root `package.json` is
  UNTOUCHED.
- **specs:** ADR-257 (proposed) — codifies the absorb-only consolidation + the re-rooting crux +
  the founder-gated retirement boundary + the ADR-176 non-trigger.
- **Acceptance criteria:** (1) foundry CORE `ci:local` (`typecheck && test:coverage`) GREEN and
  UNCHANGED (the root `package.json`/lockfile are not edited — provable by `git diff`). (2) The
  absorbed suite passes (`cd foundry/twin && npx vitest run` — ~396 cases, same count). (3) Acid 1
  byte-identical output from both locations on the same `FOUNDRY_LOG=T`. (4) Acid 3 isolation pin —
  the absorbed suite leaves `domains/foundry/data/events.jsonl` byte-unchanged. (5) The exact-path
  assertion on `DEFAULT_LOG` (not the suffix regex) is GREEN, and the mutation (revert edit #1)
  flips it RED. (6) `domains/devloop` is UNCHANGED (`git -C domains/devloop status` clean of the
  absorb).

P8 stands on ADR-245 (the log it co-locates with) and ADR-241 (foundry is the twin's home). It
depends on neither the wake mechanism (P6) nor the hierarchy reconciliation (P5); the absorb is
orthogonal to foundry's conductor logic.

---

## 11. What does NOT change

- The canonical log, its path (`domains/foundry/data/events.jsonl`), and its contents — the
  re-rooting EXISTS to keep this byte-identical.
- The `logLockDir = logPath + '.lock'` lock convention (ADR-253) — a pure function of `logPath`,
  preserved by correct re-rooting.
- foundry CORE's `package.json`, lockfile, `src/`, `test/`, and `ci:local` — Option B leaves them
  untouched.
- `@de-braighter/substrate-contracts` / `@de-braighter/substrate-runtime` — the twin consumes them
  as published deps, unchanged.
- The twin's RUNTIME logic — every behaviour is bit-identical; only 4 path segments + one comment +
  the install-time `prepare` change.
- `domains/devloop` — KEPT PARALLEL and UNCHANGED until the founder-gated retirement.
