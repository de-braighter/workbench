# Player-surface a11y batch (live-region + step-position) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the WCAG 4.1.3 in-`@case` live-region race across all six pack-football player surfaces with one shared persistent live-region, and add the WCAG 1.3.1 step-position to the training timeline.

**Architecture:** A new standalone `FcStatusLiveComponent` renders a single persistent visually-hidden `role="status" aria-live="polite"` node whose text is bound to a per-surface `liveMessage()` computed (built by the pure `liveStatusMessage(kind, noun, reason?)`). Each surface mounts it once **outside** its `@switch`, and the visible `@case` status nodes lose their live-region roles so there is exactly one announcer. Training additionally emits `Phase n von N` from its `@for` ordinals.

**Tech Stack:** Angular 21 standalone components + Signals, vitest + `@angular/build:unit-test`, axe-core. Nx project `pack-football-ui`. ESM imports use explicit `.js` extensions.

**Spec:** `docs/superpowers/specs/2026-06-03-pack-football-player-surface-a11y-batch-design.md`

**Repo / worktree:** code lands in `domains/exercir` (its own feature branch — create at execution time per `superpowers:using-git-worktrees`). This plan + spec live in the workbench worktree `.worktrees/a11y-batch` (branch `docs/pack-football-player-a11y-batch`).

**All paths below are relative to `domains/exercir/`.**

**Per-surface reference table** (used by Tasks 3–8):

| Surface file (`libs/pack-football-ui/src/lib/player/`) | class | noun | testid prefix | failed-`@case` line(s) | loading-`@case` line | has decorator `imports:`? | live-region attrs to strip |
|---|---|---|---|---|---|---|---|
| `player-form-page.component.ts` | `PlayerFormPageComponent` | `Form` | `player-form` | 208 | 203 | no | `role="status"` + `aria-live="polite"` |
| `player-training-page.component.ts` | `PlayerTrainingPageComponent` | `Training` | `player-training` | 237 | 232 | no | `role="status"` + `aria-live="polite"` |
| `fc-player-funnel-page.component.ts` | `FCPlayerFunnelPageComponent` | `Trichter` | `player-funnel` | 228–232 | 223 | **yes (line 81)** | `aria-live="polite"` only (no `role`) |
| `player-log-page.component.ts` | `PlayerLogPageComponent` | `Protokoll` | `player-log` | 256 | 251 | no | `role="status"` + `aria-live="polite"` |
| `player-team-page.component.ts` | `PlayerTeamPageComponent` | `Team` | `player-team` | 235 | 230 | no | `role="status"` + `aria-live="polite"` |
| `player-match-page.component.ts` | `PlayerMatchPageComponent` | `Nächstes Spiel` | `player-match` | 199 | 194 | no | `role="status"` + `aria-live="polite"` |

> Line numbers are current-HEAD anchors; if they drift, locate by the `role="status"` / `aria-live="polite"` text. All six share the `LoadState = idle | loading | loaded | failed` discriminant and a `failureReason = computed(...)` returning the German reason (`''` unless failed). All six live in `…/player/`, so the new component imports as `'../a11y/status-live.component.js'`.

---

### Task 1: `liveStatusMessage` pure function

**Files:**
- Create: `libs/pack-football-ui/src/lib/a11y/live-status-message.ts`
- Test: `libs/pack-football-ui/src/lib/a11y/live-status-message.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/pack-football-ui/src/lib/a11y/live-status-message.spec.ts
import { describe, expect, it } from 'vitest';

import { liveStatusMessage } from './live-status-message.js';

describe('liveStatusMessage', () => {
  it('is silent (empty) while idle', () => {
    expect(liveStatusMessage('idle', 'Form')).toBe('');
  });

  it('announces loading with the surface noun', () => {
    expect(liveStatusMessage('loading', 'Training')).toBe('Training wird geladen…');
  });

  it('announces the loaded transition (the previously-silent case)', () => {
    expect(liveStatusMessage('loaded', 'Nächstes Spiel')).toBe('Nächstes Spiel geladen.');
  });

  it('announces failure with the German reason interpolated', () => {
    expect(liveStatusMessage('failed', 'Team', 'Server-Fehler (503)')).toBe(
      'Team konnte nicht geladen werden: Server-Fehler (503).',
    );
  });

  it('tolerates a missing reason on the failed arm', () => {
    expect(liveStatusMessage('failed', 'Trichter')).toBe(
      'Trichter konnte nicht geladen werden: .',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/live-status-message.spec.ts"`
Expected: FAIL — cannot resolve `./live-status-message.js` / `liveStatusMessage is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// libs/pack-football-ui/src/lib/a11y/live-status-message.ts
/**
 * German screen-reader copy for a surface's async load lifecycle, authored once
 * for all player surfaces (exercir#178 F5). Bound to a persistent live region
 * via {@link FcStatusLiveComponent}; the `loading`/`failed` strings match each
 * surface's visible copy, and `loaded` carries the otherwise-silent success.
 *
 * @param kind  the surface's `LoadState` discriminant.
 * @param noun  the surface's subject (e.g. "Form", "Nächstes Spiel").
 * @param reason the German failure reason (only used on `failed`).
 */
export type LoadKind = 'idle' | 'loading' | 'loaded' | 'failed';

export function liveStatusMessage(
  kind: LoadKind,
  noun: string,
  reason = '',
): string {
  switch (kind) {
    case 'loading':
      return `${noun} wird geladen…`;
    case 'loaded':
      return `${noun} geladen.`;
    case 'failed':
      return `${noun} konnte nicht geladen werden: ${reason}.`;
    case 'idle':
      return '';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/live-status-message.spec.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/a11y/live-status-message.ts libs/pack-football-ui/src/lib/a11y/live-status-message.spec.ts
git commit -m "feat(pack-football-ui): liveStatusMessage — shared player-surface a11y copy (exercir#178)"
```

---

### Task 2: `FcStatusLiveComponent`

**Files:**
- Create: `libs/pack-football-ui/src/lib/a11y/status-live.component.ts`
- Test: `libs/pack-football-ui/src/lib/a11y/status-live.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/pack-football-ui/src/lib/a11y/status-live.component.spec.ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { FcStatusLiveComponent } from './status-live.component.js';

// Host that drives the message input the way a surface would.
@Component({
  standalone: true,
  imports: [FcStatusLiveComponent],
  template: `<fc-status-live [message]="message" />`,
})
class HostComponent {
  message = '';
}

describe('FcStatusLiveComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders a persistent polite status region, present even when empty', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="fc-status-live"]',
    );
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent?.trim()).toBe('');
  });

  it('updates only its text when the message changes (mutation, not re-create)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const before = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="fc-status-live"]',
    );
    fixture.componentInstance.message = 'Form wird geladen…';
    fixture.detectChanges();
    const after = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="fc-status-live"]',
    );
    expect(after).toBe(before); // same node — text mutated in place
    expect(after?.textContent?.trim()).toBe('Form wird geladen…');
  });

  it('is visually hidden via sr-only', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const region = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="fc-status-live"]',
    );
    expect(region?.classList.contains('sr-only')).toBe(true);
  });

  it('has no axe-core violations', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message = 'Form geladen.';
    fixture.detectChanges();
    const results = await axe.run(fixture.nativeElement as HTMLElement, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/status-live.component.spec.ts"`
Expected: FAIL — cannot resolve `./status-live.component.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// libs/pack-football-ui/src/lib/a11y/status-live.component.ts
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * A single persistent, visually-hidden ARIA live region (APG "status message"
 * pattern). Mount it ONCE per surface, OUTSIDE the surface's `@switch`, so the
 * node lives across every load transition and assistive tech announces by
 * MUTATING its text — fixing the WCAG 4.1.3 race where an in-`@case`
 * `role="status"` node is created together with its text (exercir#178 F5).
 *
 * Owns its own scoped `.sr-only` (each surface keeps its own for other hidden
 * spans). Bind `message` to a `liveStatusMessage(...)`-backed computed; an
 * empty string is the correct "nothing to announce yet" state.
 */
@Component({
  selector: 'fc-status-live',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
  template: `<p
    class="sr-only"
    role="status"
    aria-live="polite"
    data-testid="fc-status-live"
  >{{ message }}</p>`,
})
export class FcStatusLiveComponent {
  @Input({ required: true }) message = '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/status-live.component.spec.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/a11y/status-live.component.ts libs/pack-football-ui/src/lib/a11y/status-live.component.spec.ts
git commit -m "feat(pack-football-ui): FcStatusLiveComponent — persistent ARIA live region (exercir#178 F5)"
```

---

### Task 3: Adopt in `player-form-page`

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/player-form-page.component.ts`
- Test: `libs/pack-football-ui/src/lib/player/player-form-page.component.spec.ts`

- [ ] **Step 1: Add the spec assertion (write it first; it will fail)**

In the spec, add a test that renders the loaded state via the file's existing render helper and asserts the persistent region exists and the visible status node lost its role. Use the same render pattern the other `it`s in that file use. Add:

```ts
it('exposes exactly one persistent fc-status-live region (exercir#178 F5)', async () => {
  const fixture = await renderLoaded(); // the spec's existing loaded-state helper
  const root = fixture.nativeElement as HTMLElement;
  const regions = root.querySelectorAll('[data-testid="fc-status-live"]');
  expect(regions.length).toBe(1);
  expect(regions[0].getAttribute('aria-live')).toBe('polite');
});

it('does not leave a second live region on the visible loading node', async () => {
  const fixture = await renderLoading(); // render with the funnel-port pending
  const loading = (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="player-form-loading"]',
  );
  expect(loading?.getAttribute('role')).toBeNull();
});
```

> If the spec has no separate `renderLoading()` helper, render with a funnel-port mock whose `getPlayerFunnel` returns a never-resolving promise and `detectChanges()` once (state stays `loading`). Match the existing helper names in the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-form-page.component.spec.ts"`
Expected: FAIL — no `[data-testid="fc-status-live"]`; visible loading node still has `role="status"`.

- [ ] **Step 3: Edit the component**

(a) Add the import after line 21:
```ts
import { FcStatusLiveComponent } from '../a11y/status-live.component.js';
import { liveStatusMessage } from '../a11y/live-status-message.js';
```

(b) Add a decorator `imports` array (this surface has none) — insert between `standalone: true,` and `changeDetection:` (line 39–40):
```ts
  standalone: true,
  imports: [FcStatusLiveComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
```

(c) Insert the region as the first template line, immediately after `template: \`` (before `@switch`):
```html
  template: `
    <fc-status-live [message]="liveMessage()" />
    @switch (state().kind) {
```

(d) Strip `role="status"` and `aria-live="polite"` from the two visible nodes (lines 203, 208). After:
```html
      @case ('loading') {
        <p class="status" data-testid="player-form-loading">
          Form wird geladen…
        </p>
      }
      @case ('failed') {
        <p class="status failed" data-testid="player-form-failed">
          Form konnte nicht geladen werden: {{ failureReason() }}.
        </p>
      }
```

(e) Add the `liveMessage` computed next to the existing `failureReason` computed (after line 300):
```ts
  protected readonly liveMessage = computed(() =>
    liveStatusMessage(this.state().kind, 'Form', this.failureReason()),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-form-page.component.spec.ts"`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/player/player-form-page.component.ts libs/pack-football-ui/src/lib/player/player-form-page.component.spec.ts
git commit -m "feat(pack-football-ui): adopt persistent live-region in Meine Form (exercir#178 F5)"
```

---

### Task 4: Adopt in `player-training-page` + F2 step-position

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/player-training-page.component.ts`
- Test: `libs/pack-football-ui/src/lib/player/player-training-page.component.spec.ts`

- [ ] **Step 1: Add the spec assertions (write first; will fail)**

```ts
it('exposes exactly one persistent fc-status-live region (exercir#178 F5)', async () => {
  const fixture = await renderLoaded(); // existing loaded-state helper
  const regions = (fixture.nativeElement as HTMLElement).querySelectorAll(
    '[data-testid="fc-status-live"]',
  );
  expect(regions.length).toBe(1);
});

it('announces the active phase ordinal for screen readers (F2, WCAG 1.3.1)', async () => {
  const fixture = await renderLoaded();
  const root = fixture.nativeElement as HTMLElement;
  const active = root.querySelector('.phase.active .sr-only');
  // seed has the active phase as one of N; assert the "Phase n von N" fragment
  expect(active?.textContent).toMatch(/Phase \d+ von \d+/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-training-page.component.spec.ts"`
Expected: FAIL — no region; sr-only lacks `Phase n von N`.

- [ ] **Step 3: Edit the component**

(a) Add imports after line 25:
```ts
import { FcStatusLiveComponent } from '../a11y/status-live.component.js';
import { liveStatusMessage } from '../a11y/live-status-message.js';
```

(b) Add the decorator `imports` array (none today) between `standalone: true,` and `changeDetection:`:
```ts
  standalone: true,
  imports: [FcStatusLiveComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
```

(c) Insert the region right after `template: \`` (before `@switch` at line 230):
```html
  template: `
    <fc-status-live [message]="liveMessage()" />
    @switch (state().kind) {
```

(d) Strip `role="status"` + `aria-live="polite"` from lines 232 and 237:
```html
      @case ('loading') {
        <p class="status" data-testid="player-training-loading">
          Training wird geladen…
        </p>
      }
      @case ('failed') {
        <p class="status failed" data-testid="player-training-failed">
          Training konnte nicht geladen werden: {{ failureReason() }}.
        </p>
      }
```

(e) F2 — add ordinals to the phase `@for` (line 252) and extend the sr-only span (line 263):
```html
              @for (ctx of v.view.contexts; track ctx.id; let idx = $index, let cnt = $count) {
```
```html
                    <span class="sr-only">{{ stateWord(ctx.state) }}, Phase {{ idx + 1 }} von {{ cnt }}:</span>
```

(f) Add the computed after `failureReason` (after line ~336):
```ts
  protected readonly liveMessage = computed(() =>
    liveStatusMessage(this.state().kind, 'Training', this.failureReason()),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-training-page.component.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/player/player-training-page.component.ts libs/pack-football-ui/src/lib/player/player-training-page.component.spec.ts
git commit -m "feat(pack-football-ui): live-region + phase step-position in Mein Training (exercir#178 F5+F2)"
```

---

### Task 5: Adopt in `fc-player-funnel-page` (+ normalize failed copy)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.ts`
- Test: `libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.spec.ts`

> This surface already has a decorator `imports:` array (line 81) and its visible status nodes carry **only** `aria-live` (no `role`). It also has a nested what-if sub-region (`whatIfState()`, ~line 302) — **leave it untouched** (out of scope; what-if lane follow-up). Its failed copy uses parentheses; normalize to the colon form so the hidden region (colon) and visible node match.

- [ ] **Step 1: Add the spec assertion (write first; will fail)**

```ts
it('exposes exactly one persistent fc-status-live region for the page load (exercir#178 F5)', async () => {
  const fixture = await renderLoaded(); // existing loaded-state helper
  const regions = (fixture.nativeElement as HTMLElement).querySelectorAll(
    '[data-testid="fc-status-live"]',
  );
  expect(regions.length).toBe(1); // the page-load region; the what-if sub-region is unchanged
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/fc-player-funnel-page.component.spec.ts"`
Expected: FAIL — no `fc-status-live`.

- [ ] **Step 3: Edit the component**

(a) Add imports after line 47:
```ts
import { FcStatusLiveComponent } from '../a11y/status-live.component.js';
import { liveStatusMessage } from '../a11y/live-status-message.js';
```

(b) Add `FcStatusLiveComponent` to the EXISTING decorator imports array (line 81):
```ts
  imports: [
    ClusterOverlayStripComponent,
    FunnelTierStripComponent,
    PlayerWhatIfChromeComponent,
    FcStatusLiveComponent,
  ],
```

(c) Insert the region right after `template: \`` (before `@switch` at line 221):
```html
  template: `
    <fc-status-live [message]="liveMessage()" />
    @switch (state().kind) {
```

(d) Strip `aria-live="polite"` from the loading node (line 223) and the failed node (line 231), and **normalize the failed copy from parentheses to colon** (line 233):
```html
      @case ('loading') {
        <p class="status" data-testid="player-funnel-loading">
          Trichter wird geladen…
        </p>
      }
      @case ('failed') {
        <p class="status failed" data-testid="player-funnel-failed">
          Trichter konnte nicht geladen werden: {{ failureReason() }}.
        </p>
      }
```

(e) Add the computed after the existing `failureReason` (after line ~393):
```ts
  protected readonly liveMessage = computed(() =>
    liveStatusMessage(this.state().kind, 'Trichter', this.failureReason()),
  );
```

> Verify `computed` is already imported from `@angular/core` in this file (it is — `failureReason` uses it). No import change needed for `computed`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/fc-player-funnel-page.component.spec.ts"`
Expected: PASS. (If a test asserted the old parenthesized failed copy, update it to the colon form.)

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.ts libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.spec.ts
git commit -m "feat(pack-football-ui): live-region in Mein Trichter + normalize failed copy (exercir#178 F5)"
```

---

### Task 6: Adopt in `player-log-page`

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/player-log-page.component.ts`
- Test: `libs/pack-football-ui/src/lib/player/player-log-page.component.spec.ts`

- [ ] **Step 1: Add the spec assertion (write first; will fail)**

```ts
it('exposes exactly one persistent fc-status-live region (exercir#178 F5)', async () => {
  const fixture = await renderLoaded(); // existing loaded-state helper
  const regions = (fixture.nativeElement as HTMLElement).querySelectorAll(
    '[data-testid="fc-status-live"]',
  );
  expect(regions.length).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-log-page.component.spec.ts"`
Expected: FAIL — no `fc-status-live`.

- [ ] **Step 3: Edit the component**

(a) Add imports after line 27:
```ts
import { FcStatusLiveComponent } from '../a11y/status-live.component.js';
import { liveStatusMessage } from '../a11y/live-status-message.js';
```

(b) Add the decorator `imports` array (none today) between `standalone: true,` and `changeDetection:`:
```ts
  standalone: true,
  imports: [FcStatusLiveComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
```

(c) Insert the region right after `template: \`` (before `@switch`):
```html
  template: `
    <fc-status-live [message]="liveMessage()" />
    @switch (state().kind) {
```

(d) Strip `role="status"` + `aria-live="polite"` from lines 251 and 256:
```html
      @case ('loading') {
        <p class="status" data-testid="player-log-loading">
          Protokoll wird geladen…
        </p>
      }
      @case ('failed') {
        <p class="status failed" data-testid="player-log-failed">
          Protokoll konnte nicht geladen werden: {{ failureReason() }}.
        </p>
      }
```

> The loading/failed text strings above are the existing copy — keep whatever this file currently shows verbatim, changing only the attributes.

(e) Add the computed after the existing `failureReason` (after line ~340):
```ts
  protected readonly liveMessage = computed(() =>
    liveStatusMessage(this.state().kind, 'Protokoll', this.failureReason()),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-log-page.component.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/player/player-log-page.component.ts libs/pack-football-ui/src/lib/player/player-log-page.component.spec.ts
git commit -m "feat(pack-football-ui): adopt persistent live-region in Protokoll (exercir#178 F5)"
```

---

### Task 7: Adopt in `player-team-page`

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/player-team-page.component.ts`
- Test: `libs/pack-football-ui/src/lib/player/player-team-page.component.spec.ts`

> Live-data surface (mocked `SubstrateClient` in its spec). Its visible nodes use `class="status-line"` (not `status`) — strip only the live attrs, keep the class.

- [ ] **Step 1: Add the spec assertion (write first; will fail)**

```ts
it('exposes exactly one persistent fc-status-live region (exercir#178 F5)', async () => {
  const fixture = await renderWith(); // the spec's existing render helper (loaded by default)
  const regions = (fixture.nativeElement as HTMLElement).querySelectorAll(
    '[data-testid="fc-status-live"]',
  );
  expect(regions.length).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-team-page.component.spec.ts"`
Expected: FAIL — no `fc-status-live`.

- [ ] **Step 3: Edit the component**

(a) Add imports after line 23:
```ts
import { FcStatusLiveComponent } from '../a11y/status-live.component.js';
import { liveStatusMessage } from '../a11y/live-status-message.js';
```

(b) Add the decorator `imports` array (none today) between `standalone: true,` and `changeDetection:`:
```ts
  standalone: true,
  imports: [FcStatusLiveComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
```

(c) Insert the region right after `template: \`` (before `@switch`):
```html
  template: `
    <fc-status-live [message]="liveMessage()" />
    @switch (state().kind) {
```

(d) Strip `role="status"` + `aria-live="polite"` from lines 230 and 235 (keep `class="status-line"` / `class="status-line failed"`):
```html
      @case ('loading') {
        <p class="status-line" data-testid="player-team-loading">
          Team wird geladen…
        </p>
      }
      @case ('failed') {
        <p class="status-line failed" data-testid="player-team-failed">
          Team konnte nicht geladen werden: {{ failureReason() }}.
        </p>
      }
```

> Keep the existing loading/failed text strings verbatim; change only the attributes.

(e) Add the computed after the existing `failureReason` (after line ~334):
```ts
  protected readonly liveMessage = computed(() =>
    liveStatusMessage(this.state().kind, 'Team', this.failureReason()),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-team-page.component.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/player/player-team-page.component.ts libs/pack-football-ui/src/lib/player/player-team-page.component.spec.ts
git commit -m "feat(pack-football-ui): adopt persistent live-region in Team (exercir#178 F5)"
```

---

### Task 8: Adopt in `player-match-page`

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/player-match-page.component.ts`
- Test: `libs/pack-football-ui/src/lib/player/player-match-page.component.spec.ts`

> Live-data surface (mocked `SubstrateClient`, helper `renderWith()` renders loaded by default).

- [ ] **Step 1: Add the spec assertion (write first; will fail)**

```ts
it('exposes exactly one persistent fc-status-live region (exercir#178 F5)', async () => {
  const fixture = await renderWith();
  const regions = (fixture.nativeElement as HTMLElement).querySelectorAll(
    '[data-testid="fc-status-live"]',
  );
  expect(regions.length).toBe(1);
});

it('does not leave role=status on the visible failed node', async () => {
  const failing = async () => {
    throw new SubstrateClientError({ kind: 'http-error', status: 503, body: {}, requestId: 'r9' });
  };
  const fixture = await renderWith(failing);
  const failed = (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="player-match-failed"]',
  );
  expect(failed?.getAttribute('role')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-match-page.component.spec.ts"`
Expected: FAIL — no `fc-status-live`; visible failed node still has `role="status"`.

- [ ] **Step 3: Edit the component**

(a) Add imports after line 24:
```ts
import { FcStatusLiveComponent } from '../a11y/status-live.component.js';
import { liveStatusMessage } from '../a11y/live-status-message.js';
```

(b) Add the decorator `imports` array (none today) between `standalone: true,` and `changeDetection:`:
```ts
  standalone: true,
  imports: [FcStatusLiveComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
```

(c) Insert the region right after `template: \`` (before `@switch` at line ~192):
```html
  template: `
    <fc-status-live [message]="liveMessage()" />
    @switch (state().kind) {
```

(d) Strip `role="status"` + `aria-live="polite"` from lines 194 and 199:
```html
      @case ('loading') {
        <p class="status" data-testid="player-match-loading">
          Nächstes Spiel wird geladen…
        </p>
      }
      @case ('failed') {
        <p class="status failed" data-testid="player-match-failed">
          Nächstes Spiel konnte nicht geladen werden: {{ failureReason() }}.
        </p>
      }
```

(e) Add the computed after the existing `failureReason` (after line ~276):
```ts
  protected readonly liveMessage = computed(() =>
    liveStatusMessage(this.state().kind, 'Nächstes Spiel', this.failureReason()),
  );
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx nx test pack-football-ui --skip-nx-cache --coverage=false --include="**/player-match-page.component.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/player/player-match-page.component.ts libs/pack-football-ui/src/lib/player/player-match-page.component.spec.ts
git commit -m "feat(pack-football-ui): adopt persistent live-region in Nächstes Spiel (exercir#178 F5)"
```

---

### Task 9: Lint, full-suite verification, push, PR

**Files:** none (verification + PR).

- [ ] **Step 1: Lint the project**

Run: `NX_DAEMON=false npx nx lint pack-football-ui --skip-nx-cache`
Expected: `Successfully ran target lint` with **0 errors** (pre-existing warnings count unchanged — ~78, none in the new/edited files).

- [ ] **Step 2: Build the lib + the consuming app**

Run: `NX_DAEMON=false npx nx build pack-football-ui --skip-nx-cache && NX_DAEMON=false npx nx build pack-football-visual-editor --skip-nx-cache`
Expected: both green.

- [ ] **Step 3: Run the full pack-football-ui suite (coverage-OOM workaround)**

Run: `NODE_OPTIONS="--max-old-space-size=8192" VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 NX_DAEMON=false npx nx test pack-football-ui --skip-nx-cache --coverage=false`
Expected: all tests pass (≈1015 + the new specs), 0 failed. (The default coverage+multi-fork run OOMs on this machine — a known infra issue, not a code defect.)

- [ ] **Step 4: Push the branch**

```bash
git push -u origin <feature-branch>
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --repo de-braighter/exercir --title "feat(pack-football-ui): shared persistent live-region + training step-position (exercir#178)" --body "$(cat <<'EOF'
## What

Closes the deferred #177 a11y-pro findings F5 + F2 across all six player surfaces.

- **F5 (WCAG 4.1.3):** new shared `FcStatusLiveComponent` — one persistent visually-hidden `role="status" aria-live="polite"` region per surface, mounted outside the `@switch`, bound to `liveStatusMessage(kind, noun, reason?)`. The visible `@case` status nodes lose their live-region roles, so there is exactly one announcer and the previously-silent `loaded` transition now announces. Adopted in Form / Mein Training / Mein Trichter / Protokoll / Team / Nächstes Spiel.
- **F2 (WCAG 1.3.1):** training periodization phases announce `Phase n von N` via the `@for` ordinals.

## How

`libs/pack-football-ui/src/lib/a11y/` — `status-live.component.ts` + `live-status-message.ts` (pure, one place for the German copy). Funnel failed copy normalized parentheses → colon for hidden/visible parity. The funnel's nested what-if sub-region is intentionally out of scope (what-if lane).

## Tests

New `live-status-message.spec.ts` + `status-live.component.spec.ts`; each surface spec asserts exactly one persistent region and that visible nodes dropped `role="status"`; training asserts the `Phase n von N` sr-only fragment. axe-core green per surface. Full suite green via single-fork (the coverage×pool OOM is infra).

Closes #178

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, test-driven-development]
Effect: cycle-time 0.02±0.03 expert
EOF
)"
```

- [ ] **Step 6: Run the verifier wave** (orchestrator dispatches `local-ci` + `reviewer` + `qa-engineer` + `charter-checker` + `exercir-charter-checker` in worktree isolation). Address findings, then merge per the standard flow + the mandatory devloop twin ritual (`drain exercir#<pr>` → `backfill de-braighter/exercir` → `reconcile` → `retro`).

---

## Self-review

**Spec coverage:** F5 shared helper → Tasks 1+2; all-6 adoption → Tasks 3–8; F2 training step-position → Task 4; per-surface + helper tests → each task's Step 1 + Tasks 1–2; non-goals (no data/contract change, funnel what-if deferred, no coach surfaces, no i18n) → respected (only `a11y/` added + template/attr edits). All spec deliverables D1–D4 mapped.

**Placeholder scan:** no TBD/TODO; every code step shows real code. The only soft references are the per-surface spec render helpers (`renderLoaded`/`renderWith`) — these are existing helpers in each spec file, and Step 1 instructs matching the file's existing helper names with a concrete fallback (never-resolving mock + single `detectChanges`).

**Type consistency:** `liveStatusMessage(kind, noun, reason?)` signature + `LoadKind` union are used identically in Tasks 1, 3–8; `FcStatusLiveComponent` selector `fc-status-live` + `message` input consistent across Task 2 and all adoptions; `data-testid="fc-status-live"` consistent in component + every surface test.

**Correction vs spec:** the spec's "centralise the `.sr-only`" is *not* done — each surface keeps its own `.sr-only` for other hidden spans (delta words, Kapitän, stateWord); the component carries its own scoped copy only. Functionally equivalent; noted for the implementer.
