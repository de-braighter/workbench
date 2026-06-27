# agri-ecosystem-twin E4.1 — UI Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the E4.1 UI shell for `apps/agri-ecosystem-twin-ui/` — pre-declared lazy routes for the four wedge surfaces, app.config wiring, shared layout (header + indicator legend), design-token theme, an API base-URL injection token, and the ADR-012/ADR-214 i18n loader with the shared/common catalog — so the four surface items (E4.2–E5.1) can land in parallel without ever editing a shared file.

**Architecture:** The shell owns every shared seam: `app.routes.ts` pre-declares lazy `loadComponent` routes pointing at one placeholder component per future page directory (`subjects/`, `plan-builder/`, `counterfactual/`, `advisor-report/`) — surface items later replace their placeholder in-place and never touch routing/config. i18n follows the exercir `common-i18n.ts` idiom (ratified ADR-012/ADR-214): `{de,en}/common.json` bundles are the catalog source-of-truth (de = source content), an embedded typed TS map + synchronous `commonMsg()` resolver is the buildable runtime shape, and a parity spec pins map ≡ de-bundle + de/en key parity. Theme = the E1-extracted design tokens (`src/tokens.css`) applied via `styles.css` + component styles — **no new packages** (root `pnpm-lock.yaml` is outside the item scope).

**Tech Stack:** Angular 19 standalone + OnPush, Angular Router (lazy `loadComponent`), Karma/Jasmine (ChromeHeadless, coverage on), pnpm workspace. No new dependencies.

**Worktree / branch (already created):** `domains/agri-ecosystem-twin/.claude/worktrees/agri-ecosystem-twin-e4-1`, branch `feat/agri-ecosystem-twin-e4-1`. All commands below run from that worktree root unless stated. All file paths below are relative to the worktree root.

**Hard scope boundary:** every changed file must be under `apps/agri-ecosystem-twin-ui/`. Do NOT touch root `package.json`, `pnpm-lock.yaml`, `tools/`, `libs/`, or `apps/agri-ecosystem-twin-api/`. Never run git commands in the main clone — only inside the worktree.

**Conventions that bind every task:**

- Code, identifiers, comments: English. UI display copy: only via the i18n catalog (German source values live in the catalog, never inline in templates) — ADR-214.
- Components: standalone, `ChangeDetectionStrategy.OnPush`, `@for`/`@if` control flow.
- a11y battery fixtures must be **body-attached** (`document.body.appendChild(fixture.nativeElement)`) or the 24px geometry check is vacuous.
- Tests run with `pnpm --filter agri-ecosystem-twin-ui run test` (karma, single run, coverage).

---

### Task 1: Shared i18n catalog (bundles + typed map + resolver + parity spec)

**Files:**
- Create: `apps/agri-ecosystem-twin-ui/src/app/i18n/de/common.json`
- Create: `apps/agri-ecosystem-twin-ui/src/app/i18n/en/common.json`
- Create: `apps/agri-ecosystem-twin-ui/src/app/i18n/common-i18n.ts`
- Test: `apps/agri-ecosystem-twin-ui/src/app/i18n/common-i18n.spec.ts`
- Test: `apps/agri-ecosystem-twin-ui/src/app/i18n/common-i18n.parity.spec.ts`
- Modify: `apps/agri-ecosystem-twin-ui/tsconfig.json` (add `resolveJsonModule`)

- [ ] **Step 1: Enable JSON module resolution**

In `apps/agri-ecosystem-twin-ui/tsconfig.json`, add `"resolveJsonModule": true` to `compilerOptions` (after `"esModuleInterop": true`):

```json
    "esModuleInterop": true,
    "resolveJsonModule": true,
```

- [ ] **Step 2: Write the failing specs**

`apps/agri-ecosystem-twin-ui/src/app/i18n/common-i18n.spec.ts`:

```ts
import {
  commonMsg,
  loadFailedLabel,
  loadedLabel,
  loadingLabel,
  pendingSurface,
} from './common-i18n';

describe('common-i18n resolver', () => {
  it('resolves a known key to its German string', () => {
    expect(commonMsg('common.indicator.soilMoisture')).toBe('Bodenfeuchte');
  });

  it('falls through to the key itself for an unknown key', () => {
    expect(commonMsg('common.does.not.exist')).toBe('common.does.not.exist');
  });

  it('interpolates the loading label', () => {
    expect(loadingLabel('Flächen')).toBe('Lade Flächen…');
  });

  it('interpolates the loaded label', () => {
    expect(loadedLabel('Flächen')).toBe('Flächen geladen.');
  });

  it('interpolates label and reason into the load-failed message', () => {
    expect(loadFailedLabel('Flächen', 'Timeout')).toBe(
      'Konnte Flächen nicht laden: Timeout',
    );
  });

  it('interpolates the pending-surface placeholder', () => {
    expect(pendingSurface('E4.2')).toBe('Diese Ansicht entsteht mit E4.2.');
  });
});
```

`apps/agri-ecosystem-twin-ui/src/app/i18n/common-i18n.parity.spec.ts`:

```ts
// ADR-012 parity gate: the embedded typed map and the {de,en} JSON bundles
// must never drift — map ≡ de bundle, de keys ≡ en keys, no empty values.
import deCommon from './de/common.json';
import enCommon from './en/common.json';
import { COMMON_MESSAGES_DE } from './common-i18n';

describe('common-i18n catalog parity', () => {
  it('embedded DE map equals the de/common.json bundle', () => {
    expect({ ...COMMON_MESSAGES_DE }).toEqual(deCommon);
  });

  it('de and en bundles have identical key sets', () => {
    expect(Object.keys(deCommon).sort()).toEqual(Object.keys(enCommon).sort());
  });

  it('no key is empty in either bundle', () => {
    for (const [key, value] of Object.entries<string>(deCommon)) {
      expect(value.trim()).withContext(`de ${key}`).not.toBe('');
    }
    for (const [key, value] of Object.entries<string>(enCommon)) {
      expect(value.trim()).withContext(`en ${key}`).not.toBe('');
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: FAIL — cannot resolve `./common-i18n` / `./de/common.json`.

- [ ] **Step 4: Write the catalog bundles**

`apps/agri-ecosystem-twin-ui/src/app/i18n/de/common.json`:

```json
{
  "common.app.title": "Agricultural Ecosystem Twin",
  "common.app.tagline": "Ökologische A-vs-B-Szenarien für regenerative Höfe.",
  "common.nav.label": "Hauptnavigation",
  "common.nav.subjects": "Flächen",
  "common.nav.planBuilder": "Saisonplan",
  "common.nav.counterfactual": "Was-wäre-wenn",
  "common.nav.advisorReport": "Beraterbericht",
  "common.legend.title": "Indikatoren",
  "common.indicator.soilMoisture": "Bodenfeuchte",
  "common.indicator.pestPressure": "Schädlingsdruck",
  "common.indicator.yield": "Ertrag",
  "common.indicator.inverseHint": "niedriger ist besser",
  "common.placeholder.pending": "Diese Ansicht entsteht mit {item}.",
  "common.status.loading": "Lade {label}…",
  "common.status.loaded": "{label} geladen.",
  "common.status.loadFailedReason": "Konnte {label} nicht laden: {reason}",
  "common.error.unknown": "Unbekannter Fehler"
}
```

`apps/agri-ecosystem-twin-ui/src/app/i18n/en/common.json`:

```json
{
  "common.app.title": "Agricultural Ecosystem Twin",
  "common.app.tagline": "A-vs-B ecological counterfactuals for regenerative farms.",
  "common.nav.label": "Main navigation",
  "common.nav.subjects": "Subjects",
  "common.nav.planBuilder": "Season plan",
  "common.nav.counterfactual": "What-if",
  "common.nav.advisorReport": "Advisor report",
  "common.legend.title": "Indicators",
  "common.indicator.soilMoisture": "Soil moisture",
  "common.indicator.pestPressure": "Pest pressure",
  "common.indicator.yield": "Yield",
  "common.indicator.inverseHint": "lower is better",
  "common.placeholder.pending": "This view lands with {item}.",
  "common.status.loading": "Loading {label}…",
  "common.status.loaded": "{label} loaded.",
  "common.status.loadFailedReason": "Could not load {label}: {reason}",
  "common.error.unknown": "Unknown error"
}
```

- [ ] **Step 5: Write the typed map + resolver**

`apps/agri-ecosystem-twin-ui/src/app/i18n/common-i18n.ts`:

```ts
/**
 * Shared cross-surface i18n catalog (ADR-012 / ADR-214). The JSON bundles
 * under `src/app/i18n/{de,en}/common.json` are the catalog source-of-truth;
 * this typed map embeds the German strings the shell and the surfaces resolve
 * at runtime (German is the source-of-truth content; the `en` bundle is kept
 * at key parity). `common-i18n.parity.spec.ts` asserts this map equals the
 * de bundle so the two never drift.
 *
 * Ownership (E4.1 sequencing contract): the shell owns this file and the
 * bundles. Surface items (E4.2–E5.1) add page-scoped catalogs
 * (`<page>/<page>-i18n.ts` + `<page>/i18n/{de,en}/<page>.json`) inside their
 * own page directory and never edit this shared catalog.
 *
 * Resolution is synchronous and dependency-free; `commonMsg` falls through to
 * the key itself for an unknown key so a missing translation surfaces visibly
 * rather than blanking the UI. The status family keeps its `{…}` placeholders
 * in the catalog; surfaces interpolate via the helpers below.
 */

export const COMMON_MESSAGES_DE: Readonly<Record<string, string>> = {
  'common.app.title': 'Agricultural Ecosystem Twin',
  'common.app.tagline': 'Ökologische A-vs-B-Szenarien für regenerative Höfe.',
  'common.nav.label': 'Hauptnavigation',
  'common.nav.subjects': 'Flächen',
  'common.nav.planBuilder': 'Saisonplan',
  'common.nav.counterfactual': 'Was-wäre-wenn',
  'common.nav.advisorReport': 'Beraterbericht',
  'common.legend.title': 'Indikatoren',
  'common.indicator.soilMoisture': 'Bodenfeuchte',
  'common.indicator.pestPressure': 'Schädlingsdruck',
  'common.indicator.yield': 'Ertrag',
  'common.indicator.inverseHint': 'niedriger ist besser',
  'common.placeholder.pending': 'Diese Ansicht entsteht mit {item}.',
  'common.status.loading': 'Lade {label}…',
  'common.status.loaded': '{label} geladen.',
  'common.status.loadFailedReason': 'Konnte {label} nicht laden: {reason}',
  'common.error.unknown': 'Unbekannter Fehler',
};

/**
 * Resolves a shared i18n key to its German string. Unknown keys fall through
 * to the key itself so a missing translation surfaces visibly.
 */
export function commonMsg(key: string): string {
  return key in COMMON_MESSAGES_DE ? (COMMON_MESSAGES_DE[key] as string) : key;
}

/** "Lade {label}…" with the label interpolated into the keyed string. */
export function loadingLabel(label: string): string {
  return commonMsg('common.status.loading').replace('{label}', label);
}

/** "{label} geladen." with the label interpolated into the keyed string. */
export function loadedLabel(label: string): string {
  return commonMsg('common.status.loaded').replace('{label}', label);
}

/** "Konnte {label} nicht laden: {reason}" with both interpolated. */
export function loadFailedLabel(label: string, reason: string): string {
  return commonMsg('common.status.loadFailedReason')
    .replace('{label}', label)
    .replace('{reason}', reason);
}

/** "Diese Ansicht entsteht mit {item}." for the E4.1 route placeholders. */
export function pendingSurface(item: string): string {
  return commonMsg('common.placeholder.pending').replace('{item}', item);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: PASS (existing app specs + 9 new specs green).

- [ ] **Step 7: Commit**

```bash
git add apps/agri-ecosystem-twin-ui/src/app/i18n apps/agri-ecosystem-twin-ui/tsconfig.json
git commit -m "feat(ui): shared i18n catalog with de/en bundles, typed DE map and parity gate (ADR-012)"
```

---

### Task 2: API base-URL injection token

**Files:**
- Create: `apps/agri-ecosystem-twin-ui/src/app/core/api-base-url.ts`
- Test: `apps/agri-ecosystem-twin-ui/src/app/core/api-base-url.spec.ts`

- [ ] **Step 1: Write the failing spec**

`apps/agri-ecosystem-twin-ui/src/app/core/api-base-url.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from './api-base-url';

describe('API_BASE_URL', () => {
  it('defaults to the dev-proxy prefix /api', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(API_BASE_URL)).toBe('/api');
  });

  it('is overridable via a provider', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: API_BASE_URL, useValue: 'https://api.example' }],
    });
    expect(TestBed.inject(API_BASE_URL)).toBe('https://api.example');
  });
});
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: FAIL — cannot resolve `./api-base-url`.

- [ ] **Step 3: Write the token**

`apps/agri-ecosystem-twin-ui/src/app/core/api-base-url.ts`:

```ts
import { InjectionToken } from '@angular/core';

/**
 * Base URL every page-scoped data service prefixes its api calls with
 * (E4.1 sequencing contract: surfaces own their own data services inside
 * their page directory and inject this token — there is no shared
 * api.service.ts).
 *
 * The dev default `/api` rides the dev-server proxy (`proxy.conf.json`),
 * which rewrites to the api on :3500 and attaches the demo tenant headers
 * (x-tenant-id / x-pack-id / x-user-id). Override the token in
 * `app.config.ts` providers when a deployed environment serves the api
 * elsewhere.
 */
export const API_BASE_URL = new InjectionToken<string>('agri.apiBaseUrl', {
  providedIn: 'root',
  factory: () => '/api',
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-ui/src/app/core
git commit -m "feat(ui): API base-URL injection token for page-scoped data services"
```

---

### Task 3: Placeholder pages + pre-declared lazy routes + app.config wiring

**Files:**
- Create: `apps/agri-ecosystem-twin-ui/src/app/subjects/subjects-page.component.ts`
- Create: `apps/agri-ecosystem-twin-ui/src/app/plan-builder/plan-builder-page.component.ts`
- Create: `apps/agri-ecosystem-twin-ui/src/app/counterfactual/counterfactual-page.component.ts`
- Create: `apps/agri-ecosystem-twin-ui/src/app/advisor-report/advisor-report-page.component.ts`
- Create: `apps/agri-ecosystem-twin-ui/src/app/app.routes.ts`
- Modify: `apps/agri-ecosystem-twin-ui/src/app/app.config.ts`
- Test: `apps/agri-ecosystem-twin-ui/src/app/app.routes.spec.ts`

- [ ] **Step 1: Write the failing routes spec**

`apps/agri-ecosystem-twin-ui/src/app/app.routes.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { APP_ROUTES } from './app.routes';

describe('APP_ROUTES', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(APP_ROUTES)] });
  });

  it('redirects the empty path to /subjects', async () => {
    await RouterTestingHarness.create('/');
    expect(TestBed.inject(Router).url).toBe('/subjects');
  });

  it('redirects unknown paths to /subjects', async () => {
    await RouterTestingHarness.create('/no-such-page');
    expect(TestBed.inject(Router).url).toBe('/subjects');
  });

  const pages: ReadonlyArray<[path: string, heading: string]> = [
    ['/subjects', 'Flächen'],
    ['/plan-builder', 'Saisonplan'],
    ['/counterfactual', 'Was-wäre-wenn'],
    ['/advisor-report', 'Beraterbericht'],
  ];

  for (const [path, heading] of pages) {
    it(`lazy-loads the ${path} placeholder and renders its heading`, async () => {
      const harness = await RouterTestingHarness.create(path);
      const h2 = (harness.routeNativeElement as HTMLElement).querySelector('h2');
      expect(h2?.textContent?.trim()).toBe(heading);
    });
  }

  it('sets the document title from the route', async () => {
    await RouterTestingHarness.create('/subjects');
    expect(document.title).toBe('Flächen');
  });
});
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: FAIL — cannot resolve `./app.routes`.

- [ ] **Step 3: Write the four placeholder page components**

Each future page directory gets exactly ONE file so the surface item that owns
the directory replaces it wholesale. Pattern (identical for all four, only the
selector/class/keys/item-id differ):

`apps/agri-ecosystem-twin-ui/src/app/subjects/subjects-page.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { commonMsg, pendingSurface } from '../i18n/common-i18n';

/**
 * E4.1 placeholder — replaced wholesale by the E4.2 subjects-tree surface.
 * It only anchors the pre-declared lazy route; the real page brings its own
 * page-scoped data service + i18n catalog into this directory.
 */
@Component({
  selector: 'app-subjects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h2>{{ heading }}</h2>
      <p class="pending">{{ pending }}</p>
    </section>
  `,
})
export class SubjectsPageComponent {
  protected readonly heading = commonMsg('common.nav.subjects');
  protected readonly pending = pendingSurface('E4.2');
}
```

`apps/agri-ecosystem-twin-ui/src/app/plan-builder/plan-builder-page.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { commonMsg, pendingSurface } from '../i18n/common-i18n';

/**
 * E4.1 placeholder — replaced wholesale by the E4.3 plan-builder surface.
 * It only anchors the pre-declared lazy route; the real page brings its own
 * page-scoped data service + i18n catalog into this directory.
 */
@Component({
  selector: 'app-plan-builder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h2>{{ heading }}</h2>
      <p class="pending">{{ pending }}</p>
    </section>
  `,
})
export class PlanBuilderPageComponent {
  protected readonly heading = commonMsg('common.nav.planBuilder');
  protected readonly pending = pendingSurface('E4.3');
}
```

`apps/agri-ecosystem-twin-ui/src/app/counterfactual/counterfactual-page.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { commonMsg, pendingSurface } from '../i18n/common-i18n';

/**
 * E4.1 placeholder — replaced wholesale by the E4.4 counterfactual +
 * posterior-readout surface. It only anchors the pre-declared lazy route; the
 * real page brings its own page-scoped data service + i18n catalog into this
 * directory.
 */
@Component({
  selector: 'app-counterfactual-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h2>{{ heading }}</h2>
      <p class="pending">{{ pending }}</p>
    </section>
  `,
})
export class CounterfactualPageComponent {
  protected readonly heading = commonMsg('common.nav.counterfactual');
  protected readonly pending = pendingSurface('E4.4');
}
```

`apps/agri-ecosystem-twin-ui/src/app/advisor-report/advisor-report-page.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { commonMsg, pendingSurface } from '../i18n/common-i18n';

/**
 * E4.1 placeholder — replaced wholesale by the E5.1 advisor-report surface.
 * It only anchors the pre-declared lazy route; the real page brings its own
 * page-scoped data service + i18n catalog into this directory.
 */
@Component({
  selector: 'app-advisor-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h2>{{ heading }}</h2>
      <p class="pending">{{ pending }}</p>
    </section>
  `,
})
export class AdvisorReportPageComponent {
  protected readonly heading = commonMsg('common.nav.advisorReport');
  protected readonly pending = pendingSurface('E5.1');
}
```

- [ ] **Step 4: Write the routes**

`apps/agri-ecosystem-twin-ui/src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { commonMsg } from './i18n/common-i18n';

/**
 * Pre-declared lazy routes for the four wedge surfaces (E4.1 sequencing
 * contract). Each route points at the placeholder inside the page directory
 * its surface item owns (E4.2 subjects, E4.3 plan-builder, E4.4
 * counterfactual, E5.1 advisor-report) — surface items replace the
 * placeholder in their own directory and never edit this file.
 */
const SUBJECTS_PATH = 'subjects';

export const APP_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: SUBJECTS_PATH },
  {
    path: SUBJECTS_PATH,
    title: commonMsg('common.nav.subjects'),
    loadComponent: () =>
      import('./subjects/subjects-page.component').then(
        (m) => m.SubjectsPageComponent,
      ),
  },
  {
    path: 'plan-builder',
    title: commonMsg('common.nav.planBuilder'),
    loadComponent: () =>
      import('./plan-builder/plan-builder-page.component').then(
        (m) => m.PlanBuilderPageComponent,
      ),
  },
  {
    path: 'counterfactual',
    title: commonMsg('common.nav.counterfactual'),
    loadComponent: () =>
      import('./counterfactual/counterfactual-page.component').then(
        (m) => m.CounterfactualPageComponent,
      ),
  },
  {
    path: 'advisor-report',
    title: commonMsg('common.nav.advisorReport'),
    loadComponent: () =>
      import('./advisor-report/advisor-report-page.component').then(
        (m) => m.AdvisorReportPageComponent,
      ),
  },
  { path: '**', redirectTo: SUBJECTS_PATH },
];
```

- [ ] **Step 5: Wire the router into app.config**

Replace `apps/agri-ecosystem-twin-ui/src/app/app.config.ts` with:

```ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { APP_ROUTES } from './app.routes';

/**
 * Shell-owned application config (E4.1 sequencing contract): surfaces never
 * edit this file. HttpClient + Router come from here; page-scoped data
 * services inject API_BASE_URL (src/app/core/api-base-url.ts). The demo
 * tenant headers ride the dev proxy (proxy.conf.json → api :3500), not an
 * interceptor.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(APP_ROUTES),
    provideHttpClient(),
  ],
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: PASS (7 new route specs green; all prior specs still green).

- [ ] **Step 7: Commit**

```bash
git add apps/agri-ecosystem-twin-ui/src/app/subjects apps/agri-ecosystem-twin-ui/src/app/plan-builder apps/agri-ecosystem-twin-ui/src/app/counterfactual apps/agri-ecosystem-twin-ui/src/app/advisor-report apps/agri-ecosystem-twin-ui/src/app/app.routes.ts apps/agri-ecosystem-twin-ui/src/app/app.routes.spec.ts apps/agri-ecosystem-twin-ui/src/app/app.config.ts
git commit -m "feat(ui): pre-declared lazy routes with per-surface placeholder pages + router wiring"
```

---

### Task 4: Shared layout components (header + indicator legend)

**Files:**
- Create: `apps/agri-ecosystem-twin-ui/src/app/shell/header.component.ts`
- Create: `apps/agri-ecosystem-twin-ui/src/app/shell/indicator-legend.component.ts`
- Test: `apps/agri-ecosystem-twin-ui/src/app/shell/header.component.spec.ts`
- Test: `apps/agri-ecosystem-twin-ui/src/app/shell/indicator-legend.component.spec.ts`

- [ ] **Step 1: Write the failing specs**

`apps/agri-ecosystem-twin-ui/src/app/shell/header.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('renders the brand as the page h1', () => {
    expect(root.querySelector('h1')?.textContent).toContain(
      'Agricultural Ecosystem Twin',
    );
  });

  it('renders one nav link per wedge surface, in order', () => {
    const labels = Array.from(root.querySelectorAll('nav a')).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Flächen',
      'Saisonplan',
      'Was-wäre-wenn',
      'Beraterbericht',
    ]);
  });

  it('points the nav links at the pre-declared routes', () => {
    const hrefs = Array.from(root.querySelectorAll('nav a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/subjects',
      '/plan-builder',
      '/counterfactual',
      '/advisor-report',
    ]);
  });

  it('labels the nav landmark', () => {
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Hauptnavigation',
    );
  });
});
```

`apps/agri-ecosystem-twin-ui/src/app/shell/indicator-legend.component.spec.ts`:

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IndicatorLegendComponent } from './indicator-legend.component';

describe('IndicatorLegendComponent', () => {
  let fixture: ComponentFixture<IndicatorLegendComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IndicatorLegendComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(IndicatorLegendComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('renders the three wedge indicators, in order', () => {
    const labels = Array.from(root.querySelectorAll('li .label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Bodenfeuchte', 'Schädlingsdruck', 'Ertrag']);
  });

  it('marks only pest pressure with the inverse hint', () => {
    const items = Array.from(root.querySelectorAll('li'));
    const hints = items.map((li) => li.querySelector('.hint')?.textContent);
    expect(hints[0]).toBeUndefined();
    expect(hints[1]).toContain('niedriger ist besser');
    expect(hints[2]).toBeUndefined();
  });

  it('hides the color swatches from assistive tech', () => {
    const swatches = Array.from(root.querySelectorAll('.swatch'));
    expect(swatches.length).toBe(3);
    for (const swatch of swatches) {
      expect(swatch.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: FAIL — cannot resolve `./header.component` / `./indicator-legend.component`.

- [ ] **Step 3: Write the header component**

`apps/agri-ecosystem-twin-ui/src/app/shell/header.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { commonMsg } from '../i18n/common-i18n';

/**
 * Shell header (E4.1): brand + the navigation across the four wedge
 * surfaces. Shared layout chrome — owned by the shell, not by any surface.
 */
@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="bar">
      <div class="brand">
        <h1 class="brand-title">
          <a routerLink="/subjects">{{ title }}</a>
        </h1>
        <p class="tagline">{{ tagline }}</p>
      </div>
      <nav [attr.aria-label]="navLabel">
        <ul>
          @for (link of links; track link.path) {
            <li>
              <a
                [routerLink]="link.path"
                routerLinkActive="active"
                ariaCurrentWhenActive="page"
                >{{ link.label }}</a
              >
            </li>
          }
        </ul>
      </nav>
    </header>
  `,
  styles: `
    .bar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 2rem;
      padding: 0.6rem 1.5rem;
      background: var(--glass-bg);
      border-bottom: 1px solid var(--glass-border);
      backdrop-filter: blur(8px);
    }
    .brand-title {
      margin: 0;
      font-size: 1.125rem;
    }
    .brand-title a {
      display: inline-flex;
      align-items: center;
      min-height: 2rem;
      color: var(--fg-1);
      text-decoration: none;
      font-family: var(--font-display);
    }
    .tagline {
      margin: 0;
      font-size: 0.75rem;
      color: var(--fg-3);
    }
    nav ul {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    nav a {
      display: inline-flex;
      align-items: center;
      min-height: 2.5rem;
      padding: 0 0.85rem;
      border-radius: 0.5rem;
      color: var(--fg-2);
      text-decoration: none;
    }
    nav a:hover {
      color: var(--fg-1);
    }
    nav a.active {
      color: var(--fg-1);
      background: var(--bg-3);
    }
  `,
})
export class HeaderComponent {
  protected readonly title = commonMsg('common.app.title');
  protected readonly tagline = commonMsg('common.app.tagline');
  protected readonly navLabel = commonMsg('common.nav.label');
  protected readonly links = [
    { path: '/subjects', label: commonMsg('common.nav.subjects') },
    { path: '/plan-builder', label: commonMsg('common.nav.planBuilder') },
    { path: '/counterfactual', label: commonMsg('common.nav.counterfactual') },
    { path: '/advisor-report', label: commonMsg('common.nav.advisorReport') },
  ];
}
```

- [ ] **Step 4: Write the indicator legend component**

`apps/agri-ecosystem-twin-ui/src/app/shell/indicator-legend.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { commonMsg } from '../i18n/common-i18n';

interface LegendEntry {
  readonly key: string;
  readonly tone: 'soil' | 'pest' | 'yield';
  readonly label: string;
  readonly hint: string | null;
}

/**
 * Indicator legend (E4.1 shared layout): names the three wedge indicators
 * every surface reports against — soil moisture, pest pressure (inverse:
 * lower is better), yield — with the token colors the surfaces reuse.
 */
@Component({
  selector: 'app-indicator-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="legend" [attr.aria-label]="title">
      <h2 class="legend-title">{{ title }}</h2>
      <ul>
        @for (entry of indicators; track entry.key) {
          <li>
            <span [class]="'swatch swatch-' + entry.tone" aria-hidden="true"></span>
            <span class="label">{{ entry.label }}</span>
            @if (entry.hint) {
              <span class="hint">({{ entry.hint }})</span>
            }
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1.25rem;
      padding: 0.6rem 1.5rem;
      font-size: 0.8rem;
    }
    .legend-title {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--fg-2);
    }
    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.25rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--fg-2);
    }
    .swatch {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
    }
    .swatch-soil {
      background: var(--accent-arm-a);
    }
    .swatch-pest {
      background: var(--warn);
    }
    .swatch-yield {
      background: var(--accent-ok);
    }
    .hint {
      color: var(--fg-3);
    }
  `,
})
export class IndicatorLegendComponent {
  protected readonly title = commonMsg('common.legend.title');
  protected readonly indicators: readonly LegendEntry[] = [
    {
      key: 'soil-moisture',
      tone: 'soil',
      label: commonMsg('common.indicator.soilMoisture'),
      hint: null,
    },
    {
      key: 'pest-pressure',
      tone: 'pest',
      label: commonMsg('common.indicator.pestPressure'),
      hint: commonMsg('common.indicator.inverseHint'),
    },
    {
      key: 'yield',
      tone: 'yield',
      label: commonMsg('common.indicator.yield'),
      hint: null,
    },
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agri-ecosystem-twin-ui/src/app/shell
git commit -m "feat(ui): shared layout chrome - header with surface nav + indicator legend"
```

---

### Task 5: Shell composition (app component + theme + a11y battery)

**Files:**
- Modify: `apps/agri-ecosystem-twin-ui/src/app/app.component.ts`
- Modify: `apps/agri-ecosystem-twin-ui/src/app/app.component.html`
- Modify: `apps/agri-ecosystem-twin-ui/src/app/app.component.css`
- Modify: `apps/agri-ecosystem-twin-ui/src/app/app.component.spec.ts`
- Modify: `apps/agri-ecosystem-twin-ui/src/app/a11y.spec.ts`
- Modify: `apps/agri-ecosystem-twin-ui/src/styles.css`
- Modify: `apps/agri-ecosystem-twin-ui/src/index.html`

- [ ] **Step 1: Update the app component spec (failing first)**

Replace `apps/agri-ecosystem-twin-ui/src/app/app.component.spec.ts` with:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { APP_ROUTES } from './app.routes';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter(APP_ROUTES)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the product heading', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(
      'Agricultural Ecosystem Twin',
    );
  });

  it('composes header, routed main and indicator-legend footer', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-header')).toBeTruthy();
    expect(compiled.querySelector('main router-outlet')).toBeTruthy();
    expect(compiled.querySelector('footer app-indicator-legend')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify the new assertion fails**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: FAIL — `app-header` not found (app component still renders the E1 static shell).

- [ ] **Step 3: Compose the shell**

Replace `apps/agri-ecosystem-twin-ui/src/app/app.component.ts` with:

```ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shell/header.component';
import { IndicatorLegendComponent } from './shell/indicator-legend.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, IndicatorLegendComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {}
```

Replace `apps/agri-ecosystem-twin-ui/src/app/app.component.html` with:

```html
<div class="shell">
  <app-header />
  <main class="content">
    <router-outlet />
  </main>
  <footer class="footer">
    <app-indicator-legend />
  </footer>
</div>
```

Replace `apps/agri-ecosystem-twin-ui/src/app/app.component.css` with:

```css
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.content {
  flex: 1;
  width: min(72rem, 100% - 3rem);
  margin-inline: auto;
  padding-block: 1.5rem;
}

.footer {
  border-top: 1px solid var(--line-1);
  background: var(--bg-1);
}
```

- [ ] **Step 4: Apply the design-token theme globally**

Replace `apps/agri-ecosystem-twin-ui/src/styles.css` with:

```css
@import './tokens.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  color-scheme: dark;
}

body {
  margin: 0;
  background: var(--bg-0);
  color: var(--fg-1);
  font-family: var(--font-body);
}

h1,
h2,
h3 {
  font-family: var(--font-display);
}

:focus-visible {
  outline: 2px solid var(--accent-arm-a);
  outline-offset: 2px;
}

/* Shared page chrome for routed surfaces (placeholders + E4.2–E5.1 pages). */
.page h2 {
  margin: 0 0 0.75rem;
  font-size: 1.4rem;
}

.page .pending {
  color: var(--fg-3);
}
```

In `apps/agri-ecosystem-twin-ui/src/index.html`, change the `lang` attribute
(rendered copy is the German source catalog, ADR-012):

```html
<html lang="de">
```

- [ ] **Step 5: Extend the a11y battery to the routed shell**

Replace `apps/agri-ecosystem-twin-ui/src/app/a11y.spec.ts` with:

```ts
// Canonical a11y battery (player-surfaces arc patterns) — copied next to each
// page component as `a11y.spec.ts`. Kills the inaccessible-by-default failure
// mode. The fixture is body-attached so rendered geometry is real
// (ChromeHeadless lays out for real). Color contrast and reduced-motion need a
// real browser pass (qa-engineer dimension 2).
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { APP_ROUTES } from './app.routes';

describe('a11y battery: AppComponent shell', () => {
  let fixture: ComponentFixture<AppComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter(APP_ROUTES)],
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    // Render the default route so the battery sees the full shell + a page.
    await TestBed.inject(Router).navigate(['/subjects']);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
  });

  it('every label points at an existing control (label/for)', () => {
    for (const label of Array.from(root.querySelectorAll('label'))) {
      const forId = label.getAttribute('for');
      expect(forId)
        .withContext(`<label> "${label.textContent?.trim()}" needs a for attribute`)
        .toBeTruthy();
      expect(root.querySelector(`#${CSS.escape(forId ?? '')}`))
        .withContext(`label for="${forId}" has no matching control`)
        .toBeTruthy();
    }
  });

  it('anything acting as a button IS a button or link', () => {
    for (const el of Array.from(root.querySelectorAll('[role="button"]'))) {
      expect(['BUTTON', 'A'].includes(el.tagName))
        .withContext(`role="button" on <${el.tagName.toLowerCase()}> — use <button type="button">`)
        .toBeTrue();
    }
  });

  it('icon-only buttons carry an accessible name', () => {
    for (const btn of Array.from(root.querySelectorAll('button'))) {
      const hasText = (btn.textContent ?? '').trim().length > 0;
      const hasLabel = btn.hasAttribute('aria-label') || btn.hasAttribute('aria-labelledby');
      expect(hasText || hasLabel).withContext('icon-only <button> needs aria-label').toBeTrue();
    }
  });

  it('nothing autofocuses', () => {
    expect(root.querySelector('[autofocus]')).toBeNull();
  });

  it('exposes header, main and footer landmarks plus a labelled nav', () => {
    expect(root.querySelector('header')).withContext('header landmark').toBeTruthy();
    expect(root.querySelector('main')).withContext('main landmark').toBeTruthy();
    expect(root.querySelector('footer')).withContext('footer landmark').toBeTruthy();
    expect(root.querySelector('nav')?.getAttribute('aria-label'))
      .withContext('nav needs an accessible name')
      .toBeTruthy();
  });

  it('interactive targets meet the 24px minimum (SC 2.5.8)', () => {
    const targets = Array.from(root.querySelectorAll<HTMLElement>('button, a[href]'));
    expect(targets.length).withContext('shell must render interactive nav targets').toBeGreaterThan(0);
    for (const el of targets) {
      const { height, width } = el.getBoundingClientRect();
      expect(height)
        .withContext(`<${el.tagName.toLowerCase()}> "${el.textContent?.trim()}" height ${height}px < 24px`)
        .toBeGreaterThanOrEqual(24);
      expect(width)
        .withContext(`<${el.tagName.toLowerCase()}> "${el.textContent?.trim()}" width ${width}px < 24px`)
        .toBeGreaterThanOrEqual(24);
    }
  });
});
```

- [ ] **Step 6: Run tests to verify everything passes**

Run: `pnpm --filter agri-ecosystem-twin-ui run test`
Expected: PASS — all suites green, including the 24px geometry check against
real body-attached layout.

- [ ] **Step 7: Commit**

```bash
git add apps/agri-ecosystem-twin-ui/src/app/app.component.ts apps/agri-ecosystem-twin-ui/src/app/app.component.html apps/agri-ecosystem-twin-ui/src/app/app.component.css apps/agri-ecosystem-twin-ui/src/app/app.component.spec.ts apps/agri-ecosystem-twin-ui/src/app/a11y.spec.ts apps/agri-ecosystem-twin-ui/src/styles.css apps/agri-ecosystem-twin-ui/src/index.html
git commit -m "feat(ui): compose routed shell with header/legend chrome, token theme and a11y battery"
```

---

### Task 6: Shell conventions README + full local gate

**Files:**
- Modify: `apps/agri-ecosystem-twin-ui/README.md` (replace Angular CLI boilerplate)

- [ ] **Step 1: Write the conventions README**

Replace `apps/agri-ecosystem-twin-ui/README.md` with:

```markdown
# agri-ecosystem-twin-ui

Angular shell for the agri-ecosystem-twin wedge (E4.1). Dev server on `:4250`,
api proxied to `:3500` (`proxy.conf.json` attaches the demo tenant headers
`x-tenant-id` / `x-pack-id` / `x-user-id`).

## Run

```bash
pnpm --filter agri-ecosystem-twin-ui run start   # ng serve on :4250
pnpm --filter agri-ecosystem-twin-ui run test    # karma ChromeHeadless, coverage
pnpm --filter agri-ecosystem-twin-ui run build   # production build
```

## Shell contract (E4.1 — read before building a surface)

The shell owns the shared seams; surface items (E4.2–E5.1) own exactly one
page directory each and never edit a shared file:

| Route | Page directory | Surface item |
| --- | --- | --- |
| `/subjects` | `src/app/subjects/` | E4.2 subjects tree |
| `/plan-builder` | `src/app/plan-builder/` | E4.3 plan builder |
| `/counterfactual` | `src/app/counterfactual/` | E4.4 counterfactual readout |
| `/advisor-report` | `src/app/advisor-report/` | E5.1 advisor report |

Shell-owned (do **not** edit from a surface item): `src/app/app.routes.ts`,
`src/app/app.config.ts`, `src/app/shell/`, `src/app/core/`, `src/app/i18n/`,
`src/styles.css`, `src/tokens.css`, `src/index.html`.

### Building a surface

1. Replace the `*-page.component.ts` placeholder in your page directory; the
   lazy route already points at it — keep the file name and class name.
2. Data access: write a page-scoped data service inside your directory and
   inject `API_BASE_URL` from `src/app/core/api-base-url.ts` (there is no
   shared api.service.ts). The token defaults to `/api`, which the dev proxy
   rewrites to the api on `:3500` with the demo tenant headers.
3. i18n (ADR-012/ADR-214): UI copy never lives inline. Add a page-scoped
   catalog `<page>-i18n.ts` + `i18n/{de,en}/<page>.json` inside your page
   directory, mirroring `src/app/i18n/common-i18n.ts` (typed DE map +
   resolver + parity spec). Shared chrome strings (load-status family,
   indicator names, nav) already live in the common catalog — consume
   `commonMsg` / `loadingLabel` / `loadedLabel` / `loadFailedLabel`, do not
   re-declare them.
4. a11y battery: copy `src/app/a11y.spec.ts` next to your page component and
   point it at the page. Keep the fixture **body-attached** — detached
   fixtures make the 24px target check vacuous.
5. Theme: use the design tokens from `src/tokens.css` (`--bg-*`, `--fg-*`,
   `--accent-arm-a/b`, `--accent-ok`, `--warn`); never hardcode colors. The
   indicator legend in the shell footer names the three wedge indicators and
   their tones.
```

- [ ] **Step 2: Run the repo-wide local gate**

From the worktree root:

Run: `pnpm run ci:local`
Expected: build + typecheck + lint + test + knip report all green
(knip runs `--no-exit-code`, report-only).

- [ ] **Step 3: Verify scope confinement**

Run: `git diff --name-only origin/main...HEAD`
Expected: every line starts with `apps/agri-ecosystem-twin-ui/`.

- [ ] **Step 4: Commit**

```bash
git add apps/agri-ecosystem-twin-ui/README.md
git commit -m "docs(ui): shell contract README for surface workers (E4.2-E5.1)"
```

---

## Self-review notes

- **Spec coverage:** routing/lazy routes → Task 3; app.config (provideHttpClient
  + proxy/tenant-header documentation) → Task 3 Step 5; shared layout header +
  indicator legend → Task 4 + Task 5; design-system theme → Task 5 Step 4
  (tokens applied; no new packages possible within scope); API base-URL token →
  Task 2; i18n loader + shared/common keys → Task 1; "surfaces own their own
  feature data services and page-scoped i18n files" → encoded in the README
  contract (Task 6) + placeholder docstrings.
- **a11y-battery obligation:** Task 5 extends the canonical battery to the
  routed shell, body-attached, with a non-vacuity guard (`targets.length > 0`).
- **coverage-delta:** every new file ships with specs in the same task; karma
  runs with coverage on.
- **seed-data-only / no-kernel-change:** the shell wires no data feed at all
  and touches nothing outside `apps/agri-ecosystem-twin-ui/`.
