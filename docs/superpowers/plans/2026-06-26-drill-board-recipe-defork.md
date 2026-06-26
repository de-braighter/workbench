# Drill-board recipe de-fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the published board-kit recipe schema with a pure-data calc expression language (+ six smaller widenings), then de-fork the live kids-football drill board to render from a declarative `EditorRecipe` under a byte-parity gate.

**Architecture:** Three sub-projects in strict order. SP1 (`layers/design-system`) adds the schema + calc language and **publishes** `@de-braighter/design-system-core@2.8.0`. SP2 (`domains/studio`) authors a cookbook recipe + showcase. SP3 (`domains/exercir`) swaps `makeKidsRegistry()` to `interpretRecipe(drillRecipe)` and proves byte-parity. SP2/SP3 consume the *published* core (no `file:` links) so SP1 publishes first; SP2 and SP3 are then parallel.

**Tech Stack:** TypeScript, Angular 21, Nx (design-system) / pnpm-workspace (studio) / Nx (exercir), vitest, ng-packagr, api-extractor, GitHub Packages.

## Global Constraints

- **ADR-176-safe:** board-kit is a brick — it *composes*, never authors kernel concepts. The kernel's four concerns are untouched. No new kernel state.
- **No `eval` / `new Function`** anywhere in the calc evaluator. Hand-written parser only. Recipes are data, possibly tenant-authored.
- **Calc is total + deterministic:** no `Date`/`Math.random`/locale; `resolveValue`/calc never throw at runtime; author-time errors surface only via `validateRecipe`.
- **Byte-parity invariant:** the de-forked registry must produce identical `draw()` / `bounds()` / `describe()` / `edit` results to hand-written `makeKidsRegistry()`.
- **Publish is main-session only:** `npm publish` of core@2.8.0 is classifier-gated to the founder's hand — never delegate it to a subagent.
- **Repos:** design-system = Nx (`npx nx ...`); studio = **pnpm-workspace, pinned npm** (`npm test`, `npm run build` — NOT pnpm for scripts); exercir = Nx.
- **PR-gated everywhere**, including specs/ADRs. No direct-to-main. Branch → PR → merge. Twin ritual after every merge. PR body carries `Producer:` / `Effort:` / `Effect:` lines.
- **Workbench hygiene:** never `git add -A`; explicit paths only. Wave agents use `isolation: "worktree"` and must not run git ops in shared clones.
- **Existing parity specs stay green:** `plan-kinds-parity.spec.ts`, `catalog-parity.spec.ts`, `catalog-document.spec.ts` — calc/schema additions are additive.

---

# SP1 — design-system: recipe schema + calc language → publish 2.8.0

Path root: `layers/design-system/libs/design-system-core/src/public/board-kit/`

**File structure:**
- Create `calc/tokenizer.ts` — `tokenize(src): Token[]`
- Create `calc/parser.ts` — `parse(tokens): CalcNode` (AST), depth cap
- Create `calc/evaluate.ts` — `evalCalc(ast, env): number | string` (overloaded `+`, math fns, total)
- Create `calc/compile.ts` — `compileCalc(src): CompiledCalc` (parse-once; `{ run(env), errors }`)
- Modify `recipe.ts` — extend `RecipeValue` (`{calc}`, `{i18n}`), `PrimitiveTemplate` (`when?`), `RecipeAction` (`resize`,`reshape`), `RecipeShape` (`hit?`), `InterpretOptions` (`translate?`)
- Modify `interpret-recipe.ts` — `resolveValue` (calc, i18n, dotted-path bind, pseudo-vars), conditional primitive inclusion, resize/reshape edit, hit-region hitTest
- Modify `validate-recipe.ts` — new codes
- Modify `index.ts` + `etc/*.api.md` (api-extractor)

### Task 1: Calc-language ADR (designer-first)

**Files:** Create `layers/specs/adr/adr-NNN-board-kit-calc-expression-value.md` (reserve the next number via the adr-scaffolder skill / `foundry_reserve_adr`).

**Agent:** `substrate-architect` (or `designer`).

- [ ] **Step 1:** Write the ADR. Title: "board-kit recipe `calc` expression value". Context: the EditorRecipe schema cannot express computed geometry (arrow trig); the drill-board de-fork needs it. Decision: add `{ calc: string }` — a pure expression language (grammar, closed fn set, overloaded `+` for numeric add *and* string concat, no eval, total/deterministic, compile-once, depth cap, new validate codes). Apply the **ADR-176 inclusion test**: this is brick territory (board-kit composes), NOT kernel — the four kernel concerns are untouched; justify "as simple as possible but as complex as required" (one new value type, closed vocabulary, no control flow). Consequences: published-API growth, the maintainability cost of overloaded `+`. Alternatives considered: named-helper escape hatch, hybrid registry, shape-local `vars` + numeric calc (record why string-concat calc was chosen). Link the design spec.
- [ ] **Step 2:** Update the ADR index. Run `spec-auditor` for numbering/xref/frontmatter.
- [ ] **Step 3:** Branch, commit, PR to `layers/specs`. Single `/code-review` pass (review floor). Merge on green.

### Task 2: Calc tokenizer

**Files:** Create `calc/tokenizer.ts`; Test `calc/tokenizer.spec.ts`.

**Interfaces — Produces:**
```ts
export type Token =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ident'; v: string }
  | { t: 'op'; v: '+'|'-'|'*'|'/'|'%' } | { t: 'lparen' } | { t: 'rparen' } | { t: 'comma' };
export function tokenize(src: string): Token[];   // throws TokenizeError on bad char/unterminated string
export class TokenizeError extends Error {}
```

- [ ] **Step 1: Failing test**
```ts
import { tokenize } from './tokenizer';
it('tokenizes arithmetic, idents, calls, strings', () => {
  expect(tokenize("x2 - 6*cos(atan2(y2-y1, x2-x1))").filter(t=>t.t==='ident').map(t=>(t as any).v))
    .toEqual(['x2','cos','atan2','y2','y1','x2','x1']);
  expect(tokenize("'M ' + tipX").map(t=>t.t)).toEqual(['str','op','ident']);
  expect(tokenize("3.5 + -2").filter(t=>t.t==='num').map(t=>(t as any).v)).toEqual([3.5,2]);
});
it('rejects bad chars and unterminated strings', () => {
  expect(() => tokenize('a & b')).toThrow(TokenizeError);
  expect(() => tokenize("'open")).toThrow(TokenizeError);
});
```
- [ ] **Step 2:** Run, verify FAIL (module/exports missing). `npx nx test design-system-core -- calc/tokenizer`.
- [ ] **Step 3:** Implement a single-pass scanner: numbers (`[0-9]` + optional `.` fractional), single-quoted strings (no escapes needed; reject newline/EOF before close), identifiers (`[A-Za-z_][A-Za-z0-9_.]*` — dot allowed for dotted-path/pseudo-vars), operators `+ - * / %`, parens, comma; skip whitespace; throw `TokenizeError` otherwise. Unary minus is handled by the parser, so `-` is just an op token.
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): calc tokenizer`.

### Task 3: Calc parser (AST, depth cap)

**Files:** Create `calc/parser.ts`; Test `calc/parser.spec.ts`.

**Interfaces — Consumes:** `Token`, `tokenize`. **Produces:**
```ts
export type CalcNode =
  | { k:'num'; v:number } | { k:'str'; v:string } | { k:'var'; name:string }
  | { k:'bin'; op:'+'|'-'|'*'|'/'|'%'; l:CalcNode; r:CalcNode }
  | { k:'neg'; e:CalcNode }
  | { k:'call'; fn:string; args:CalcNode[] };
export function parse(tokens: Token[], maxDepth?: number): CalcNode;  // default maxDepth 64
export class ParseError extends Error {}
```

- [ ] **Step 1: Failing test**
```ts
import { parse } from './parser'; import { tokenize } from './tokenizer';
const p = (s:string)=>parse(tokenize(s));
it('respects precedence and assoc', () => {
  expect(p('1 + 2 * 3')).toEqual({k:'bin',op:'+',l:{k:'num',v:1},r:{k:'bin',op:'*',l:{k:'num',v:2},r:{k:'num',v:3}}});
});
it('parses calls, unary minus, string concat', () => {
  expect(p("'a' + b").k).toBe('bin');
  expect(p('-x').k).toBe('neg');
  expect(p('cos(a, b)')).toEqual({k:'call',fn:'cos',args:[{k:'var',name:'a'},{k:'var',name:'b'}]});
});
it('caps recursion depth', () => {
  expect(() => parse(tokenize('('.repeat(200) + '1' + ')'.repeat(200)))).toThrow(/depth/i);
});
it('rejects trailing tokens / unbalanced parens', () => {
  expect(() => p('1 2')).toThrow(); expect(() => p('(1')).toThrow();
});
```
- [ ] **Step 2:** Run, verify FAIL. `npx nx test design-system-core -- calc/parser`.
- [ ] **Step 3:** Recursive-descent / Pratt: `expr → term (('+'|'-') term)*`, `term → unary (('*'|'/'|'%') unary)*`, `unary → '-' unary | primary`, `primary → num | str | ident ['(' args ')'] | '(' expr ')'`. Thread a depth counter into each recursion; throw `ParseError('max calc depth exceeded')` past `maxDepth`. Error on leftover tokens after the root expr.
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): calc parser with depth cap`.

### Task 4: Calc evaluator (overloaded +, math fns, total)

**Files:** Create `calc/evaluate.ts`, `calc/compile.ts`; Test `calc/evaluate.spec.ts`.

**Interfaces — Consumes:** `CalcNode`, `parse`, `tokenize`. **Produces:**
```ts
export type CalcEnv = (name: string) => number | string | undefined;
export function evalCalc(ast: CalcNode, env: CalcEnv): number | string;  // total — never throws
export interface CompiledCalc { run(env: CalcEnv): number | string; errors: string[] }
export function compileCalc(src: string): CompiledCalc;  // parse once; errors=[] when valid
export const CALC_FNS: ReadonlySet<string>; // sin cos tan atan2 sqrt hypot abs min max round floor ceil
```

- [ ] **Step 1: Failing test**
```ts
import { compileCalc, evalCalc } from './evaluate';  // re-export from compile if split
const run = (s:string, env:Record<string,number|string>={}) =>
  compileCalc(s).run((n)=> env[n]);
it('arithmetic + trig (radians)', () => {
  expect(run('2 + 3 * 4')).toBe(14);
  expect(run('cos(0)')).toBe(1);
  expect(Math.round(run('atan2(1,0)') as number * 1000)/1000).toBe(1.571);
});
it('overloaded + : string concat with number coercion', () => {
  expect(run("'M ' + x + ',' + y", {x:10, y:20})).toBe('M 10,20');
  expect(run('1 + 2')).toBe(3);                       // numeric when both numeric
});
it('is total: missing var → 0, bad call args → NaN-free fallback', () => {
  expect(run('missing + 1')).toBe(1);                 // missing → 0
  expect(typeof run('cos(missing)')).toBe('number');
});
it('compile reports errors without throwing', () => {
  const c = compileCalc('1 +'); expect(c.errors.length).toBeGreaterThan(0);
  expect(() => c.run(()=>0)).not.toThrow();            // total even when invalid
});
it('unknown function is an error', () => {
  expect(compileCalc('frobnicate(1)').errors.some(e=>/unknown function/i.test(e))).toBe(true);
});
```
- [ ] **Step 2:** Run, verify FAIL. `npx nx test design-system-core -- calc/evaluate`.
- [ ] **Step 3:** `evalCalc`: `num`/`str` → literal; `var` → `env(name) ?? 0`; `neg` → `-Number(eval l)`; `bin` for `- * / %` coerce both to number; for `+`, if BOTH operands are numbers → numeric add, else string-concat (`String(l)+String(r)`); `call` → look up in `CALC_FNS`, coerce args to number, apply `Math.*` (`atan2`→`Math.atan2`, `hypot`→`Math.hypot`, etc.). `compileCalc`: `parse(tokenize(src))` inside try/catch → on failure store message in `errors` and `run` returns `0`; validate unknown function names + collect into `errors`; cache the AST so `run` is allocation-light. Division by zero → guard to `0` (stay total + deterministic). NEVER throw from `run`.
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): total deterministic calc evaluator`.

### Task 5: recipe.ts schema types + resolveValue wiring (calc, i18n, dotted-path bind, pseudo-vars)

**Files:** Modify `recipe.ts`, `interpret-recipe.ts`; Test `interpret-recipe.spec.ts` (extend) + `recipe-resolve.spec.ts` (new).

**Interfaces — Produces (recipe.ts additions):**
```ts
export type RecipeValue = number | string
  | { bind: string }                                   // bind now accepts dotted path 'points.0.0'
  | { tpl: string }
  | { when: string; then: RecipeValue; else: RecipeValue }
  | { calc: string }                                   // NEW (A)
  | { i18n: string; params?: Record<string, RecipeValue> }; // NEW (F)
export interface InterpretOptions {
  idFactory?: () => string;
  translate?: (key: string, params?: Record<string, unknown>) => string;  // NEW (F)
}
```
The resolution env exposes `node.props` + reserved `__selected` / `__focused` (C). `resolveValue(value, props, ctx?)` gains an optional ctx carrying `{ selected, focused, translate }`.

- [ ] **Step 1: Failing tests**
```ts
it('calc value resolves over props', () => {
  expect(resolveValue({calc:'x + 5'}, {x:10})).toBe(15);
});
it('dotted-path bind reads nested props', () => {
  expect(resolveValue({bind:'points.0.0'}, {points:[[3,4],[7,8]]})).toBe(3);
});
it('__selected pseudo-var is readable', () => {
  expect(resolveValue({bind:'__selected'}, {}, {selected:true})).toBe(true);
  expect(resolveValue({calc:'__selected'}, {}, {selected:true})).toBe(1); // truthy→1 in calc
});
it('i18n value calls translate', () => {
  const tr = (k:string,p?:any)=>`${k}:${JSON.stringify(p)}`;
  expect(resolveValue({i18n:'kf.x', params:{n:{bind:'n'}}}, {n:7}, {translate:tr}))
    .toBe('kf.x:{"n":7}');
});
```
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3:** Extend `recipe.ts` types. In `resolveValue`: add `calc` branch (`compileCalc(...).run(env)` where env reads dotted-path from props then `__`-pseudo-vars from ctx); generalize `bind` to walk a dotted path (`'a.0.b'`) over props/pseudo-vars; add `i18n` branch (`ctx.translate?.(key, resolvedParams) ?? key`). Pseudo-vars coerce to `0/1` for calc, raw for bind. Keep totality.
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): calc/i18n values + dotted-path bind + editor-state vars`.

### Task 6: Conditional primitive inclusion (`when?` on PrimitiveTemplate)

**Files:** Modify `recipe.ts` (`PrimitiveTemplate += { when?: RecipeValue }`), `interpret-recipe.ts` (draw filter); Test extend `interpret-recipe.spec.ts`.

**Interfaces — Produces:** each `PrimitiveTemplate` variant gains optional `when?: RecipeValue`. In the generated `draw()`, a primitive is emitted only if `when` is absent OR `resolveValue(when, props, ctx)` is truthy.

- [ ] **Step 1: Failing test**
```ts
it('omits primitives whose when is falsy (handles only when selected)', () => {
  const recipe = { id:'t', name:'t', shapes:[{ kind:'z',
    draw:[{p:'rect',x:0,y:0,w:10,h:10},
          {p:'rect',x:0,y:0,w:4,h:4, when:{bind:'__selected'}}],
    bounds:{x:0,y:0,w:10,h:10}, a11y:{role:'img', name:'z'} }] };
  const reg = interpretRecipe(recipe);
  const def = reg.get('z')!;
  const node = {id:'1', kind:'z', props:{}, children:[]};
  expect(def.draw(node, ctxWith({selected:false})).length).toBe(1);
  expect(def.draw(node, ctxWith({selected:true})).length).toBe(2);
});
```
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3:** In interpret's draw builder, map templates → resolved primitives, filtering on `when`. Pass the DrawContext's selection/focus into the resolve ctx (confirm how `<ds-board-kit>` threads selection into `DrawContext` — wire `selected`/`focused` from there; if DrawContext lacks it, extend the interpret-side ctx from the node-vs-selection passed by the brick. Verify against `render-node.ts` `DrawContext`).
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): conditional primitive inclusion via when?`.

### Task 7: resize + reshape actions (edit half)

**Files:** Modify `recipe.ts` (`RecipeAction` union), `interpret-recipe.ts` (edit builder); Test extend.

**Interfaces — Produces:**
```ts
export type RecipeAction = /* existing */ 
  | { op:'resize'; on:{gesture:'drag'}|{key:string[]}; handles:'corners'; minW?:number; minH?:number; pinOpposite?:boolean }
  | { op:'reshape'; on:{gesture:'drag'}|{key:string[]}; ends:Array<'head'|'tail'> };
```
`resize` updates `w`/`h` props (clamp to `minW`/`minH` default 1; opposite corner pinned ⇒ also adjust `x`/`y`). `reshape` moves one endpoint of `points` (`head`=last, `tail`=first per the kf-arrow convention — verify). Keyboard: Shift+Arrow → resize/head, Alt+Arrow → reshape/tail (match `kf-zone`/`kf-arrow` key semantics exactly for parity).

- [ ] **Step 1: Failing tests** — assert `onKey`/`onGesture` produce the same `EditResult` (prop deltas) as the kf hand-written defs for: zone Shift+ArrowRight grows `w` by 1; zone resize clamps at `minW`; arrow Shift+ArrowUp moves head; arrow Alt+ArrowDown moves tail. (Copy exact expected deltas from `kf-zone-definition.ts` / `kf-arrow-definitions.ts`.)
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3:** Implement in the edit builder, mirroring move/add/remove/reparent. Reuse the existing gesture/key plumbing.
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): resize + reshape recipe actions`.

### Task 8: hit-region declaration → hitTest

**Files:** Modify `recipe.ts` (`RecipeShape += { hit? }`), `interpret-recipe.ts` (hitTest builder); Test extend.

**Interfaces — Produces:**
```ts
RecipeShape += { hit?: { handles?:'corners'|'endpoints'; handleRadius?:number; body?:'rect'|'segment'; segmentTolerance?:number } };
```
hitTest returns the same `HitResult` shape the kf defs return (e.g. `{part:'handle', index}` vs `{part:'body'}`). For `corners`: test each corner within `handleRadius` (default 10) → handle hit with index; else `body:'rect'` within bounds. For `endpoints`+`segment`: endpoints within `handleRadius` → handle; else within `segmentTolerance` (default 12) of the segment via `distToSegment` → body.

- [ ] **Step 1: Failing tests** — feed points/at-coords from `kf-zone`/`kf-arrow` hit tests; assert identical `HitResult`.
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3:** Implement; port `distToSegment` (pure helper, mirror kf-arrow's).
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): declarative hit regions`.

### Task 9: validateRecipe new codes

**Files:** Modify `validate-recipe.ts`; Test extend `validate-recipe.spec.ts`.

**Interfaces — Produces:** `RecipeValidationError.code += 'calc-parse-error' | 'calc-unknown-fn' | 'calc-unknown-var'`. Walk every `RecipeValue` in draw/bounds/a11y/vars; for each `{calc}` run `compileCalc` and surface its `errors` mapped to codes (parse → `calc-parse-error`, unknown fn → `calc-unknown-fn`). `calc-unknown-var`: only flag identifiers that are neither a known prop key (can't know statically) nor a pseudo-var — so scope `calc-unknown-var` to references that are clearly invalid (e.g. start with `__` but aren't `__selected`/`__focused`). Keep conservative to avoid false positives.

- [ ] **Step 1: Failing tests** — recipe with `{calc:'1 +'}` → `calc-parse-error`; `{calc:'nope(1)'}` → `calc-unknown-fn`; `{calc:'__bogus'}` → `calc-unknown-var`; valid calc → no error.
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3:** Implement the walk + mapping.
- [ ] **Step 4:** Run, verify PASS.
- [ ] **Step 5:** Commit `feat(board-kit): validate calc expressions`.

### Task 10: Public API + api-extractor + index

**Files:** Modify `board-kit/index.ts`, `libs/design-system-core/src/public-api.ts` (if re-exported), `etc/design-system-core.api.md`.

- [ ] **Step 1:** Export all new types (`InterpretOptions.translate`, new `RecipeValue`/`RecipeAction`/`PrimitiveTemplate`/`RecipeShape.hit` shapes, calc public helpers if any are intended public — keep the parser internal; export only `compileCalc`/`CALC_FNS` if the studio needs them, else keep private).
- [ ] **Step 2:** Run `npx nx run design-system-core:build` then api-extractor (`api:update`). **Pin the report to the ci:local build with a warm nx cache** (never `--skip-nx-cache`) to avoid the union-literal ordering flake.
- [ ] **Step 3:** Run the full lib unit suite + `ng build`. Verify green.
- [ ] **Step 4:** Commit `feat(board-kit): export calc + schema-extension public API`.

### Task 11: Verifier wave + merge SP1 code PR

- [ ] Open the SP1 PR (board-kit changes) early. Run the verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker`, `isolation:"worktree"`). `charter-checker` must confirm: no kernel touch, brick territory, ADR-176 inclusion test satisfied, calc is bounded. `post-findings` to the PR before merge. Merge on green. Run twin ritual.

### Task 12: Bump + PUBLISH core@2.8.0 (MAIN SESSION)

- [ ] **Step 1:** Bump `libs/design-system-core/package.json` → `2.8.0`. Commit + PR + merge.
- [ ] **Step 2:** `npm publish` to GitHub Packages — **founder's hand in the main session** (classifier gate). Verify the published tarball contains the new exports + FESM bundle is Node-ESM-resolvable.
- [ ] **Step 3:** Add `@de-braighter/design-system-core@2.8.0` to `minimumReleaseAgeExclude` in `domains/studio/pnpm-workspace.yaml` and bump the floor in `domains/exercir`; reinstall both.

---

# SP2 — studio: cookbook recipe + showcase (consumes published 2.8.0)

Path root: `domains/studio` (pnpm-workspace; use `npm test` / `npm run build`).

### Task 13: Author the drill `EditorRecipe` (studio copy)

**Files:** Create `domains/studio/libs/board-editor/src/lib/cookbook/kids-drill.recipe.ts`; Test `kids-drill.recipe.spec.ts`.

**Interfaces — Produces:** `export const kidsDrillRecipe: EditorRecipe` — all 8 kinds (`kf.pitch`, `kf.zone`, `kf.point.player`, `kf.point.opp`, `kf.point.cone`, `kf.point.ball`, `kf.arrow.pass`, `kf.arrow.run`). Pitch = literal static primitives (860×560, 6 stripes, border, centre line + circle `r≈61.6`). Zone = fill rect + 4 dashed borders (`{bind:'w'}`/`{bind:'h'}`) + 4 corner handles `when:{bind:'__selected'}` + resize action + corners hit. Arrows = `{calc}` line back-off + `{calc}` arrowhead `d` (string-concat) + endpoint handles `when:__selected` + reshape/move + endpoint/segment hit + dotted-path `points` binds. Points = circle (+ number text for player/opp) / triangle path (cone) / two circles (ball). Colors verbatim from `kf-*` (`#4e9c63`, `#1c2520`, `#2f8a4e`, `#FF8A2A`, `#fff`, `rgba(...)`).

- [ ] **Step 1:** Author the recipe data (copy exact geometry/colors from the kf registry files — they are the source of truth).
- [ ] **Step 2: Validity test** — `expect(validateRecipe(kidsDrillRecipe)).toEqual([])` and `interpretRecipe(kidsDrillRecipe)` yields a registry with all 8 kinds.
- [ ] **Step 3:** Commit `feat(board-editor): kids-drill cookbook recipe`.

### Task 14: Studio parity / fidelity spec

**Files:** Test `kids-drill.parity.spec.ts`.

- [ ] **Step 1:** Interpret the recipe with an identity `translate` (`(k)=>k`). For representative nodes per kind, assert `draw()` produces the expected `SvgPrimitive[]` (assert the arrow arrowhead path string + back-off endpoint numerically; assert zone handles appear only when selected). This is the studio-side proof that the calc/handles/i18n machinery renders the football-class shapes.
- [ ] **Step 2:** Run; ensure existing `catalog-parity`/`catalog-document` stay green.
- [ ] **Step 3:** Commit `test(board-editor): kids-drill recipe fidelity`.

### Task 15: Cookbook gallery entry + browser verify

**Files:** Modify `apps/board-editor-ui` cookbook gallery to add the kids-drill recipe as a worked example (reuse the C2 cookbook seam + C3 thumbnail-on-save renderer).

- [ ] **Step 1:** Register the recipe in the cookbook list with a thumbnail.
- [ ] **Step 2:** `npm run build`; browser-verify the entry renders across night/ivory/clinical skins, 0 console errors. Capture a proof PNG.
- [ ] **Step 3:** Commit, PR, verifier wave, merge, twin ritual.

---

# SP3 — exercir: de-fork the live drill board (consumes published 2.8.0)

Path root: `domains/exercir/libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/`.

### Task 16: Verify projector compatibility (open item #1/#2)

**Files:** Read `projectSketch` + `kf-point-definitions.ts`; Test scratch.

- [ ] **Step 1:** Confirm whether `projectSketch` always assigns `n` to `player`/`opp` (re-numbering 1..k). If always present → recipe draws the number text unconditionally (drop `when` for points). If not → keep `when:{bind:'n'}`. Confirm arrow `points` prop shape (`[[x1,y1],[x2,y2]]`) so dotted-path binds (`points.0.0`...) are correct. Record findings in the PR description.

### Task 17: Author the canonical drill recipe in exercir + wire interpretRecipe

**Files:** Create `kf-drill.recipe.ts`; Modify `kf-registry.ts` (build via `interpretRecipe`); keep `makeKidsRegistry()` signature stable.

**Interfaces — Consumes:** published `interpretRecipe`, `EditorRecipe`. **Produces:** `makeKidsRegistry(translate)` now returns `interpretRecipe(kfDrillRecipe, { translate: (k,p)=>translate(k,p) })` — same `BoardRegistry` shape `KfSketcherComponent` already consumes.

- [ ] **Step 1:** Author `kfDrillRecipe` (the canonical recipe; same data as the studio copy — exercir is the parity source of truth). Use `{i18n}` values for a11y names matching the existing `kf.sketch.*` keys + params.
- [ ] **Step 2:** Rewrite `makeKidsRegistry` to interpret the recipe, injecting transloco `translate`.
- [ ] **Step 3:** Commit `feat(kids-football): drill registry from recipe`.

### Task 18: Byte-parity gate (the invariant)

**Files:** Test `kf-registry-parity.spec.ts`.

**Interfaces — Consumes:** a captured "old" `makeKidsRegistry()` (pin a copy of the pre-de-fork defs as `kf-registry.legacy.ts` for the spec, OR snapshot its outputs).

- [ ] **Step 1: Failing/golden test** — for a representative projected `RenderNode` tree covering every kind (pitch root; player w/ number; opp; cone; ball; zone selected + unselected; pass arrow; run arrow), assert the recipe registry's `draw()` / `bounds()` / `describe()` and `edit.hitTest` / `edit.onKey` / `edit.onGesture` are **deep-equal** to the legacy defs' outputs. Include a selected-zone case (handles) and an arrow reshape case.
- [ ] **Step 2:** Run; fix recipe data until byte-identical. This is the gate — it must pass before merge.
- [ ] **Step 3:** Commit `test(kids-football): byte-parity recipe vs legacy registry`.

### Task 19: a11y + live browser verification

- [ ] **Step 1:** Run the exercir unit + a11y suites. Confirm WCAG 2.4.3 focus recovery on delete/reshape, 2.5.7 keyboard dragging alternatives, 2.5.8 handle target size unchanged. Dispatch `a11y-pro` to audit.
- [ ] **Step 2:** Serve the app; browser-verify `drills/new` and `drills/:id`: place player/opp/cone/ball, draw pass+run arrows, add+resize a zone, keyboard-move/reshape/delete — all identical to before; club-grass skin renders; 0 console errors. Capture proof PNGs.
- [ ] **Step 3:** Commit proofs.

### Task 20: Verifier wave + merge SP3

- [ ] Open the SP3 PR. Full verifier wave incl. `exercir-charter-checker` (prototype charter) + `charter-checker` + `qa-engineer` + `reviewer` + `local-ci`, `isolation:"worktree"`. `post-findings` before merge. The byte-parity spec is the hard gate. Merge on green. Twin ritual.

---

## Self-Review

**Spec coverage:** SP1 schema delta A–G → Tasks 5(A,F,G,C), 6(B), 7(D), 8(E), + calc lang Tasks 2–4,9; ADR → Task 1; publish → Task 12. SP2 cookbook+parity → Tasks 13–15. SP3 de-fork+parity gate+browser → Tasks 16–20. All spec sections covered.

**Placeholder scan:** No "TBD/handle edge cases" — each task has concrete tests/code or exact interfaces. Two intentional verify-at-impl items (player `n` presence in Task 16; DrawContext selection threading in Task 6) are framed as explicit verification steps, not vague placeholders.

**Type consistency:** `compileCalc`/`evalCalc`/`CalcEnv`/`CalcNode`/`Token` consistent across Tasks 2–5,9. `interpretRecipe`/`resolveValue`/`InterpretOptions.translate`/`RecipeValue` consistent SP1→SP2→SP3. `makeKidsRegistry(translate)` signature held stable Task 17↔18.

## Execution Handoff

Founder pre-authorized full autonomous execution with auto-approve + auto-merge at all levels (2026-06-26). Vehicle: **subagent-driven-development**. Order: Task 1 (ADR) → Tasks 2–11 (SP1 code) → Task 12 (publish, main session) → Tasks 13–15 (SP2) ∥ Tasks 16–20 (SP3).
