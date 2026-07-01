# Gridiron Slice 3 — What-If Angular UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `gridiron-web` page where a coach/analyst selects a 4th-down situation (the four aspect dropdowns), and the app calls `POST /gridiron/situation-readout`, then renders the three arms (go/punt/kick) ranked by mean EPA with a recommended-arm badge, a delta strip (lift over punt, direction icon + text + screen-reader sentence), per-arm posterior bars (mean + p10–p90), and an accessible table fallback.

**Architecture:** Standalone Angular components (mirroring `domains/markets/apps/markets-ui`). A thin `GridironClient` calls the api through the dev proxy (which injects the tenant/pack/user headers). All presentation logic (lift text, SR sentence, direction icon, bar geometry, wire→view-model mapping) lives in **pure functions** so the WCAG-critical behaviour is unit-tested independently of the DOM. The posterior visualization is a **gridiron-local** component (3 bars), NOT a cross-domain import of exercir's `posterior-comparison-chart` — domains stay isolated (ADR-027); promoting a shared chart to `design-system` is deferred (ADR-168 "promote on the 2nd real consumer", which would be this + exercir).

**Tech Stack:** Angular (standalone components + signals), `HttpClient`, Zod (wire validation), Vitest (or the app's scaffolded test runner). de/en i18n per ADR-012 where a catalog exists.

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-nfl-4th-down-what-if-design.md` §8.

**Depends on:** Slice 2 (`POST /gridiron/situation-readout` returns `{ situationKey, arms[], recommendedArm, statusQuoArm, liftMean, direction }`).

**Conventions to mirror (read before coding):**
- `domains/markets/apps/markets-ui/src/app/` — app.component, the data service, child component, `app.config.ts`, `proxy.conf.json`.
- `domains/exercir/libs/pack-football-ui/src/lib/player/ui/player-what-if-chrome.component.ts` — the delta-strip a11y pattern (icon + lift text + `sr-only` sentence; WCAG 1.4.1 not-color-alone) to imitate (do **not** import it).
- `domains/exercir/libs/pack-football-ui/src/lib/data/wire-schemas.ts` — the zod wire-schema style.

---

## File structure (slice 3)

| Path | Responsibility | Task |
|---|---|---|
| `apps/gridiron-web/src/app/data/situation-readout.wire.ts` | zod wire schema + types for the readout response | 1 |
| `apps/gridiron-web/src/app/data/gridiron-client.ts` | `HttpClient` POST to `/api/gridiron/situation-readout` | 2 |
| `apps/gridiron-web/src/app/what-if/what-if-view-model.ts` | pure: wire → view model (lift text, SR sentence, icon, bar geometry) | 3 |
| `apps/gridiron-web/src/app/what-if/situation-picker.component.ts` | four labelled selects → emits a `SituationArchetype` | 4 |
| `apps/gridiron-web/src/app/what-if/arms-display.component.ts` | ranked arms + recommended badge + delta strip + bars + table | 5 |
| `apps/gridiron-web/src/app/app.component.ts` (modify) | compose picker + display; call client; loading/error/live region | 6 |
| `apps/gridiron-web/proxy.conf.json` (modify) | proxy `/api` → `:3400`, `x-pack-id: gridiron` | 6 |

---

## Task 1: Readout wire schema (web)

**Files:**
- Create: `apps/gridiron-web/src/app/data/situation-readout.wire.ts`
- Test: `apps/gridiron-web/src/app/data/situation-readout.wire.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/gridiron-web/src/app/data/situation-readout.wire.spec.ts
import { describe, expect, it } from 'vitest';
import { SituationReadoutWireSchema } from './situation-readout.wire.js';

const ok = {
  situationKey: 'short|opp-side|trail|q4-early',
  arms: [
    { decision: 'go', mean: 0.42, p10: -0.6, p50: 0.4, p90: 1.4, sd: 0.8 },
    { decision: 'kick', mean: 0.05, p10: -0.9, p50: 0.05, p90: 1.0, sd: 0.7 },
    { decision: 'punt', mean: -0.1, p10: -1.0, p50: -0.1, p90: 0.8, sd: 0.6 },
  ],
  recommendedArm: 'go',
  statusQuoArm: 'punt',
  liftMean: 0.52,
  direction: 'improves',
};

describe('SituationReadoutWireSchema', () => {
  it('parses a valid readout', () => {
    expect(SituationReadoutWireSchema.parse(ok).recommendedArm).toBe('go');
  });
  it('rejects an unknown decision', () => {
    const bad = { ...ok, arms: [{ ...ok.arms[0], decision: 'sneak' }] };
    expect(() => SituationReadoutWireSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/data/situation-readout.wire.spec.ts`
Expected: FAIL — module not found.
> If gridiron-web's test runner is not vitest (check its `test` target / config), use that runner's equivalent invocation here and in later web tasks.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-web/src/app/data/situation-readout.wire.ts
import { z } from 'zod';

export const ArmWireSchema = z.object({
  decision: z.enum(['go', 'punt', 'kick']),
  mean: z.number(),
  p10: z.number(),
  p50: z.number(),
  p90: z.number(),
  sd: z.number(),
});

export const SituationReadoutWireSchema = z.object({
  situationKey: z.string(),
  arms: z.array(ArmWireSchema).min(1),
  recommendedArm: z.enum(['go', 'punt', 'kick']),
  statusQuoArm: z.enum(['go', 'punt', 'kick']),
  liftMean: z.number(),
  direction: z.enum(['improves', 'worsens', 'flat']),
});

export type ArmWire = z.infer<typeof ArmWireSchema>;
export type SituationReadoutWire = z.infer<typeof SituationReadoutWireSchema>;

export interface SituationArchetypeRequest {
  distance: 'short' | 'medium' | 'long';
  field: 'own-deep' | 'own-mid' | 'midfield' | 'opp-side' | 'fringe';
  score: 'trail-big' | 'trail' | 'close' | 'lead' | 'lead-big';
  time: '1st-half' | 'q3' | 'q4-early' | '2-min';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/data/situation-readout.wire.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-web/src/app/data/situation-readout.wire.ts apps/gridiron-web/src/app/data/situation-readout.wire.spec.ts
git commit -m "feat(gridiron-web): situation-readout wire schema"
```

---

## Task 2: Gridiron HTTP client (web)

**Files:**
- Create: `apps/gridiron-web/src/app/data/gridiron-client.ts`
- Test: `apps/gridiron-web/src/app/data/gridiron-client.spec.ts`

- [ ] **Step 1: Write the failing test** (Angular `HttpTestingController`)

```ts
// apps/gridiron-web/src/app/data/gridiron-client.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { GridironClient } from './gridiron-client.js';

describe('GridironClient', () => {
  let client: GridironClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [GridironClient, provideHttpClient(), provideHttpClientTesting()] });
    client = TestBed.inject(GridironClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('POSTs the archetype and validates the response', async () => {
    const promise = client.situationReadout({ distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early' });
    const req = http.expectOne('/api/gridiron/situation-readout');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early' });
    req.flush({
      situationKey: 'short|opp-side|trail|q4-early',
      arms: [{ decision: 'go', mean: 0.4, p10: -0.6, p50: 0.4, p90: 1.4, sd: 0.8 }],
      recommendedArm: 'go', statusQuoArm: 'punt', liftMean: 0.5, direction: 'improves',
    });
    const out = await promise;
    expect(out.recommendedArm).toBe('go');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/data/gridiron-client.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-web/src/app/data/gridiron-client.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SituationReadoutWireSchema, type SituationArchetypeRequest, type SituationReadoutWire } from './situation-readout.wire.js';

@Injectable({ providedIn: 'root' })
export class GridironClient {
  private readonly http = inject(HttpClient);

  async situationReadout(archetype: SituationArchetypeRequest): Promise<SituationReadoutWire> {
    const raw = await firstValueFrom(this.http.post<unknown>('/api/gridiron/situation-readout', archetype));
    return SituationReadoutWireSchema.parse(raw);
  }
}
```
> Confirm the base path: markets-ui proxies `/api` → the api with `pathRewrite ^/api → ''`, so the client path is `/api/gridiron/situation-readout`. Match whatever `proxy.conf.json` rewrite gridiron-web uses (set in Task 6).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/data/gridiron-client.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-web/src/app/data/gridiron-client.ts apps/gridiron-web/src/app/data/gridiron-client.spec.ts
git commit -m "feat(gridiron-web): situation-readout http client"
```

---

## Task 3: Pure view-model (lift text, SR sentence, icon, bar geometry)

**Files:**
- Create: `apps/gridiron-web/src/app/what-if/what-if-view-model.ts`
- Test: `apps/gridiron-web/src/app/what-if/what-if-view-model.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/gridiron-web/src/app/what-if/what-if-view-model.spec.ts
import { describe, expect, it } from 'vitest';
import { armBarGeometry, directionIcon, liftText, recommendationSentence } from './what-if-view-model.js';

describe('what-if view model', () => {
  it('formats lift in expected points with a sign', () => {
    expect(liftText(0.52)).toBe('+0.52 EP');
    expect(liftText(-0.30)).toBe('-0.30 EP');
    expect(liftText(0)).toBe('+0.00 EP');
  });

  it('maps direction to a non-color icon', () => {
    expect(directionIcon('improves')).toBe('▲');
    expect(directionIcon('worsens')).toBe('▼');
    expect(directionIcon('flat')).toBe('—');
  });

  it('builds a full screen-reader sentence (WCAG 1.4.1 — never color alone)', () => {
    expect(recommendationSentence('go', 'improves', 0.52)).toBe(
      'Recommended decision: go for it. +0.52 expected points versus punting.',
    );
    expect(recommendationSentence('punt', 'flat', 0)).toBe(
      'Recommended decision: punt. No meaningful difference versus punting.',
    );
  });

  it('maps an arm summary to bar geometry on a fixed EPA domain [-3, 3]', () => {
    const g = armBarGeometry({ mean: 0, p10: -1.5, p90: 1.5 });
    expect(g.meanPct).toBeCloseTo(50, 5);
    expect(g.p10Pct).toBeCloseTo(25, 5);
    expect(g.p90Pct).toBeCloseTo(75, 5);
    // clamps out-of-domain values
    expect(armBarGeometry({ mean: 5, p10: -9, p90: 9 })).toEqual({ meanPct: 100, p10Pct: 0, p90Pct: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/what-if-view-model.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-web/src/app/what-if/what-if-view-model.ts
export type Direction = 'improves' | 'worsens' | 'flat';
export type Arm = 'go' | 'punt' | 'kick';

const EPA_MIN = -3;
const EPA_MAX = 3;

const ARM_PHRASE: Record<Arm, string> = { go: 'go for it', punt: 'punt', kick: 'kick a field goal' };

export function liftText(liftMean: number): string {
  const sign = liftMean < 0 ? '-' : '+';
  return `${sign}${Math.abs(liftMean).toFixed(2)} EP`;
}

export function directionIcon(direction: Direction): string {
  return direction === 'improves' ? '▲' : direction === 'worsens' ? '▼' : '—';
}

export function recommendationSentence(recommended: Arm, direction: Direction, liftMean: number): string {
  const head = `Recommended decision: ${ARM_PHRASE[recommended]}.`;
  if (direction === 'flat') return `${head} No meaningful difference versus punting.`;
  return `${head} ${liftText(liftMean)} expected points versus punting.`;
}

function pct(value: number): number {
  const clamped = Math.min(EPA_MAX, Math.max(EPA_MIN, value));
  return ((clamped - EPA_MIN) / (EPA_MAX - EPA_MIN)) * 100;
}

export interface BarGeometry {
  meanPct: number;
  p10Pct: number;
  p90Pct: number;
}

export function armBarGeometry(summary: { mean: number; p10: number; p90: number }): BarGeometry {
  return { meanPct: pct(summary.mean), p10Pct: pct(summary.p10), p90Pct: pct(summary.p90) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/what-if-view-model.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-web/src/app/what-if/what-if-view-model.ts apps/gridiron-web/src/app/what-if/what-if-view-model.spec.ts
git commit -m "feat(gridiron-web): pure what-if view model (lift text, sr sentence, bars)"
```

---

## Task 4: Situation picker component (web)

**Files:**
- Create: `apps/gridiron-web/src/app/what-if/situation-picker.component.ts`
- Test: `apps/gridiron-web/src/app/what-if/situation-picker.component.spec.ts`

- [ ] **Step 1: Write the failing test** (Angular TestBed DOM)

```ts
// apps/gridiron-web/src/app/what-if/situation-picker.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SituationPickerComponent } from './situation-picker.component.js';

describe('SituationPickerComponent', () => {
  it('renders four labelled selects and emits the chosen archetype', async () => {
    const fixture = TestBed.createComponent(SituationPickerComponent);
    const emitted: unknown[] = [];
    fixture.componentInstance.archetypeChange.subscribe((a) => emitted.push(a));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const selects = el.querySelectorAll('select');
    expect(selects).toHaveLength(4);
    // every select has an associated label
    selects.forEach((s) => {
      const id = s.getAttribute('id');
      expect(el.querySelector(`label[for="${id}"]`)).toBeTruthy();
    });

    const distance = el.querySelector<HTMLSelectElement>('#gp-distance')!;
    distance.value = 'short';
    distance.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted.at(-1)).toMatchObject({ distance: 'short' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/situation-picker.component.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-web/src/app/what-if/situation-picker.component.ts
import { ChangeDetectionStrategy, Component, EventEmitter, Output, signal } from '@angular/core';
import type { SituationArchetypeRequest } from '../data/situation-readout.wire.js';

const OPTIONS = {
  distance: ['short', 'medium', 'long'],
  field: ['own-deep', 'own-mid', 'midfield', 'opp-side', 'fringe'],
  score: ['trail-big', 'trail', 'close', 'lead', 'lead-big'],
  time: ['1st-half', 'q3', 'q4-early', '2-min'],
} as const;

@Component({
  selector: 'gp-situation-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .grid { display: grid; gap: .75rem; }
    label { display: block; font-weight: 600; }
    select { min-height: 44px; min-width: 44px; width: 100%; } /* WCAG 2.5.8 target size */
  `],
  template: `
    <fieldset class="grid">
      <legend>4th-down situation</legend>
      @for (aspect of aspects; track aspect.key) {
        <div>
          <label [attr.for]="'gp-' + aspect.key">{{ aspect.label }}</label>
          <select [id]="'gp-' + aspect.key" [value]="value()[aspect.key]"
                  (change)="pick(aspect.key, $any($event.target).value)">
            @for (opt of aspect.options; track opt) {
              <option [value]="opt">{{ opt }}</option>
            }
          </select>
        </div>
      }
    </fieldset>
  `,
})
export class SituationPickerComponent {
  @Output() readonly archetypeChange = new EventEmitter<SituationArchetypeRequest>();

  protected readonly aspects = [
    { key: 'distance' as const, label: 'Distance to go', options: OPTIONS.distance },
    { key: 'field' as const, label: 'Field position', options: OPTIONS.field },
    { key: 'score' as const, label: 'Score', options: OPTIONS.score },
    { key: 'time' as const, label: 'Time', options: OPTIONS.time },
  ];

  protected readonly value = signal<SituationArchetypeRequest>({
    distance: 'short', field: 'opp-side', score: 'trail', time: 'q4-early',
  });

  protected pick(key: keyof SituationArchetypeRequest, v: string): void {
    this.value.update((cur) => ({ ...cur, [key]: v }));
    this.archetypeChange.emit(this.value());
  }
}
```
> i18n: the aspect labels + option text should resolve through the app's de/en catalog if `/new-domain` scaffolded one (ADR-012); otherwise English for v1 — flag this in the PR.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/situation-picker.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-web/src/app/what-if/situation-picker.component.ts apps/gridiron-web/src/app/what-if/situation-picker.component.spec.ts
git commit -m "feat(gridiron-web): 4th-down situation picker (labelled, 44px targets)"
```

---

## Task 5: Arms display component (web)

**Files:**
- Create: `apps/gridiron-web/src/app/what-if/arms-display.component.ts`
- Test: `apps/gridiron-web/src/app/what-if/arms-display.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/gridiron-web/src/app/what-if/arms-display.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ArmsDisplayComponent } from './arms-display.component.js';
import type { SituationReadoutWire } from '../data/situation-readout.wire.js';

const readout: SituationReadoutWire = {
  situationKey: 'short|opp-side|trail|q4-early',
  arms: [
    { decision: 'go', mean: 0.42, p10: -0.6, p50: 0.4, p90: 1.4, sd: 0.8 },
    { decision: 'kick', mean: 0.05, p10: -0.9, p50: 0.05, p90: 1.0, sd: 0.7 },
    { decision: 'punt', mean: -0.1, p10: -1.0, p50: -0.1, p90: 0.8, sd: 0.6 },
  ],
  recommendedArm: 'go', statusQuoArm: 'punt', liftMean: 0.52, direction: 'improves',
};

describe('ArmsDisplayComponent', () => {
  it('shows the recommendation with icon + text + screen-reader sentence, and an accessible table', () => {
    const fixture = TestBed.createComponent(ArmsDisplayComponent);
    fixture.componentRef.setInput('readout', readout);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    // direction is conveyed three ways (WCAG 1.4.1)
    expect(el.querySelector('.delta .dir-icon')?.textContent).toContain('▲');
    expect(el.querySelector('.delta .lift')?.textContent).toContain('+0.52 EP');
    expect(el.querySelector('.delta .sr-only')?.textContent).toContain('go for it');

    // recommendation announced politely
    expect(el.querySelector('[aria-live="polite"]')).toBeTruthy();

    // accessible table fallback with one row per arm
    const rows = el.querySelectorAll('table tbody tr');
    expect(rows).toHaveLength(3);

    // recommended arm is marked (not by color alone)
    expect(el.querySelector('.arm.recommended')?.textContent).toContain('go');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/arms-display.component.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/gridiron-web/src/app/what-if/arms-display.component.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { SituationReadoutWire } from '../data/situation-readout.wire.js';
import { armBarGeometry, directionIcon, liftText, recommendationSentence } from './what-if-view-model.js';

@Component({
  selector: 'gp-arms-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .delta { display: flex; align-items: center; gap: .5rem; font-weight: 700; }
    .dir-icon.improves { color: var(--accent, #1a7f37); }
    .dir-icon.worsens { color: var(--warn, #b3261e); }
    .arm { display: grid; grid-template-columns: 5rem 1fr; gap: .5rem; align-items: center; }
    .arm.recommended { outline: 2px solid var(--accent, #1a7f37); }
    .track { position: relative; height: 14px; background: var(--rail, #eee); }
    .whisker { position: absolute; height: 100%; background: var(--band, #cfe8d6); }
    .mean { position: absolute; width: 2px; height: 100%; background: var(--ink, #111); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `],
  template: `
    @let r = readout();
    <section>
      <p class="delta">
        <span class="dir-icon" [class]="r.direction">{{ icon() }}</span>
        <span class="lift">{{ lift() }}</span>
        <span class="sr-only">{{ sentence() }}</span>
      </p>
      <p aria-live="polite" class="recommendation">Recommended: <strong>{{ r.recommendedArm }}</strong></p>

      <ul class="arms">
        @for (arm of r.arms; track arm.decision) {
          <li class="arm" [class.recommended]="arm.decision === r.recommendedArm">
            <span>{{ arm.decision }}{{ arm.decision === r.recommendedArm ? ' ✓' : '' }}</span>
            <span class="track" [attr.aria-hidden]="true">
              <span class="whisker"
                    [style.left.%]="geo(arm).p10Pct"
                    [style.width.%]="geo(arm).p90Pct - geo(arm).p10Pct"></span>
              <span class="mean" [style.left.%]="geo(arm).meanPct"></span>
            </span>
          </li>
        }
      </ul>

      <table>
        <caption class="sr-only">Expected points (EPA) by 4th-down decision</caption>
        <thead><tr><th>Decision</th><th>Mean</th><th>p10</th><th>p50</th><th>p90</th></tr></thead>
        <tbody>
          @for (arm of r.arms; track arm.decision) {
            <tr>
              <td>{{ arm.decision }}</td><td>{{ arm.mean.toFixed(2) }}</td>
              <td>{{ arm.p10.toFixed(2) }}</td><td>{{ arm.p50.toFixed(2) }}</td><td>{{ arm.p90.toFixed(2) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class ArmsDisplayComponent {
  readonly readout = input.required<SituationReadoutWire>();

  protected readonly icon = computed(() => directionIcon(this.readout().direction));
  protected readonly lift = computed(() => liftText(this.readout().liftMean));
  protected readonly sentence = computed(() =>
    recommendationSentence(this.readout().recommendedArm, this.readout().direction, this.readout().liftMean),
  );

  protected geo(arm: { mean: number; p10: number; p90: number }) {
    return armBarGeometry(arm);
  }
}
```
> Confirm Angular version supports `@let` in templates (Angular 18.1+) and `input.required` (17.3+); the markets-ui scaffold pins the version — match it. If `@let` is unavailable, hoist `readout()` reads into `computed()` getters.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-web exec vitest run src/app/what-if/arms-display.component.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gridiron-web/src/app/what-if/arms-display.component.ts apps/gridiron-web/src/app/what-if/arms-display.component.spec.ts
git commit -m "feat(gridiron-web): arms display (recommended badge, delta a11y, bars, table)"
```

---

## Task 6: Compose the page + proxy config

**Files:**
- Modify: `apps/gridiron-web/src/app/app.component.ts`
- Modify: `apps/gridiron-web/proxy.conf.json`

- [ ] **Step 1: Compose picker + display in the app component**

Replace the scaffolded app component body with:

```ts
// apps/gridiron-web/src/app/app.component.ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { GridironClient } from './data/gridiron-client.js';
import type { SituationArchetypeRequest, SituationReadoutWire } from './data/situation-readout.wire.js';
import { ArmsDisplayComponent } from './what-if/arms-display.component.js';
import { SituationPickerComponent } from './what-if/situation-picker.component.js';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SituationPickerComponent, ArmsDisplayComponent],
  template: `
    <main>
      <h1>4th-down what-if</h1>
      <gp-situation-picker (archetypeChange)="run($event)" />
      @if (loading()) { <p aria-live="polite">Calculating…</p> }
      @else if (error()) { <p role="alert">{{ error() }}</p> }
      @else if (readout(); as r) { <gp-arms-display [readout]="r" /> }
    </main>
  `,
})
export class AppComponent {
  private readonly client = inject(GridironClient);
  protected readonly readout = signal<SituationReadoutWire | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async run(archetype: SituationArchetypeRequest): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.readout.set(await this.client.situationReadout(archetype));
    } catch {
      this.error.set('Could not load the recommendation. Try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
```
> Match the scaffolded app component's class name + selector. Confirm `app.config.ts` includes `provideHttpClient()` (markets-ui does); add it if missing.

- [ ] **Step 2: Point the proxy at the gridiron api**

Edit `apps/gridiron-web/proxy.conf.json` (mirror markets-ui, swap port + pack id):

```json
{
  "/api": {
    "target": "http://localhost:3400",
    "pathRewrite": { "^/api": "" },
    "changeOrigin": true,
    "headers": {
      "x-tenant-id": "10000000-0000-4000-8000-000000000001",
      "x-pack-id": "gridiron",
      "x-user-id": "00000000-0000-4000-8000-000000000001"
    }
  }
}
```
> Use the exact header names + tenant/user UUIDs the gridiron-api context guard expects (confirm against the api config / markets proxy).

- [ ] **Step 3: Build the web app**

Run: `pnpm --filter @de-braighter/gridiron-web build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/gridiron-web/src/app/app.component.ts apps/gridiron-web/proxy.conf.json
git commit -m "feat(gridiron-web): compose what-if page + proxy to gridiron-api"
```

---

## Task 7: Live verification (the page returns a recommendation)

**Verification task (not TDD).** Requires slice 2's api + ingested data. Run from `domains/gridiron/`.

- [ ] **Step 1: Start api + web**

Run:
```bash
pnpm --filter @de-braighter/gridiron-api start &     # :3400 (ensure data ingested per slice 2)
pnpm --filter @de-braighter/gridiron-web start &     # ng serve with proxy.conf.json on :4300
```

- [ ] **Step 2: Drive the page**

Open `http://localhost:4300`. Change the four selectors (e.g. distance=short, field=opp-side, score=trail, time=q4-early). Expected: a recommendation appears with a direction icon, a `+x.xx EP` lift, three arm bars (go/punt/kick), and the data table; the recommended arm is marked with `✓` and an outline. Toggle to a conservative situation (distance=long, field=own-deep, score=lead, time=1st-half) and confirm the recommendation flips toward `punt`.

- [ ] **Step 3: Quick a11y smoke**

- Tab through the four selects — each has a visible label and is keyboard operable.
- Confirm the `aria-live="polite"` recommendation updates on change.
- (Optional) run a Lighthouse / axe pass on `:4300`; no critical violations.

- [ ] **Step 4: Record the run + screenshot in the README**

Append a "Slice 3 — what-if UI" section to `domains/gridiron/README.md`, then:
```bash
git add domains/gridiron/README.md
git commit -m "docs(gridiron): slice-3 what-if UI run recipe"
```

---

## Self-Review

**Spec coverage (§8):** situation selectors ✅ (Task 4); three-arm ranked result + recommended badge ✅ (Task 5); delta strip with icon + lift + SR sentence (WCAG 1.4.1) ✅ (Tasks 3, 5); posterior bars + accessible table ✅ (Task 5); live region for the recommendation ✅ (Tasks 5, 6); 44px targets ✅ (Task 4). Oracle badge → deferred to slice 4 (validation). Chart reuse decision: gridiron-local component, no cross-domain import (ADR-027), design-system promotion deferred (ADR-168) — recorded in Architecture.

**Placeholder scan:** No deferred-work steps; all component + logic code shown. The `>` notes are verification-against-scaffold (test runner, Angular version, proxy headers, i18n catalog) — not placeholders.

**Type consistency:** `SituationArchetypeRequest` (four enums) feeds `GridironClient.situationReadout` → `SituationReadoutWire` (`arms`, `recommendedArm`, `statusQuoArm`, `liftMean`, `direction`); `Direction`/`Arm` literals match the wire enums; `armBarGeometry`/`directionIcon`/`liftText`/`recommendationSentence` signatures used identically in the view-model spec and the display component. Endpoint path `/api/gridiron/situation-readout` consistent across client, test, and proxy.

**Scope:** Single coherent UI slice consuming the slice-2 endpoint. Validation harness + oracle badge = slice 4.
