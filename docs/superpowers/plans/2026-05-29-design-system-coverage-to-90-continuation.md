# Design-System Coverage Continuation Plan — pause-point 51.8 %, target > 90 %

**Date:** 2026-05-29
**Status:** active — picks up where wave 10 (PR #159) left off

## Use this prompt verbatim

> Paste the following into a fresh Claude Code session launched from `D:\development\projects\de-braighter\` to continue the design-system test-coverage push toward >90 % overall (Sonar). The prompt is self-contained — read everything below, then proceed wave by wave.

---

## What was done — paste this into the new session

You are picking up a 10-wave component-spec arc on `de-braighter/design-system` (`D:\development\projects\de-braighter\layers\design-system`).

### Current state (post-wave-10, PR #159 merged)

| Metric | Value |
|---|--:|
| **Overall Sonar coverage** | **51.8 %** |
| `design-system-angular` | 49.3 % |
| `design-system-core` | 85.3 % |
| `design-system-angular-forms` | 0.0 % (intentional — see below) |
| `design-system-css` | — (CSS-only, no coverage) |
| Total tests passing | 666 |
| Sonar violations | **0** |
| Sonar hotspots | **0** |
| Covered lines | 5 616 / 10 672 |

**Target:** > 90 % overall coverage. The realistic gap is `design-system-angular` going from 49.3 % → ~85 %+. `design-system-core` is at its practical ceiling.

### What's been specced (waves 1–10, PRs #149–#159)

59 components plus the helper modules:

| Wave | PR | Components | Tests | Δ overall |
|---|---|---|--:|--:|
| 1 | #150 | delta, glow-border, gradient-text, spotlight-card, glitch-text, marquee, ambient-toggle, text-roll | +46 | +small |
| 2 | #151 | sparkline, icon, pitch (db-pitch), form-ring, skin-switcher, funnel-diagram, segmented-control, tabbed-panel | +51 | +2.5 |
| 3 | #152 | number-flow, type-writer, text-scramble, equalizer-bars, glow-slider, orbit-dial | +45 | +3.9 |
| 4 | #153 | pick-list, command-palette, relation-field, date-picker, date-range-picker | +41 | +6.6 |
| 5 | #154 | inertial-dial, clock-dial, multi-handle-elastic-slider, magnetic-tag-cloud | +35 | +3.5 |
| 6 | #155 | constellation, morph-blob, magnetic-button, paper-plane, chord-wheel, noise-field, pressure-commit | +40 | +3.3 |
| 7 | #156 | workflow-map, sankey, flame-graph, latency-heatmap, log-waterfall | +39 | +6.6 |
| 8 | #157 | gauge, rhythm-ring, orbit-picker, gravity-field, observer-pulse | +40 | +6.4 |
| 9 | #158 | body-map, muscle-map, anatomy-ticker-hero, region-globe, chord-diagram | +38 | +4.1 |
| 10 | #159 | season-stretch-hero, match-poster-hero, week-mosaic-hero, phase-curve-picker, gesture-glyph, tool-bloom | +42 | +3.2 |

Plus helper-module specs from earlier phases:
- `core/`: scalar, vec2, constants, easing, color-oklch, scale, phyllotaxis, potential-field, bezier, mat3, barycentric, plinko, noise, dollar1, reduced-motion, raf, motion-loop, skin-applier, resolve-skin, skin-registry, brick-registry, workflow-validation, workflow-bpmn-export, workflow-layout (24 spec files)
- `angular/`: button-classes, pitch (helper), make-spark, icon-tags, built-in-glyphs, workflow-map.bpmn-import, brand-mark (pattern unblock)

### What's remaining — 19 components, ~4 316 lines

Sorted by line count (use `wc -l` for current numbers):

```
venn-picker          (363)
heartbeat            (334)
distribution-sketch  (315)
phase-ribbon         (310)
service-map          (306)
heart-pulse          (280)
sparkle-hover        (241)
calendar-heatmap     (224)
aurora-background    (217)
confetti-burst       (210)
pitch-diagram        (205)
beeswarm-timeline    (204)
orbit-ring           (189)
horizon-chart        (182)
magnetic-cursor      (169)
tilt-card            (165)
marble-stream        (159)
cursor-trail         (148)
count-ticker         (95)
```

Plus `design-system-angular-forms/src/public/cva-wiring.spec.ts` which has 17 CVA controls (~3 259 NCLOC at 0 % coverage) — see "Forms lib unblock" section below.

### The unblock that made all of this possible (PR #149)

Before PR #149, signal inputs in `TestBed.createComponent` didn't propagate (`NG0303`). Three things had to land together:

1. **Bump deps**: `@analogjs/vite-plugin-angular@^2.5.2` + `@analogjs/vitest-angular@^2.5.2` (from 2.2.0 — the stable 2.5.x line added vitest 4 support 2026-05-26).
2. **Vitest config** (`libs/design-system-angular/vitest.config.ts`):
   ```ts
   import angular from '@analogjs/vite-plugin-angular';
   plugins: [angular({ jit: false, tsconfig: './tsconfig.spec.json' })],
   ```
   `jit: false` is **load-bearing** — the plugin defaults to JIT in test mode but JIT doesn't register signal-input metadata properly. AOT does.
3. **`tsconfig.spec.json`** (new, in `libs/design-system-angular/`):
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": { "outDir": "../../dist/out-tsc", "types": ["vitest/globals", "node"] },
     "include": ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/*.ts", "src/test-setup.ts"],
     "exclude": []
   }
   ```
   `exclude: []` overrides the parent's `**/*.spec.ts` exclusion.
4. **`test-setup.ts`** activates `setupTestBed({ zoneless: false })` from `@analogjs/vitest-angular/setup-testbed`. It also stubs canvas-2D (jsdom doesn't ship it) and ResizeObserver (jsdom doesn't ship it either; `<db-marquee>` + `<db-segmented-control>` and others depend on it).

If you ever see `NG0303: Can't set value of the 'X' input` reappear, the cause is one of those four lines. Don't re-introduce the "blocked upstream" framing.

## The workflow — proven 10 times

For each wave:

1. **Branch off main**: `git checkout main && git pull --ff-only && git checkout -b chore/component-specs-wave-N`.
2. **Pick 4–8 components**. Aim for related families (layout, motion, SVG widgets, etc.) — same-family components are 5× faster to spec once you've written one.
3. **Read the component source** to extract:
   - Public inputs (`readonly X = input<...>(...)`).
   - Output emitters (`readonly Y = output<...>()`).
   - Template classes (`grep -n 'class="' component.ts`).
   - Event handlers (`grep -n '(click)\|(keydown)' component.ts`).
   - **Auto-computed properties** vs inputs (look for `protected method(): T` vs `readonly X = input<>(...)`).
4. **Write the spec** following the established patterns (see "Established patterns" below).
5. **Run**: `npx nx run design-system-angular:vite:test`. If failures are real (not infra), fix the spec to match the actual component contract.
6. **Verify gates**:
   ```bash
   npm run ci:local
   npx nx reset && rm -rf coverage/design-system-angular && npm run test:coverage
   npm run sonar:scan
   ```
   Wait ~7 s after `sonar:scan` for the Sonar dashboard to refresh.
7. **Pull the metrics** (the same query you've been using):
   ```bash
   TOKEN=$(tr -d '[:space:]' < tools/sonar/.token)
   curl -fsS -u "${TOKEN}:" "http://localhost:9000/api/measures/component?component=de-braighter-design-system&metricKeys=coverage,lines_to_cover,uncovered_lines,violations" -o m.json
   node -e "const d=JSON.parse(require('fs').readFileSync('m.json','utf8')); const m=Object.fromEntries(d.component.measures.map(r=>[r.metric,r.value])); console.log('Overall:', m.coverage+'%'); console.log('Covered:', (m.lines_to_cover-m.uncovered_lines), '/', m.lines_to_cover); console.log('Violations:', m.violations);"
   ```
8. **Commit + push + PR + merge** — squash-merge in the GH UI is fine but `gh pr merge N -R de-braighter/design-system --merge` works too. Commit messages should follow the established style — see "Commit/PR message format" below.

**Each wave should land 4–8 components, +30–50 tests, +3–7 pp overall coverage.** That cadence has been stable across all 10 waves.

## Established patterns — copy these, don't reinvent

### Spec skeleton

```ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { XyzComponent } from './xyz.component.js';

const setup = (
  extras: Partial<{
    input1: T1;
    input2: T2;
    // ... required inputs first, optional after
  }> = {},
) => {
  const fixture = TestBed.createComponent(XyzComponent);
  if (extras.input1 !== undefined) fixture.componentRef.setInput('input1', extras.input1);
  // ... or iterate via Object.entries when there are many
  fixture.detectChanges();
  return { fixture };
};

describe('XyzComponent', () => {
  it('renders the .xyz root with role/aria-label', () => { ... });
  // 5–10 tests typical
});
```

### Patterns by category

**Element queries**: `fixture.nativeElement.querySelector('.bem-class') as SVGSVGElement` / `HTMLButtonElement`. Always cast at the boundary.

**Setting inputs**: `fixture.componentRef.setInput('name', value)` then `fixture.detectChanges()`. Required inputs (`input.required<T>()`) must be set in `setup()` before the first `detectChanges()`.

**Event dispatch (mouse/key)**:
```ts
const btn = fixture.nativeElement.querySelector('button.xy') as HTMLButtonElement;
btn.click();                                       // simulates a click
btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }));
fixture.detectChanges();
```
**`bubbles: true` is load-bearing** — without it, Angular's host listener never fires.

**Output subscription**:
```ts
const fired: string[] = [];
fixture.componentInstance.outputName.subscribe((v: string) => fired.push(v));
// trigger the event
btn.click();
fixture.detectChanges();
expect(fired).toContain('expected-value');
```

**`ngModel`-driven input**:
```ts
const input = fixture.nativeElement.querySelector('input.x') as HTMLInputElement;
input.value = 'cher';
input.dispatchEvent(new Event('input', { bubbles: true }));
fixture.detectChanges();
```

**Two-way `model()` binding** — assert both directions:
```ts
// downward
expect(fixture.nativeElement.querySelector('.active')).not.toBeNull();
// upward — click child → componentInstance updates
btn.click();
fixture.detectChanges();
expect(fixture.componentInstance.modelInput()).toBe('new-value');
```

**Auto-derived aria-label (NOT an input)**: some components (e.g. `workflow-map`) have `ariaLabel(): string` as a *method* that auto-derives. Assert on the auto-derived value, NOT on an override:
```ts
expect(svg.getAttribute('aria-label')).toContain('Workflow with N nodes');
```

**Click-target precision**: when `(click)` is bound on an inner element (rect inside a g, button inside a li), dispatch on the exact element. `grep -n '(click)' component.ts` finds the actual target.

**Default-state assertions**: pin "what's NOT rendered" for stateful components. E.g., `rhythm-ring`'s now-hand only renders when `nowAngle() !== null`. Default state: `expect(query('.rr__now')).toBeNull()`.

**Numerical assertions on attributes**: use `parseFloat` instead of asserting on exact strings — robust against precision quirks.
```ts
expect(parseFloat(elem.getAttribute('stroke-dashoffset')!)).toBeCloseTo(0, 6);
```

### Common traps (we hit these)

1. **`ngAfterViewInit` + OnPush + plain field**: `constellation` populates `this.stars` (plain `Star[]`, no signal) in `ngAfterViewInit`. After `detectChanges()`, the template doesn't re-render. **Fix**: assert on `fixture.componentInstance.stars` instead of the DOM.

2. **`ngAfterViewInit` + signal + frame loop**: `morph-blob`'s `pathD` is a signal but only written from inside the rAF tick. Without real timer pumping, the signal stays empty. **Fix**: assert on the initial state (`d === ''`) and document the test-runtime invariant.

3. **Frame loop never pumps**: same as above — components that compute geometry inside `tick()` show their initial state in tests. Don't try to simulate frames; assert on what's deterministic.

4. **`setInput` on a non-input property** (e.g. an auto-derived method): the TypeScript types don't catch this. The error you'll see is `NG0303` if you used `componentRef.setInput`, or just no effect. **Fix**: re-read the component to find what's actually an input.

5. **Computed filter contract** (e.g. `regionCount` filtering `servers > 0`): when an assertion fails, `grep "<computed name>" component.ts` to read the actual logic before adjusting the test.

6. **Defaults from contracts**: `D.X` is the contract default. Some defaults are `null`, `[]`, `false` — read the contract before assuming.

7. **`tabbed-panel` is a model()-binding wrapper**: spec via clicking the inner `<db-segmented-control>` buttons; assert on `componentInstance.activeId()`.

8. **Empty-state placeholders**: 3 hero specs assert on German placeholder strings ("Keine Phasen definiert.", "Keine Vorlagen ausgewaehlt."). Pin exact strings — catches accidental locale changes.

### Coverage-measurement quirks

The AOT compiler exposes more lines to coverage than the source has, so `lines_to_cover` grows when you switch on AOT. **Per-lib coverage % is the load-bearing number**; the overall % can dip even as covered lines increase (the denominator grew faster than the numerator on a single PR). Document this explicitly in PR bodies.

### Commit / PR message format

```
test(angular): component spec wave N — <theme> (angular X% -> Y%, +N tests)

[1-line summary]

## Sonar delta

| Lib | After wave N-1 | After wave N | Delta |
[table]

## What lands

[bulleted list of specs with test counts + surface coverage]

## Verification

- npm run test:coverage   OLD -> NEW tests (+N)
- npm run ci:local        exit 0
- npm run sonar:scan      X.X % overall / 0 violations / 0 hotspots

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

PR title: `test(angular): component spec wave N — <theme>, +M tests (angular X% → Y%, overall Z%)`

PR body: same delta table + per-spec line items + "notable patterns" + coverage arc + verification table.

## Plan to > 90 %

### Realistic ceiling math

- Total `lines_to_cover` (Sonar): 10 672
- Currently covered: 5 616
- For 90 % overall: need 9 605 covered → +3 989 more lines.
- Remaining angular components: ~4 316 lines uncovered. Even covering 100 % of them only buys 4 316 lines (≈ 8 416 / 10 672 = 78.9 % overall).
- **To clear 90 %, the forms lib (~3 259 NCLOC at 0 %) must also come online.**

### Three-stage attack

**Stage A: Spec the remaining 19 angular components** (waves 11–13, target ≥ 75 % overall).
- Wave 11 (animation-heavy + visual effects): `heartbeat`, `heart-pulse`, `aurora-background`, `confetti-burst`, `marble-stream`, `cursor-trail` (6 components, ~1 500 lines)
- Wave 12 (mid-size SVG): `venn-picker`, `distribution-sketch`, `phase-ribbon`, `service-map`, `calendar-heatmap`, `sparkle-hover` (6 components, ~1 700 lines)
- Wave 13 (remaining): `pitch-diagram`, `beeswarm-timeline`, `orbit-ring`, `horizon-chart`, `magnetic-cursor`, `tilt-card`, `count-ticker` (7 components, ~1 100 lines)

Use the same "default-state + structural-render + event-emission" recipe established by waves 1–10. Many of these are canvas/animation-heavy; **spec the default state** (the component is mounted, decorative chrome is aria-hidden, key inputs are reflected) rather than trying to drive animations.

**Stage B: Unblock the forms lib** (the +X.X pp force-multiplier).
- The `cva-wiring.spec.ts` currently exists at `libs/design-system-angular-forms/src/public/cva-wiring.spec.ts` but is **not runnable** (its TestBed mount fails because `vite:test` isn't an inferred target there).
- Add a `vitest.config.ts` to `libs/design-system-angular-forms/` (mirror the angular lib's: `angular({ jit: false, tsconfig: './tsconfig.spec.json' })`).
- Add `libs/design-system-angular-forms/tsconfig.spec.json` (same as the angular lib's).
- Add `libs/design-system-angular-forms/src/test-setup.ts` (mirror the angular lib's setup-testbed + canvas-2D + ResizeObserver polyfills; or just `import './../../design-system-angular/src/test-setup.ts'` if relative imports work — verify).
- The existing `cva-wiring.spec.ts` should then run. It mounts every db-* control and tests NG_VALUE_ACCESSOR registration, writeValue, registerOnChange. If that single spec passes, all 17 controls light up coverage-wise.
- Spec each control's BEM-class rendering on top of that for individual coverage gain.
- **Pitfall**: the test-setup file currently has a "NOT YET RUNNABLE" comment that's stale. Update it once the harness works.

**Stage C: Punch through the long tail** (target > 90 %).
- After stages A + B, expected overall is ~85 %. Push to > 90 % by:
  - Adding more tests to existing component specs (cover branch coverage, not just structural render).
  - Specing the `apps/showcase/` pages that aren't excluded. (Right now `apps/showcase/**` is excluded via `sonar.coverage.exclusions` — leave that alone; the showcase is demo code.)
  - Adding more deterministic-input cases to math modules (`design-system-core` is at 85.3 %, ceiling is ~92 %).

### Stop-loss conditions — push back to the user before continuing if

- A wave introduces a Sonar violation. (Has not happened across 10 waves; if it does, the infra changed.)
- A component's spec genuinely can't be written without simulating timers / pointer events. Skip that component, document why in the PR body, move on.
- The forms-lib unblock fails on a deeper plumbing issue (e.g., the analog vite plugin not picking up the workspace). Don't sink hours into it — file a follow-up and continue with stage A/C.
- `npm run ci:local` ever fails for a reason other than the api-check cache flake (which is a known flake — just retry).

## Tooling reference

```bash
# Always launch Claude Code from D:\development\projects\de-braighter\
cd D:\development\projects\de-braighter\layers\design-system

# Branch + commit hygiene
git checkout main && git pull --ff-only && git checkout -b chore/component-specs-wave-N

# Run only the angular lib's tests
npx nx run design-system-angular:vite:test

# Full local gate (build + lint + typecheck + api-check + tests)
npm run ci:local

# Coverage (fresh; nx caches everything by default)
npx nx reset && rm -rf coverage/design-system-angular && npm run test:coverage

# Sonar scan + dashboard refresh
npm run sonar:scan
# (wait ~7 s for the server)

# Sonar API
TOKEN=$(tr -d '[:space:]' < tools/sonar/.token)
curl -fsS -u "${TOKEN}:" \
  "http://localhost:9000/api/measures/component?component=de-braighter-design-system&metricKeys=coverage,line_coverage,branch_coverage,lines_to_cover,uncovered_lines,violations"

# Per-lib breakdown
curl -fsS -u "${TOKEN}:" \
  "http://localhost:9000/api/measures/component_tree?component=de-braighter-design-system%3Alibs&metricKeys=coverage&strategy=children"

# Open PR + merge
gh pr create -R de-braighter/design-system --title "test(angular): ..." --body-file .pr-body.tmp
gh pr merge <num> -R de-braighter/design-system --merge
```

## Files to know about

- `libs/design-system-angular/vitest.config.ts` — the analog vite plugin with `jit: false`. Don't change.
- `libs/design-system-angular/tsconfig.spec.json` — spec compilation config. Mirror this in the forms lib for stage B.
- `libs/design-system-angular/src/test-setup.ts` — canvas-2D stub, ResizeObserver polyfill, `setupTestBed({ zoneless: false })`. The "test-utility" patterns live here.
- `sonar-project.properties` — `sonar.javascript.lcov.reportPaths` lists per-lib lcov paths. When forms lib comes online, add its path here.
- `tools/sonar/.token` — local SONAR_TOKEN. Keep as is.

## The arc, for context

```
0.2 %  ← baseline (2026-05-28 morning)
6.5 %  ← 2a    (math + workflow contracts in core)
10.5 % ← 2b    (finished core's pure modules)
12.2 % ← 2c    (angular helpers)
12.6 % ← 2d    (core jsdom)
11.7 % ← wave 1
14.2 % ← wave 2
18.1 % ← wave 3
24.7 % ← wave 4
28.2 % ← wave 5
31.5 % ← wave 6
38.1 % ← wave 7
44.5 % ← wave 8
48.6 % ← wave 9
51.8 % ← wave 10 — PAUSE POINT (this PR's continuation pickup)
              ↓
~70 % ← end of stage A (waves 11–13)
~85 % ← end of stage B (forms lib unblock)
> 90 % ← end of stage C (long tail + math ceiling push)
```

10 PRs over one day, 0 violations / 0 hotspots maintained throughout, +51.6 pp overall coverage. The remaining 38.2 pp is mechanical work using the same patterns; the only judgment call is the forms-lib unblock in stage B.

---

**Approval gate:** before starting wave 11, post-launch instruction to the future Claude session is: read this entire doc, then **post a one-paragraph plan for wave 11** to the user. Do NOT start coding until the user confirms direction. After wave 11 the pattern is established and you can proceed wave by wave without explicit per-wave approval.
