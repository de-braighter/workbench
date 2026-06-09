# Gridiron S8 — UI Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a control to the what-if page that switches the ranking basis live — **Pooled EPA · Pooled WPA · Decision-value** — so the conservative pooled recommendation visibly becomes the aggressive decision-value recommendation on the same situation.

**Architecture:** The response shape (`SituationReadout`) is identical across modes, so `arms-display` is unchanged — only the request gains `mode` + `indicatorKey`, a new accessible segmented control emits the basis, and the app re-runs the readout on change. Mirrors the existing Angular patterns (standalone, signals, Karma/Jasmine, **extensionless imports**).

**Tech Stack:** Angular 19 standalone + signals, `HttpClient`, Zod, Karma/Jasmine (ChromeHeadless).

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-approach-b-decision-value-design.md` §5.

**Depends on:** S6 (`indicatorKey`) + S7 (`mode: 'pooled'|'decision-value'`) on the api. The three UI options map to: `pooled-epa`→`{mode:'pooled',indicatorKey:'gridiron.epa'}`, `pooled-wpa`→`{mode:'pooled',indicatorKey:'gridiron.wpa'}`, `decision-value`→`{mode:'decision-value'}`.

**Conventions:** `apps/gridiron-web` uses **extensionless** relative imports (no `.js`) and **Jasmine** specs (no `vitest` import; `jasmine.createSpy()`). `[ngClass]` not `[class]`. Run tests: `pnpm -C D:/development/projects/de-braighter/domains/gridiron --filter @de-braighter/gridiron-web test`. Commit bodies end `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Don't leave cwd changed.

---

## File structure (S8)

| Path | Change | Task |
|---|---|---|
| `apps/gridiron-web/src/app/data/situation-readout.wire.ts` | `RankingBasis` type + request `mode`/`indicatorKey` | 1 |
| `apps/gridiron-web/src/app/data/gridiron-client.ts` | `situationReadout(archetype, basis)` | 1 |
| `apps/gridiron-web/src/app/what-if/mode-toggle.component.ts` (new) | accessible segmented control | 2 |
| `apps/gridiron-web/src/app/app.component.ts` | hold basis, re-run on change | 3 |
| live | serve + verify the flip | 4 |

---

## Task 1: Request gains a ranking basis (wire + client)

**Files:** Modify `data/situation-readout.wire.ts`, `data/gridiron-client.ts`; Test `data/gridiron-client.spec.ts`

- [ ] **Step 1: Failing test** (Jasmine + HttpTestingController) — `situationReadout(arch, 'pooled-wpa')` POSTs `{...arch, indicatorKey:'gridiron.wpa'}`; `'decision-value'` POSTs `{...arch, mode:'decision-value'}`:

```ts
it('maps basis -> request body', async () => {
  const p = client.situationReadout({ distance:'short', field:'opp-side', score:'trail', time:'q4-early' }, 'decision-value');
  const req = http.expectOne('/api/gridiron/situation-readout');
  expect(req.request.body).toEqual({ distance:'short', field:'opp-side', score:'trail', time:'q4-early', mode:'decision-value' });
  req.flush({ situationKey:'x', arms:[{decision:'go',mean:1,p10:0,p50:1,p90:2,sd:0.3,evidence:'sufficient'}], recommendedArm:'go', statusQuoArm:'punt', liftMean:0.5, direction:'improves' });
  await p;
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement**

```ts
// situation-readout.wire.ts — add:
export type RankingBasis = 'pooled-epa' | 'pooled-wpa' | 'decision-value';
```

```ts
// gridiron-client.ts
async situationReadout(archetype: SituationArchetypeRequest, basis: RankingBasis = 'pooled-epa'): Promise<SituationReadoutWire> {
  const body =
    basis === 'pooled-wpa'     ? { ...archetype, indicatorKey: 'gridiron.wpa' }
  : basis === 'decision-value' ? { ...archetype, mode: 'decision-value' }
  :                              { ...archetype };   // pooled-epa = defaults
  const raw = await firstValueFrom(this.http.post<unknown>('/api/gridiron/situation-readout', body));
  return SituationReadoutWireSchema.parse(raw);
}
```

- [ ] **Step 4: Run → pass.** **Commit** — `feat(gridiron-web): client maps ranking basis to request`.

---

## Task 2: Accessible mode-toggle component

**Files:** Create `what-if/mode-toggle.component.ts` (+ spec)

- [ ] **Step 1: Failing test** — renders a labelled `radiogroup` of 3 options, emits the basis on selection, default `pooled-epa` checked:

```ts
it('is a labelled radiogroup that emits the chosen basis', () => {
  const fixture = TestBed.createComponent(ModeToggleComponent);
  const emitted: string[] = [];
  fixture.componentInstance.basisChange.subscribe((b: string) => emitted.push(b));
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  expect(el.querySelector('[role="radiogroup"]')).toBeTruthy();
  const radios = el.querySelectorAll('input[type="radio"]');
  expect(radios.length).toBe(3);
  const dv = el.querySelector<HTMLInputElement>('#basis-decision-value')!;
  dv.click(); fixture.detectChanges();
  expect(emitted.at(-1)).toBe('decision-value');
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — a standalone OnPush component, selector `gp-mode-toggle`, `@Output() basisChange`, three radios in a `<fieldset role="radiogroup">` with a `<legend>`, 44px targets, labels:

```ts
import { ChangeDetectionStrategy, Component, EventEmitter, Output, signal } from '@angular/core';
import type { RankingBasis } from '../data/situation-readout.wire';

const OPTIONS: { id: RankingBasis; label: string }[] = [
  { id: 'pooled-epa', label: 'Pooled EPA' },
  { id: 'pooled-wpa', label: 'Pooled WPA' },
  { id: 'decision-value', label: 'Decision value' },
];

@Component({
  selector: 'gp-mode-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`fieldset{border:0;padding:0;display:flex;gap:.5rem;flex-wrap:wrap}
    label{display:inline-flex;align-items:center;gap:.35rem;min-height:44px;padding:0 .5rem;cursor:pointer}`],
  template: `
    <fieldset role="radiogroup">
      <legend>Ranking basis</legend>
      @for (opt of options; track opt.id) {
        <label [attr.for]="'basis-' + opt.id">
          <input type="radio" name="basis" [id]="'basis-' + opt.id" [value]="opt.id"
                 [checked]="opt.id === value()" (change)="pick(opt.id)" />
          {{ opt.label }}
        </label>
      }
    </fieldset>
  `,
})
export class ModeToggleComponent {
  @Output() readonly basisChange = new EventEmitter<RankingBasis>();
  protected readonly options = OPTIONS;
  protected readonly value = signal<RankingBasis>('pooled-epa');
  protected pick(b: RankingBasis): void { this.value.set(b); this.basisChange.emit(b); }
}
```

- [ ] **Step 4: Run → pass.** **Commit** — `feat(gridiron-web): accessible ranking-basis toggle`.

---

## Task 3: Wire the toggle into the page

**Files:** Modify `app.component.ts` (+ spec if present)

- [ ] **Step 1: Failing test / behavior** — selecting a basis re-runs the readout with that basis for the current archetype. If the app component has a spec, assert the client is called with the basis; otherwise cover via the client spec (Task 1) + the live check (Task 4) and keep this a wiring step.

- [ ] **Step 2: Implement** — import `ModeToggleComponent`; hold `basis = signal<RankingBasis>('pooled-epa')` and the last `archetype = signal<SituationArchetypeRequest | null>(...)`; on either picker change or basis change, call `client.situationReadout(archetype, basis())`:

```ts
// template: add <gp-mode-toggle (basisChange)="onBasis($event)" /> above the picker
imports: [SituationPickerComponent, ModeToggleComponent, ArmsDisplayComponent],
// ...
protected onBasis(b: RankingBasis): void { this.basis.set(b); const a = this.archetype(); if (a) this.run(a); }
// in run(archetype): store it (this.archetype.set(archetype)) and call client.situationReadout(archetype, this.basis())
```
Keep the existing loading/error/`aria-live` recommendation (it re-announces on each recompute).

- [ ] **Step 3: Build + full gate** — `pnpm -C D:/development/projects/de-braighter/domains/gridiron run ci:local` (green; UI test script is already non-watch).

- [ ] **Step 4: Commit** — `feat(gridiron-web): wire ranking-basis toggle into the what-if page`.

---

## Task 4: Live — see the recommendation flip

**Verification task.** From `D:/development/projects/de-braighter/domains/gridiron` (S7 ingest done; api + UI built).

- [ ] **Step 1: Serve**

```bash
node --env-file=.env apps/gridiron-api/dist/main.js &      # :3400
pnpm --filter @de-braighter/gridiron-web start             # :4300
```

- [ ] **Step 2: Drive** — open `http://localhost:4300`, pick `short / opp-side / trail / q4-early`. Toggle the basis:
  - **Pooled EPA** → recommendation likely conservative (kick/punt) — the slice-5 behavior.
  - **Decision value** → recommendation flips to **go**, with a positive lift over punt.
  The arms, delta strip, posterior bars, table, and "vs. the bot" badge recompute per basis; the `aria-live` recommendation re-announces.

- [ ] **Step 3: a11y smoke** — the basis control is a keyboard-operable radiogroup with a legend + labels (Tab/arrow keys), 44px targets; (optional) an axe/Lighthouse pass shows no new critical violations.

- [ ] **Step 4: Record** — append "S8 — mode toggle" to `domains/gridiron/README.md` (a screenshot of the flip is nice), commit.

---

## Self-Review

**Spec coverage (§5):** three-option basis control (Pooled EPA / Pooled WPA / Decision-value) ✅ (T2); request mapping ✅ (T1); live recompute + recommendation/badge update ✅ (T3,T4); a11y (labelled radiogroup, 44px, live-region re-announce) ✅ (T2,T3,T4). Response shape unchanged → `arms-display` untouched (correct).

**Placeholder scan:** none — all component + client code shown; T3's spec is conditioned on whether `app.component.spec` exists (with the client-spec + live check as the guaranteed coverage).

**Type consistency:** `RankingBasis = 'pooled-epa'|'pooled-wpa'|'decision-value'` used identically in the wire type, client, toggle, and app; client `situationReadout(archetype, basis)`; selectors `gp-mode-toggle`. Extensionless imports + Jasmine throughout (matches the app).

**Scope:** Contained UI slice atop S6+S7's api. No api change.
