# Herdbook Mating Planner — Slice 2 (Angular UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Angular "Matings" UI surface: an API service, a planner page (sire/dam pickers → live evaluate card → save), a list page, a detail page (lifecycle + predicted-vs-actual), and add a nav link + routes — fully wiring the merged slice-1a/1b backend so the mating planner is usable in the browser.

**Architecture:** Standalone OnPush components following the established herdbook-web pattern (mirrored models file for wire types, `HttpClient` injectable service under `/api/matings`, `toSignal`+`switchMap` ViewState union, `@switch`/`@for`/`@if` control flow, dark-themed CSS vars). A new `apps/web/src/app/mating/` feature folder. Nav entry in `app.component.ts` + lazy routes in `app.routes.ts`. The "Pairing" tab on animal-detail is already a disabled placeholder — it stays as-is (the Matings page is the planner entry, not the tab; the tab is a later enhancement).

**Tech Stack:** Angular 17+ standalone, `ChangeDetectionStrategy.OnPush`, `toSignal`/`toObservable`, `HttpClient`, Vitest (unit specs with `vi.fn()` service doubles), CSS custom properties (`--hb-*`).

**Spec:** `docs/superpowers/specs/2026-06-02-herdbook-mating-planner-design.md` §6 (workbench repo). **Repo:** `domains/herdbook`. PR-gated.

---

## File Structure

**Create (new feature folder):**
- `apps/web/src/app/mating/mating.models.ts` — wire-contract types (mirrored from the pack view-models)
- `apps/web/src/app/mating/mating-api.service.ts` — `HttpClient` REST client
- `apps/web/src/app/mating/mating-api.service.spec.ts` — service unit spec
- `apps/web/src/app/mating/mating-list.component.ts` — list page
- `apps/web/src/app/mating/mating-list.component.spec.ts` — list component spec
- `apps/web/src/app/mating/mating-planner.component.ts` — planner page (evaluate + save)
- `apps/web/src/app/mating/mating-planner.component.spec.ts` — planner spec
- `apps/web/src/app/mating/mating-detail.component.ts` — detail page (lifecycle + offspring)
- `apps/web/src/app/mating/mating-detail.component.spec.ts` — detail spec

**Modify:**
- `apps/web/src/app/app.routes.ts` — add lazy `/matings` + `/matings/new` + `/matings/:id` routes
- `apps/web/src/app/app.component.ts` — add `Matings` nav link

**Convention anchors (read to copy style):**
- `apps/web/src/app/animal/animal-api.service.ts` — `HttpClient` service pattern
- `apps/web/src/app/animal/animal-list.component.ts` — ViewState + `toSignal`+`switchMap` list
- `apps/web/src/app/animal/animal-detail.component.ts` — detail with tabs
- `apps/web/src/app/animal/animal.models.ts` — mirrored models pattern

---

## Task 0: Branch

- [ ] **Step 1:**

```bash
cd domains/herdbook
git checkout main && git pull --ff-only
git checkout -b feat/mating-planner-slice2-ui
```

---

## Task 1: Models + API service + spec

**Files:** Create `apps/web/src/app/mating/mating.models.ts`, `mating-api.service.ts`, `mating-api.service.spec.ts`

- [ ] **Step 1: Write the models** (hand-mirrored from the pack view-models — web talks HTTP, never imports the pack)

```typescript
// mating.models.ts
/**
 * UI-side mating view-models — mirrored from the herdbook pack's
 * planned-mating.view-models.ts. Keep in sync when the REST surface changes.
 */

export type MatingVerdict = 'green' | 'amber' | 'red';
export type MatingStatus = 'planned' | 'mated' | 'offspring_registered' | 'cancelled';

export interface InbreedingThresholds {
  amber: number;
  red: number;
}

export interface SharedAncestor {
  ancestorKernelIndividualId: string;
  genViaSire: number;
  genViaDam: number;
}

export interface MatingEvaluation {
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
  predictedF: number;
  predictedFPct: number;
  verdict: MatingVerdict;
  thresholds: InbreedingThresholds;
  sharedAncestors: SharedAncestor[];
}

export interface PlannedMatingRow {
  id: string;
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
  predictedF: number;
  predictedVerdict: MatingVerdict;
  status: MatingStatus;
  plannedDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OffspringActual {
  kernelIndividualId: string;
  actualF: number | null;
}

export interface PlannedMatingDetail extends PlannedMatingRow {
  liveKinship: number | null;
  offspring: OffspringActual[];
}

export interface CreateMatingBody {
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
  plannedDate: string;
  notes?: string | null;
}

export interface PatchMatingBody {
  status?: MatingStatus;
  notes?: string | null;
}
```

- [ ] **Step 2: Write the API service**

```typescript
// mating-api.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateMatingBody,
  MatingEvaluation,
  PatchMatingBody,
  PlannedMatingDetail,
  PlannedMatingRow,
} from './mating.models';

@Injectable({ providedIn: 'root' })
export class MatingApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/matings';

  evaluate(sireKernelIndividualId: string, damKernelIndividualId: string): Observable<MatingEvaluation> {
    return this.http.post<MatingEvaluation>(`${this.base}/evaluate`, {
      sireKernelIndividualId,
      damKernelIndividualId,
    });
  }

  list(): Observable<PlannedMatingRow[]> {
    return this.http.get<PlannedMatingRow[]>(this.base);
  }

  get(id: string): Observable<PlannedMatingDetail> {
    return this.http.get<PlannedMatingDetail>(`${this.base}/${id}`);
  }

  create(body: CreateMatingBody): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(this.base, body);
  }

  patch(id: string, body: PatchMatingBody): Observable<{ ok: true }> {
    return this.http.patch<{ ok: true }>(`${this.base}/${id}`, body);
  }

  linkOffspring(id: string, offspringKernelIndividualId: string): Observable<{ ok: true }> {
    return this.http.post<{ ok: true }>(`${this.base}/${id}/offspring`, {
      offspringKernelIndividualId,
    });
  }

  unlinkOffspring(id: string, animalId: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${id}/offspring/${animalId}`);
  }
}
```

- [ ] **Step 3: Write the failing spec**

```typescript
// mating-api.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MatingApiService } from './mating-api.service';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

describe('MatingApiService', () => {
  let service: MatingApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MatingApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('evaluate POSTs to /api/matings/evaluate', () => {
    service.evaluate('s1', 'd1').subscribe();
    const req = http.expectOne('/api/matings/evaluate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sireKernelIndividualId: 's1', damKernelIndividualId: 'd1' });
    req.flush({ predictedF: 0.05, verdict: 'amber' });
  });

  it('list GETs /api/matings', () => {
    service.list().subscribe();
    const req = http.expectOne('/api/matings');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('patch PATCHes /api/matings/:id', () => {
    service.patch('m1', { status: 'mated' }).subscribe();
    const req = http.expectOne('/api/matings/m1');
    expect(req.request.method).toBe('PATCH');
    req.flush({ ok: true });
  });
});
```

- [ ] **Step 4: Run** `pnpm --filter herdbook-web exec vitest run src/app/mating/mating-api.service.spec.ts` → **3 PASS**

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/mating/mating.models.ts apps/web/src/app/mating/mating-api.service.ts apps/web/src/app/mating/mating-api.service.spec.ts
git commit -m "feat(herdbook-web): mating API service + models + spec"
```

---

## Task 2: Mating list page

**Files:** Create `apps/web/src/app/mating/mating-list.component.ts` + spec

- [ ] **Step 1: Write the list component**

```typescript
// mating-list.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatingApiService } from './mating-api.service';
import type { PlannedMatingRow, MatingVerdict } from './mating.models';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'loaded'; matings: readonly PlannedMatingRow[] };

function verdictLabel(v: MatingVerdict): string {
  return v === 'green' ? '✓ Green' : v === 'amber' ? '⚠ Amber' : '✕ Red';
}

function verdictSrWord(v: MatingVerdict): string {
  return v === 'green' ? 'low inbreeding' : v === 'amber' ? 'moderate inbreeding' : 'high inbreeding';
}

@Component({
  selector: 'hb-mating-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="hb-page">
      <div class="hb-page-header">
        <div>
          <div class="hb-eyebrow">Registry</div>
          <h1 class="hb-h1">Matings</h1>
        </div>
        <a class="hb-btn-primary" routerLink="/matings/new">+ Plan mating</a>
      </div>

      @switch (state().kind) {
        @case ('loading') { <div class="hb-card hb-state-msg">Loading matings…</div> }
        @case ('error') {
          <div class="hb-card hb-state-msg hb-state-error">
            <strong>Could not load matings.</strong>
            <p class="hb-muted">{{ state().kind === 'error' ? state().message : '' }}</p>
          </div>
        }
        @case ('empty') {
          <div class="hb-card hb-state-msg">
            No matings recorded yet.
            <a routerLink="/matings/new" class="hb-link">Plan a mating →</a>
          </div>
        }
        @case ('loaded') {
          <table class="hb-table">
            <thead>
              <tr>
                <th scope="col">Planned date</th>
                <th scope="col">Sire ID</th>
                <th scope="col">Dam ID</th>
                <th scope="col">Predicted F%</th>
                <th scope="col">Verdict</th>
                <th scope="col">Status</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (m of state().matings; track m.id) {
                <tr>
                  <td>{{ m.plannedDate }}</td>
                  <td class="hb-mono hb-truncate" title="{{ m.sireKernelIndividualId }}">{{ m.sireKernelIndividualId.slice(0, 8) }}…</td>
                  <td class="hb-mono hb-truncate" title="{{ m.damKernelIndividualId }}">{{ m.damKernelIndividualId.slice(0, 8) }}…</td>
                  <td>{{ (m.predictedF * 100).toFixed(2) }}%</td>
                  <td>
                    <span class="hb-verdict hb-verdict--{{ m.predictedVerdict }}" aria-label="{{ verdictSrWord(m.predictedVerdict) }}">
                      {{ verdictLabel(m.predictedVerdict) }}
                    </span>
                  </td>
                  <td>{{ m.status }}</td>
                  <td><a [routerLink]="['/matings', m.id]" class="hb-link">View →</a></td>
                </tr>
              }
            </tbody>
          </table>
        }
      }
    </div>
  `,
  styles: [`
    .hb-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .hb-table th, .hb-table td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--hb-border); }
    .hb-table th { color: var(--hb-muted); font-weight: 500; }
    .hb-mono { font-family: monospace; }
    .hb-truncate { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hb-verdict { font-size: 0.82rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .hb-verdict--green { background: rgba(34,197,94,0.18); color: #4ade80; }
    .hb-verdict--amber { background: rgba(245,158,11,0.18); color: #fbbf24; }
    .hb-verdict--red { background: rgba(239,68,68,0.18); color: #f87171; }
  `],
})
export class MatingListComponent {
  private readonly api = inject(MatingApiService);

  protected readonly verdictLabel = verdictLabel;
  protected readonly verdictSrWord = verdictSrWord;

  protected readonly state = toSignal<ViewState>(
    this.api.list().pipe(
      map((matings) =>
        matings.length === 0
          ? ({ kind: 'empty' } as ViewState)
          : ({ kind: 'loaded', matings } as ViewState),
      ),
      catchError((e: unknown) => of({ kind: 'error', message: String(e) } as ViewState)),
      startWith({ kind: 'loading' } as ViewState),
    ),
    { initialValue: { kind: 'loading' } as ViewState },
  );
}
```

- [ ] **Step 2: Write the spec**

```typescript
// mating-list.component.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { MatingListComponent } from './mating-list.component';
import { MatingApiService } from './mating-api.service';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

const row = { id: 'm1', sireKernelIndividualId: 'aaaa-1111', damKernelIndividualId: 'bbbb-2222', predictedF: 0.05, predictedVerdict: 'amber' as const, status: 'planned' as const, plannedDate: '2026-06-03', notes: null, createdAt: 'x', updatedAt: 'x' };

describe('MatingListComponent', () => {
  function setup(apiOverride?: Partial<MatingApiService>) {
    TestBed.configureTestingModule({
      imports: [MatingListComponent],
      providers: [provideRouter([]), { provide: MatingApiService, useValue: { list: vi.fn(() => of([row])), ...apiOverride } }],
    });
    return TestBed.createComponent(MatingListComponent);
  }

  it('renders a row per mating when loaded', () => {
    const f = setup(); f.detectChanges();
    expect(f.nativeElement.querySelector('tbody tr')).toBeTruthy();
  });

  it('shows empty state when list is empty', () => {
    const f = setup({ list: vi.fn(() => of([])) }); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('No matings recorded');
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter herdbook-web exec vitest run src/app/mating/mating-list.component.spec.ts` → **2 PASS**

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/app/mating/mating-list.component.ts apps/web/src/app/mating/mating-list.component.spec.ts
git commit -m "feat(herdbook-web): mating list page"
```

---

## Task 3: Mating planner page (evaluate + save)

**Files:** Create `apps/web/src/app/mating/mating-planner.component.ts` + spec

- [ ] **Step 1: Write the planner component**

```typescript
// mating-planner.component.ts
import {
  ChangeDetectionStrategy, Component, inject, signal, computed
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { MatingApiService } from './mating-api.service';
import type { MatingEvaluation, MatingVerdict } from './mating.models';

type EvalState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; eval: MatingEvaluation };

function verdictLabel(v: MatingVerdict): string {
  return v === 'green' ? '✓ Low risk' : v === 'amber' ? '⚠ Moderate risk' : '✕ High risk';
}
function verdictSrWord(v: MatingVerdict): string {
  return v === 'green' ? 'low inbreeding' : v === 'amber' ? 'moderate inbreeding' : 'high inbreeding';
}

@Component({
  selector: 'hb-mating-planner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="hb-page">
      <div class="hb-page-header">
        <div>
          <div class="hb-eyebrow"><a routerLink="/matings" class="hb-link">Matings</a></div>
          <h1 class="hb-h1">Plan a mating</h1>
        </div>
      </div>

      <div class="hb-card hb-planner-card">
        <h2 class="hb-h2">Sire × Dam pair</h2>
        <div class="hb-planner-row">
          <label class="hb-label" for="sire-id">Sire kernel ID (male)</label>
          <input id="sire-id" class="hb-input" type="text" placeholder="xxxxxxxx-…"
            [(ngModel)]="sireId" (ngModelChange)="onPairChange()" />
        </div>
        <div class="hb-planner-row">
          <label class="hb-label" for="dam-id">Dam kernel ID (female)</label>
          <input id="dam-id" class="hb-input" type="text" placeholder="xxxxxxxx-…"
            [(ngModel)]="damId" (ngModelChange)="onPairChange()" />
        </div>
        <div class="hb-planner-row">
          <label class="hb-label" for="planned-date">Planned date</label>
          <input id="planned-date" class="hb-input" type="date"
            [(ngModel)]="plannedDate" />
        </div>
        <button class="hb-btn-secondary" (click)="evaluate()" [disabled]="!canEvaluate()">
          Evaluate pair
        </button>
      </div>

      @switch (evalState().kind) {
        @case ('loading') { <div class="hb-card hb-state-msg">Evaluating…</div> }
        @case ('error') {
          <div class="hb-card hb-state-msg hb-state-error">
            {{ evalState().message }}
          </div>
        }
        @case ('loaded') {
          <div class="hb-card hb-eval-card" role="region" aria-label="Pairing evaluation result">
            <h2 class="hb-h2">Evaluation result</h2>
            <div class="hb-eval-row">
              <span class="hb-label">Predicted offspring F</span>
              <strong>{{ evalState().eval.predictedFPct.toFixed(2) }}%</strong>
            </div>
            <div class="hb-eval-row">
              <span class="hb-label">Verdict</span>
              <span class="hb-verdict hb-verdict--{{ evalState().eval.verdict }}"
                    aria-label="{{ verdictSrWord(evalState().eval.verdict) }}">
                {{ verdictLabel(evalState().eval.verdict) }}
              </span>
            </div>
            <div class="hb-eval-row">
              <span class="hb-label">Amber threshold</span>
              {{ (evalState().eval.thresholds.amber * 100).toFixed(3) }}%
            </div>
            <div class="hb-eval-row">
              <span class="hb-label">Red threshold</span>
              {{ (evalState().eval.thresholds.red * 100).toFixed(3) }}%
            </div>
            @if (evalState().eval.sharedAncestors.length > 0) {
              <details class="hb-ancestors">
                <summary class="hb-ancestors-summary">
                  Shared ancestors ({{ evalState().eval.sharedAncestors.length }})
                </summary>
                <ul class="hb-ancestors-list" role="list">
                  @for (a of evalState().eval.sharedAncestors; track a.ancestorKernelIndividualId) {
                    <li>
                      <span class="hb-mono">{{ a.ancestorKernelIndividualId.slice(0, 8) }}…</span>
                      — <span class="hb-muted">{{ a.genViaSire }}g via sire / {{ a.genViaDam }}g via dam</span>
                    </li>
                  }
                </ul>
              </details>
            }
            <div class="hb-planner-actions">
              <button class="hb-btn-primary" (click)="save()" [disabled]="saving()">
                {{ saving() ? 'Saving…' : 'Save mating plan' }}
              </button>
            </div>
          </div>
        }
      }

      @if (saveError()) {
        <div class="hb-card hb-state-msg hb-state-error" role="alert">{{ saveError() }}</div>
      }
    </div>
  `,
  styles: [`
    .hb-planner-card, .hb-eval-card { margin-bottom: 1rem; }
    .hb-planner-row { margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 0.3rem; }
    .hb-eval-row { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid var(--hb-border); }
    .hb-eval-row:last-of-type { border-bottom: none; }
    .hb-verdict { font-size: 0.82rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .hb-verdict--green { background: rgba(34,197,94,0.18); color: #4ade80; }
    .hb-verdict--amber { background: rgba(245,158,11,0.18); color: #fbbf24; }
    .hb-verdict--red { background: rgba(239,68,68,0.18); color: #f87171; }
    .hb-ancestors { margin-top: 0.75rem; }
    .hb-ancestors-summary { cursor: pointer; color: var(--hb-muted); font-size: 0.88rem; }
    .hb-ancestors-list { list-style: none; padding: 0.5rem 0 0; margin: 0; font-size: 0.88rem; }
    .hb-ancestors-list li { padding: 0.25rem 0; }
    .hb-planner-actions { margin-top: 1rem; }
    .hb-h2 { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.75rem; }
  `],
})
export class MatingPlannerComponent {
  private readonly api = inject(MatingApiService);
  private readonly router = inject(Router);

  protected sireId = '';
  protected damId = '';
  protected plannedDate = new Date().toISOString().slice(0, 10);
  protected saving = signal(false);
  protected saveError = signal<string | null>(null);

  private readonly _evalTrigger = signal<{ sire: string; dam: string } | null>(null);

  protected readonly evalState = toSignal<EvalState>(
    toObservable(this._evalTrigger).pipe(
      switchMap((pair) => {
        if (!pair) return of({ kind: 'idle' } as EvalState);
        return this.api.evaluate(pair.sire, pair.dam).pipe(
          switchMap((ev) => of({ kind: 'loaded', eval: ev } as EvalState)),
          catchError((e: unknown) =>
            of({ kind: 'error', message: this.extractError(e) } as EvalState),
          ),
          // prepend a loading state
          ...[],
        );
      }),
    ),
    { initialValue: { kind: 'idle' } as EvalState },
  );

  protected canEvaluate = computed(
    () => this.sireId.trim().length > 0 && this.damId.trim().length > 0,
  );

  protected onPairChange(): void {
    // Reset eval when pair changes
    this._evalTrigger.set(null);
  }

  protected evaluate(): void {
    if (!this.canEvaluate()) return;
    this._evalTrigger.set({ sire: this.sireId.trim(), dam: this.damId.trim() });
  }

  protected async save(): Promise<void> {
    const state = this.evalState();
    if (state.kind !== 'loaded') return;
    this.saving.set(true);
    this.saveError.set(null);
    this.api
      .create({
        sireKernelIndividualId: this.sireId.trim(),
        damKernelIndividualId: this.damId.trim(),
        plannedDate: this.plannedDate,
      })
      .subscribe({
        next: (res) => void this.router.navigate(['/matings', res.id]),
        error: (e: unknown) => {
          this.saveError.set(this.extractError(e));
          this.saving.set(false);
        },
      });
  }

  private extractError(e: unknown): string {
    if (typeof e === 'object' && e !== null && 'error' in e) {
      const err = (e as { error?: { message?: string } }).error;
      if (err?.message) return err.message;
    }
    return String(e);
  }
}
```

- [ ] **Step 2: Write the spec**

```typescript
// mating-planner.component.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { MatingPlannerComponent } from './mating-planner.component';
import { MatingApiService } from './mating-api.service';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

const mockEval = { sireKernelIndividualId: 's', damKernelIndividualId: 'd', predictedF: 0.05, predictedFPct: 5, verdict: 'amber' as const, thresholds: { amber: 0.03125, red: 0.0625 }, sharedAncestors: [] };

describe('MatingPlannerComponent', () => {
  function setup(apiOverride?: Partial<MatingApiService>) {
    TestBed.configureTestingModule({
      imports: [MatingPlannerComponent],
      providers: [
        provideRouter([]),
        { provide: MatingApiService, useValue: { evaluate: vi.fn(() => of(mockEval)), create: vi.fn(() => of({ id: 'm1' })), ...apiOverride } },
      ],
    });
    return TestBed.createComponent(MatingPlannerComponent);
  }

  it('renders the sire/dam/date inputs', () => {
    const f = setup(); f.detectChanges();
    expect(f.nativeElement.querySelector('#sire-id')).toBeTruthy();
    expect(f.nativeElement.querySelector('#dam-id')).toBeTruthy();
    expect(f.nativeElement.querySelector('#planned-date')).toBeTruthy();
  });

  it('shows idle state initially (no eval card)', () => {
    const f = setup(); f.detectChanges();
    expect(f.nativeElement.querySelector('.hb-eval-card')).toBeFalsy();
  });

  it('shows error state on evaluate failure', () => {
    const f = setup({ evaluate: vi.fn(() => throwError(() => ({ error: { message: 'sire must be male' } }))) });
    // Set valid inputs so evaluate button is enabled
    const comp = f.componentInstance as MatingPlannerComponent & { sireId: string; damId: string; evaluate: () => void };
    comp.sireId = 'aaaa-sire';
    comp.damId = 'bbbb-dam';
    f.detectChanges();
    comp.evaluate();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('sire must be male');
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter herdbook-web exec vitest run src/app/mating/mating-planner.component.spec.ts` → **3 PASS**

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/app/mating/mating-planner.component.ts apps/web/src/app/mating/mating-planner.component.spec.ts
git commit -m "feat(herdbook-web): mating planner page (evaluate + save)"
```

---

## Task 4: Mating detail page

**Files:** Create `apps/web/src/app/mating/mating-detail.component.ts` + spec

- [ ] **Step 1: Write the detail component**

```typescript
// mating-detail.component.ts
import {
  ChangeDetectionStrategy, Component, Input, inject, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatingApiService } from './mating-api.service';
import type { MatingStatus, MatingVerdict, PlannedMatingDetail } from './mating.models';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; detail: PlannedMatingDetail };

function verdictLabel(v: MatingVerdict): string {
  return v === 'green' ? '✓ Low risk' : v === 'amber' ? '⚠ Moderate risk' : '✕ High risk';
}
function verdictSrWord(v: MatingVerdict): string {
  return v === 'green' ? 'low inbreeding' : v === 'amber' ? 'moderate inbreeding' : 'high inbreeding';
}
function deltaSymbol(predicted: number, actual: number | null): string {
  if (actual === null) return '—';
  const d = actual - predicted;
  if (Math.abs(d) < 0.0001) return '≈';
  return d > 0 ? '▲' : '▼';
}
function deltaLabel(predicted: number, actual: number | null): string {
  if (actual === null) return 'not yet computed';
  const d = actual - predicted;
  if (Math.abs(d) < 0.0001) return 'matches prediction';
  return (d > 0 ? '+' : '') + (d * 100).toFixed(2) + '% vs predicted';
}

const STATUS_LABELS: Record<MatingStatus, string> = {
  planned: 'Planned',
  mated: 'Mated',
  offspring_registered: 'Offspring registered',
  cancelled: 'Cancelled',
};

@Component({
  selector: 'hb-mating-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="hb-page">
      @switch (state().kind) {
        @case ('loading') { <div class="hb-card hb-state-msg">Loading mating…</div> }
        @case ('error') {
          <div class="hb-card hb-state-msg hb-state-error">
            <strong>Could not load mating.</strong>
          </div>
        }
        @case ('loaded') {
          <div class="hb-crumb">
            <a routerLink="/matings" class="hb-link">Matings</a>
            <span class="hb-crumb-sep">›</span>
            <span>{{ state().detail.plannedDate }}</span>
          </div>
          <div class="hb-card">
            <h1 class="hb-h1">Mating plan</h1>
            <dl class="hb-dl">
              <dt>Status</dt>
              <dd>{{ statusLabel(state().detail.status) }}</dd>
              <dt>Planned date</dt>
              <dd>{{ state().detail.plannedDate }}</dd>
              <dt>Sire kernel ID</dt>
              <dd class="hb-mono">{{ state().detail.sireKernelIndividualId }}</dd>
              <dt>Dam kernel ID</dt>
              <dd class="hb-mono">{{ state().detail.damKernelIndividualId }}</dd>
              <dt>Predicted F (at plan time)</dt>
              <dd>
                {{ (state().detail.predictedF * 100).toFixed(2) }}%
                <span class="hb-verdict hb-verdict--{{ state().detail.predictedVerdict }}"
                      aria-label="{{ verdictSrWord(state().detail.predictedVerdict) }}">
                  {{ verdictLabel(state().detail.predictedVerdict) }}
                </span>
              </dd>
              <dt>Live kinship (current)</dt>
              <dd>
                @if (state().detail.liveKinship !== null) {
                  {{ (state().detail.liveKinship! * 100).toFixed(2) }}%
                  @if (state().detail.liveKinship !== state().detail.predictedF) {
                    <span class="hb-muted" aria-label="drift from prediction">
                      ({{ (( state().detail.liveKinship! - state().detail.predictedF) * 100).toFixed(2) }}% drift)
                    </span>
                  }
                } @else {
                  <span class="hb-muted">unavailable</span>
                }
              </dd>
              @if (state().detail.notes) {
                <dt>Notes</dt>
                <dd>{{ state().detail.notes }}</dd>
              }
            </dl>

            <!-- Lifecycle actions -->
            <div class="hb-detail-actions" role="group" aria-label="Lifecycle actions">
              @if (state().detail.status === 'planned') {
                <button class="hb-btn-secondary" (click)="advance('mated')">Mark as mated</button>
                <button class="hb-btn-ghost" (click)="advance('cancelled')">Cancel</button>
              }
              @if (state().detail.status === 'mated') {
                <button class="hb-btn-secondary" (click)="advance('offspring_registered')">Mark offspring registered</button>
              }
            </div>

            @if (actionError()) {
              <div class="hb-state-error hb-state-msg" role="alert">{{ actionError() }}</div>
            }
          </div>

          <!-- Offspring / predicted-vs-actual -->
          @if (state().detail.offspring.length > 0) {
            <div class="hb-card">
              <h2 class="hb-h2">Offspring — predicted vs actual F</h2>
              <table class="hb-table" aria-label="Offspring predicted vs actual inbreeding">
                <thead>
                  <tr>
                    <th scope="col">Offspring kernel ID</th>
                    <th scope="col">Predicted F%</th>
                    <th scope="col">Actual F%</th>
                    <th scope="col" aria-label="Direction of difference">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  @for (o of state().detail.offspring; track o.kernelIndividualId) {
                    <tr>
                      <td class="hb-mono">{{ o.kernelIndividualId.slice(0, 8) }}…</td>
                      <td>{{ (state().detail.predictedF * 100).toFixed(2) }}%</td>
                      <td>{{ o.actualF !== null ? (o.actualF * 100).toFixed(2) + '%' : '—' }}</td>
                      <td>
                        <span aria-label="{{ deltaLabel(state().detail.predictedF, o.actualF) }}">
                          {{ deltaSymbol(state().detail.predictedF, o.actualF) }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [`
    .hb-dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1.5rem; margin-bottom: 1rem; }
    .hb-dl dt { color: var(--hb-muted); font-size: 0.88rem; }
    .hb-h2 { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.75rem; }
    .hb-detail-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .hb-verdict { font-size: 0.82rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; margin-left: 0.5rem; }
    .hb-verdict--green { background: rgba(34,197,94,0.18); color: #4ade80; }
    .hb-verdict--amber { background: rgba(245,158,11,0.18); color: #fbbf24; }
    .hb-verdict--red { background: rgba(239,68,68,0.18); color: #f87171; }
    .hb-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .hb-table th, .hb-table td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--hb-border); }
    .hb-table th { color: var(--hb-muted); font-weight: 500; }
    .hb-mono { font-family: monospace; }
  `],
})
export class MatingDetailComponent {
  @Input() id = '';

  private readonly api = inject(MatingApiService);
  protected readonly actionError = signal<string | null>(null);

  protected readonly statusLabel = (s: MatingStatus) => STATUS_LABELS[s];
  protected readonly verdictLabel = verdictLabel;
  protected readonly verdictSrWord = verdictSrWord;
  protected readonly deltaSymbol = deltaSymbol;
  protected readonly deltaLabel = deltaLabel;

  private readonly _id$ = toObservable(signal(this.id));

  protected readonly state = toSignal<ViewState>(
    toObservable(signal(this.id)).pipe(
      switchMap((id) =>
        this.api.get(id).pipe(
          map((detail) => ({ kind: 'loaded', detail } as ViewState)),
          catchError(() => of({ kind: 'error', message: '' } as ViewState)),
          startWith({ kind: 'loading' } as ViewState),
        ),
      ),
    ),
    { initialValue: { kind: 'loading' } as ViewState },
  );

  protected advance(status: MatingStatus): void {
    this.actionError.set(null);
    this.api.patch(this.id, { status }).subscribe({
      error: (e: unknown) => {
        const msg = typeof e === 'object' && e !== null && 'error' in e
          ? (e as { error?: { message?: string } }).error?.message ?? String(e)
          : String(e);
        this.actionError.set(msg);
      },
    });
  }
}
```

- [ ] **Step 2: Write the spec**

```typescript
// mating-detail.component.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { MatingDetailComponent } from './mating-detail.component';
import { MatingApiService } from './mating-api.service';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

const detail = { id: 'm1', sireKernelIndividualId: 'aaaa-1111', damKernelIndividualId: 'bbbb-2222', predictedF: 0.05, predictedVerdict: 'amber' as const, status: 'planned' as const, plannedDate: '2026-06-03', notes: 'spring', createdAt: 'x', updatedAt: 'x', liveKinship: 0.055, offspring: [{ kernelIndividualId: 'cccc-3333', actualF: 0.048 }] };

describe('MatingDetailComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [MatingDetailComponent],
      providers: [
        provideRouter([]),
        { provide: MatingApiService, useValue: { get: vi.fn(() => of(detail)), patch: vi.fn(() => of({ ok: true })) } },
      ],
    });
    const f = TestBed.createComponent(MatingDetailComponent);
    (f.componentInstance as MatingDetailComponent).id = 'm1';
    return f;
  }

  it('renders the sire/dam IDs and planned date', () => {
    const f = setup(); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('aaaa-1111');
    expect(f.nativeElement.textContent).toContain('2026-06-03');
  });

  it('renders the offspring predicted-vs-actual table', () => {
    const f = setup(); f.detectChanges();
    expect(f.nativeElement.querySelector('table[aria-label="Offspring predicted vs actual inbreeding"]')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter herdbook-web exec vitest run src/app/mating/mating-detail.component.spec.ts` → **2 PASS**

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/app/mating/mating-detail.component.ts apps/web/src/app/mating/mating-detail.component.spec.ts
git commit -m "feat(herdbook-web): mating detail page (lifecycle + predicted-vs-actual)"
```

---

## Task 5: Routes + nav

**Files:** Modify `apps/web/src/app/app.routes.ts` + `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Add the 3 mating routes** (in `app.routes.ts`, before the `{ path: '**' }` catch-all)

```typescript
  // ─── Matings ───────────────────────────────────────────────────────────────
  {
    path: 'matings',
    title: 'Herdbook — Matings',
    loadComponent: () =>
      import('./mating/mating-list.component').then((m) => m.MatingListComponent),
  },
  {
    path: 'matings/new',
    title: 'Herdbook — Plan mating',
    loadComponent: () =>
      import('./mating/mating-planner.component').then((m) => m.MatingPlannerComponent),
  },
  {
    path: 'matings/:id',
    title: 'Herdbook — Mating',
    loadComponent: () =>
      import('./mating/mating-detail.component').then((m) => m.MatingDetailComponent),
  },
```

- [ ] **Step 2: Add the nav link** (in `app.component.ts` template, after the `Import` link)

```html
<a routerLink="/matings" routerLinkActive="hb-active">Matings</a>
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter herdbook-web exec tsc --noEmit -p tsconfig.app.json` (or the web's typecheck script — check `apps/web/package.json`).
Expected: clean.

```bash
git add apps/web/src/app/app.routes.ts apps/web/src/app/app.component.ts
git commit -m "feat(herdbook-web): mating routes + nav link"
```

---

## Task 6: Full gate + live browser verify

- [ ] **Step 1: Run the full web tests**

```bash
pnpm --filter herdbook-web exec vitest run
```
Expected: all mating specs pass; existing specs unaffected.

- [ ] **Step 2: Rebuild the web (dev server will pick it up via ng serve watch)**

The Angular dev server (`ng serve`) on :4200 auto-recompiles on file change — the mating components are now on disk, so the browser will serve them immediately. Open **http://localhost:4200/matings** to confirm the list page renders. Navigate to **http://localhost:4200/matings/new** to confirm the planner. No manual rebuild needed.

- [ ] **Step 3: Commit** (nothing — all committed in Tasks 1–5). If you need a final cleanup commit, use:

```bash
git add <any-remaining-files>
git commit -m "chore(herdbook-web): mating UI cleanup"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (§6):** planner page (evaluate + save) ✅ T3; list page ✅ T2; detail (lifecycle + offspring predicted-vs-actual) ✅ T4; nav + routes ✅ T5; API service ✅ T1. a11y: verdict carries a glyph + sr-word (`aria-label`) — never colour alone ✅. Deferred: animal-detail "Pairing" tab (existing disabled placeholder stays; the Matings page is the entry point in v1 per spec §8).
- **Placeholder scan:** none — all code complete.
- **Type consistency:** `MatingVerdict`/`MatingStatus`/`PlannedMatingRow`/`PlannedMatingDetail`/`MatingEvaluation` consistent across models + service + all 3 components. `verdictLabel`/`verdictSrWord` pure functions defined once in list + planner + detail (local per-component, acceptable for 3 components).
