# Kids-football Club-Picker Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale default route (`/` → old pack-football editor) with a tenant-less Club Grass **club-picker landing** that lists demo clubs + clubs the visitor created (localStorage), routing each into its existing per-club sign-in.

**Architecture:** Pure UI + client-side storage in `domains/exercir`. A new `ClubPickerPageComponent` + `KfKnownClubsService` live in `libs/pack-kids-football-ui`; the shared host app `pack-football-visual-editor` mounts the picker as a tenant-less sibling route and redirects `/` to it. The onboarding wizard records newly-created clubs into the localStorage store. No API, no Prisma schema, no kernel concept.

**Tech Stack:** Angular 21 standalone + signals, TypeScript (ESM, explicit `.js` import suffixes), Zod (storage validation), Vitest + `@angular/core/testing` TestBed.

**Spec:** `docs/superpowers/specs/2026-06-13-kids-football-club-picker-landing-design.md`

**Conventions (match the existing lib):**
- ESM imports use explicit `.js` suffixes (e.g. `'../data/demo-fixtures.js'`).
- Tests: Vitest (`import { describe, it, expect, beforeEach, vi } from 'vitest'`), TestBed, `vi.spyOn`. Web Storage is mocked with `vi.spyOn(localStorage, '…')`.
- i18n: add keys to `KF_MESSAGES` in `kf-i18n.ts`; resolve via `kfMsg` / `kfMsgN`.
- Visual language: reuse `../club-grass.css` + literal `--cg-*` `:host` values (shared-host theme-collision is real — never rely on a `:root` skin here).
- **Test command (IMPORTANT):** the executor is `@nx/angular:unit-test`. It does **not** accept `--include`, `--run`, or positional spec filters (they break build-option resolution). Run the **full project suite**: `NX_DAEMON=false npx nx test pack-kids-football-ui` (≈460 tests, ~25s; watch is off in non-TTY). `NX_DAEMON=false` avoids nx-daemon lock contention with the main clone's running dev servers. The per-task "Run: … --run <pattern>" lines below are shorthand — substitute the full-suite command. Full local gate: `npm run ci:local`.

---

### Task 1: `DEMO_CLUBS` — derive the demo club list from `DEMO_USERS`

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/demo-fixtures.ts`
- Test: `libs/pack-kids-football-ui/src/lib/data/demo-fixtures.spec.ts` (create if absent; else append the `describe` block)

- [ ] **Step 1: Write the failing test**

Create/append `libs/pack-kids-football-ui/src/lib/data/demo-fixtures.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DEMO_CLUBS,
  FC_SONNENBERG_TENANT_ID,
  FC_STADTPARK_TENANT_ID,
} from './demo-fixtures.js';

describe('DEMO_CLUBS', () => {
  it('derives exactly the two demo clubs, in DEMO_USERS order', () => {
    expect(DEMO_CLUBS.map((c) => c.tenantId)).toEqual([
      FC_SONNENBERG_TENANT_ID,
      FC_STADTPARK_TENANT_ID,
    ]);
  });

  it('resolves each club name', () => {
    expect(DEMO_CLUBS.map((c) => c.clubName)).toEqual(['FC Sonnenberg', 'FC Stadtpark']);
  });

  it('counts profiles per club (Sonnenberg 3, Stadtpark 1)', () => {
    const byTenant = Object.fromEntries(DEMO_CLUBS.map((c) => [c.tenantId, c.profileCount]));
    expect(byTenant[FC_SONNENBERG_TENANT_ID]).toBe(3);
    expect(byTenant[FC_STADTPARK_TENANT_ID]).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-kids-football-ui -- --run demo-fixtures`
Expected: FAIL — `DEMO_CLUBS` is not exported.

- [ ] **Step 3: Add the derivation**

In `libs/pack-kids-football-ui/src/lib/data/demo-fixtures.ts`, after the `clubNameForTenant` function, add:

```ts
/** A demo club for the tenant-less club-picker landing. */
export interface DemoClub {
  readonly tenantId: string;
  readonly clubName: string;
  readonly profileCount: number;
}

/**
 * The demo clubs shown on the club-picker landing — DERIVED from DEMO_USERS so
 * there is a single source of truth (distinct tenantIds, in first-seen order).
 */
export const DEMO_CLUBS: readonly DemoClub[] = (() => {
  const counts = new Map<string, number>();
  for (const u of DEMO_USERS) {
    counts.set(u.tenantId, (counts.get(u.tenantId) ?? 0) + 1);
  }
  return [...counts.keys()].map((tenantId) => ({
    tenantId,
    clubName: clubNameForTenant(tenantId),
    profileCount: counts.get(tenantId) ?? 0,
  }));
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-kids-football-ui -- --run demo-fixtures`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-kids-football-ui/src/lib/data/demo-fixtures.ts libs/pack-kids-football-ui/src/lib/data/demo-fixtures.spec.ts
git commit -m "feat(kids-football): derive DEMO_CLUBS from DEMO_USERS for the club picker"
```

---

### Task 2: `KfKnownClubsService` — localStorage store of created clubs

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.ts`
- Test: `libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FC_SONNENBERG_TENANT_ID } from './demo-fixtures.js';
import { KfKnownClubsService } from './kf-known-clubs.service.js';

const KEY = 'cg.knownClubs';
const CREATED = { tenantId: 'b2c3d4e5-0002-4abc-8002-0000c1ab0002', clubName: 'SV Westend' };

function service(): KfKnownClubsService {
  return TestBed.inject(KfKnownClubsService);
}

describe('KfKnownClubsService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  describe('list()', () => {
    it('returns [] when storage is empty', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
      expect(service().list()).toEqual([]);
    });

    it('returns [] when storage holds corrupt JSON', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue('{not json');
      expect(service().list()).toEqual([]);
    });

    it('returns [] when storage holds a wrong-shaped value', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(JSON.stringify([{ foo: 1 }]));
      expect(service().list()).toEqual([]);
    });

    it('returns [] when localStorage.getItem throws (storage disabled)', () => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(service().list()).toEqual([]);
    });

    it('returns the stored clubs when valid', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(JSON.stringify([CREATED]));
      expect(service().list()).toEqual([CREATED]);
    });
  });

  describe('remember()', () => {
    it('writes a new club, deduping by tenantId', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(JSON.stringify([CREATED]));
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => undefined);
      service().remember({ tenantId: CREATED.tenantId, clubName: 'Renamed FC' });
      expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify([{ tenantId: CREATED.tenantId, clubName: 'Renamed FC' }]));
    });

    it('appends a second distinct club', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(JSON.stringify([CREATED]));
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => undefined);
      const second = { tenantId: 'd4e5f6a7-0004-4abc-8004-0000c1ab0004', clubName: 'TV Berg' };
      service().remember(second);
      expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify([CREATED, second]));
    });

    it('skips the demo tenants (never stores a fixture club)', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => undefined);
      service().remember({ tenantId: FC_SONNENBERG_TENANT_ID, clubName: 'FC Sonnenberg' });
      expect(setItem).not.toHaveBeenCalled();
    });

    it('degrades silently when setItem throws (quota / disabled)', () => {
      vi.spyOn(localStorage, 'getItem').mockReturnValue(null);
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => service().remember(CREATED)).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-kids-football-ui -- --run kf-known-clubs`
Expected: FAIL — cannot resolve `./kf-known-clubs.service.js`.

- [ ] **Step 3: Write the service**

Create `libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.ts`:

```ts
/**
 * KfKnownClubsService — client-side store of clubs the visitor has CREATED via
 * the onboarding wizard, for the tenant-less club-picker landing.
 *
 * Why client-side: there is deliberately no "list all tenants" API (it would
 * leak every club to every visitor in real multi-tenancy), so "clubs I created"
 * can only be remembered in the browser. localStorage (not sessionStorage) so a
 * created club survives a reload. Demo-mode affordance (charter §2 D7) — a real
 * deployment fronts clubs via per-club deep links, not a global picker.
 *
 * All Web Storage access is wrapped: private-mode / disabled-storage /
 * quota-exceeded degrade to empty rather than crashing the landing.
 */

import { Injectable } from '@angular/core';
import { z } from 'zod';

import { FC_SONNENBERG_TENANT_ID, FC_STADTPARK_TENANT_ID } from './demo-fixtures.js';

export interface KnownClub {
  readonly tenantId: string;
  readonly clubName: string;
}

const STORAGE_KEY = 'cg.knownClubs';

const KnownClubSchema = z.object({
  tenantId: z.string().min(1),
  clubName: z.string().min(1),
});
const KnownClubsSchema = z.array(KnownClubSchema);

/** Demo clubs come from fixtures, never from storage. */
const DEMO_TENANT_IDS: ReadonlySet<string> = new Set([
  FC_SONNENBERG_TENANT_ID,
  FC_STADTPARK_TENANT_ID,
]);

@Injectable({ providedIn: 'root' })
export class KfKnownClubsService {
  /** Clubs the visitor created on this browser. Corrupt/missing storage → []. */
  list(): KnownClub[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = KnownClubsSchema.safeParse(JSON.parse(raw));
      return parsed.success ? [...parsed.data] : [];
    } catch {
      return [];
    }
  }

  /** Upsert a created club (dedup by tenantId). Demo tenants are ignored. */
  remember(club: KnownClub): void {
    if (DEMO_TENANT_IDS.has(club.tenantId)) return;
    const validated = KnownClubSchema.safeParse(club);
    if (!validated.success) return;
    const next = [...this.list().filter((c) => c.tenantId !== club.tenantId), validated.data];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable / quota exceeded — degrade silently.
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-kids-football-ui -- --run kf-known-clubs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.ts libs/pack-kids-football-ui/src/lib/data/kf-known-clubs.service.spec.ts
git commit -m "feat(kids-football): KfKnownClubsService — localStorage store of created clubs"
```

---

### Task 3: i18n keys for the club picker

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/kf-i18n.ts`

- [ ] **Step 1: Add the keys**

In `KF_MESSAGES` (after the `// Sign-in` block, before `// Members page`), add:

```ts
  // Club picker (tenant-less landing)
  'kf.picker.title': 'Choose a club',
  'kf.picker.subtitle': 'Pick your club to sign in',
  'kf.picker.openAria': 'Open',
  'kf.picker.profileCount.one': '1 profile',
  'kf.picker.profileCount.other': '{n} profiles',
  'kf.picker.created': 'You created this club',
  // (reuses kf.signIn.newClub for the "Set up a new club" action)
```

- [ ] **Step 2: Verify the catalog still type-checks**

Run: `npx nx test pack-kids-football-ui -- --run kf-i18n` (if a kf-i18n spec exists) or rely on Task 4's compile.
Expected: no TS errors (a `Record<string,string>` literal — additive).

- [ ] **Step 3: Commit**

```bash
git add libs/pack-kids-football-ui/src/lib/kf-i18n.ts
git commit -m "feat(kids-football): i18n keys for the club picker"
```

---

### Task 4: `ClubPickerPageComponent` — the tenant-less landing

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/landing/club-picker-page.component.ts`
- Test: `libs/pack-kids-football-ui/src/lib/landing/club-picker-page.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/pack-kids-football-ui/src/lib/landing/club-picker-page.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_CLUBS, FC_SONNENBERG_TENANT_ID } from '../data/demo-fixtures.js';
import { ClubPickerPageComponent } from './club-picker-page.component.js';

const CREATED = { tenantId: 'b2c3d4e5-0002-4abc-8002-0000c1ab0002', clubName: 'SV Westend' };

function configure(storageValue: string | null): void {
  TestBed.resetTestingModule();
  vi.spyOn(localStorage, 'getItem').mockReturnValue(storageValue);
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => undefined);
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
}

describe('ClubPickerPageComponent', () => {
  beforeEach(() => configure(null));

  it('renders the Club Grass wordmark and the picker heading', () => {
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.wordmark')?.textContent?.trim()).toBe('Club Grass');
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Choose a club');
  });

  it('renders one button per demo club when storage is empty', () => {
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll('[data-testid^="club-picker-club-"]');
    expect(buttons.length).toBe(DEMO_CLUBS.length);
  });

  it('merges a created club from localStorage after the demo clubs', () => {
    configure(JSON.stringify([CREATED]));
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll('[data-testid^="club-picker-club-"]');
    expect(buttons.length).toBe(DEMO_CLUBS.length + 1);
    expect(root.querySelector(`[data-testid="club-picker-club-${CREATED.tenantId}"]`)).not.toBeNull();
  });

  it('dedups a created club that collides with a demo tenant', () => {
    configure(JSON.stringify([{ tenantId: FC_SONNENBERG_TENANT_ID, clubName: 'Dupe' }]));
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll('[data-testid^="club-picker-club-"]');
    expect(buttons.length).toBe(DEMO_CLUBS.length);
  });

  it('clicking a club navigates to that club sign-in', () => {
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector(`[data-testid="club-picker-club-${FC_SONNENBERG_TENANT_ID}"]`) as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/t', FC_SONNENBERG_TENANT_ID, 'p', 'kids-football', 'sign-in']);
  });

  it('clicking "Set up a new club" navigates to the setup wizard (demo tenant placeholder)', () => {
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const root = fixture.nativeElement as HTMLElement;
    (root.querySelector('[data-testid="club-picker-setup"]') as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/t', 'demo', 'p', 'kids-football', 'setup']);
  });

  it('club rows are real buttons (a11y)', () => {
    const fixture = TestBed.createComponent(ClubPickerPageComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const first = root.querySelector('[data-testid^="club-picker-club-"]');
    expect(first?.tagName).toBe('BUTTON');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-kids-football-ui -- --run club-picker`
Expected: FAIL — cannot resolve `./club-picker-page.component.js`.

- [ ] **Step 3: Write the component**

Create `libs/pack-kids-football-ui/src/lib/landing/club-picker-page.component.ts`:

```ts
/**
 * ClubPickerPageComponent — tenant-less Club Grass landing.
 *
 * Listed clubs = DEMO_CLUBS (fixtures) ∪ KfKnownClubsService.list() (clubs the
 * visitor created, from localStorage), deduped by tenantId. Picking a club
 * routes to that club's existing per-tenant sign-in; "Set up a new club" routes
 * to the onboarding wizard (which mints its own tenant — the 'demo' segment is
 * a throwaway placeholder, matching the sign-in page's goToSetup()).
 *
 * Visual parity with SignInPageComponent: club-grass.css + literal --cg-* :host
 * values (a :root skin is inert under emulated encapsulation and the shared host
 * carries a conflicting --color-* theme — verified live in the skin arc).
 *
 * DEMO front door (charter §2 D7): production fronts clubs via per-club deep
 * links / a marketing site, not a global picker. The list only accumulates;
 * clearing localStorage resets it (no "forget club" UI by design).
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { DEMO_CLUBS } from '../data/demo-fixtures.js';
import { KfKnownClubsService } from '../data/kf-known-clubs.service.js';
import { kfMsg, kfMsgN } from '../kf-i18n.js';

interface PickerClub {
  readonly tenantId: string;
  readonly clubName: string;
  readonly subtitle: string;
}

@Component({
  selector: 'lib-kf-club-picker-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../club-grass.css'],
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: var(--cg-ink, #1c2520);
        font-family: var(--cg-font-body, 'Archivo', sans-serif);
        color: var(--cg-paper, #f5f3ec);
        padding: 32px 16px;
      }
      .wordmark {
        font-family: var(--cg-font-display, 'Archivo Black', sans-serif);
        font-size: 28px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 4px;
        color: var(--cg-accent, #2f8a4e);
      }
      h1 {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 28px;
        text-align: center;
      }
      .card {
        background: var(--cg-card, #ffffff);
        border-radius: var(--cg-card-radius, 14px);
        padding: 8px 0;
        width: 100%;
        max-width: 420px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
      }
      .card-title {
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--cg-muted, #75796f);
        padding: 12px 20px 8px;
      }
      .club-btn {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        padding: 14px 20px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        transition: background 0.12s;
        min-height: 64px;
      }
      .club-btn:hover,
      .club-btn:focus-visible {
        background: var(--cg-paper, #f5f3ec);
      }
      .club-btn:focus-visible {
        outline: none;
        box-shadow: var(--cg-focus-ring, 0 0 0 3px rgba(47, 138, 78, 0.45));
        border-radius: 8px;
      }
      .crest {
        width: var(--cg-avatar-size, 38px);
        height: var(--cg-avatar-size, 38px);
        min-width: var(--cg-avatar-size, 38px);
        border-radius: 9px;
        background: var(--cg-accent, #2f8a4e);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--cg-font-display, 'Archivo Black', sans-serif);
        font-size: 14px;
        user-select: none;
      }
      .club-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .club-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--cg-ink, #1c2520);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .club-sub {
        font-size: 11px;
        color: var(--cg-muted, #75796f);
      }
      .chevron {
        color: var(--cg-muted, #75796f);
        font-size: 18px;
      }
      .divider {
        height: 1px;
        background: var(--cg-hairline, #e5e2d6);
        margin: 0 20px;
      }
      .setup-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 420px;
        height: 46px;
        margin-top: 20px;
        background: transparent;
        border: 1.5px dashed rgba(255, 255, 255, 0.3);
        border-radius: 12px;
        cursor: pointer;
        font-family: var(--cg-font-display, 'Archivo Black', sans-serif);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.8);
        transition: border-color 0.12s, color 0.12s;
      }
      .setup-btn:hover {
        border-color: rgba(255, 255, 255, 0.5);
        color: rgba(255, 255, 255, 1);
      }
      .setup-btn:focus-visible {
        outline: none;
        box-shadow: var(--cg-focus-ring, 0 0 0 3px rgba(47, 138, 78, 0.45));
      }
    `,
  ],
  template: `
    <div class="wordmark" aria-label="Club Grass">Club Grass</div>
    <h1>{{ msg.title }}</h1>

    <div class="card" role="region" [attr.aria-label]="msg.title">
      <div class="card-title">{{ msg.subtitle }}</div>
      @for (club of clubs; track club.tenantId; let last = $last) {
        <button
          class="club-btn"
          type="button"
          [attr.data-testid]="'club-picker-club-' + club.tenantId"
          [attr.aria-label]="msg.openAria + ' ' + club.clubName"
          (click)="openClub(club.tenantId)"
        >
          <span class="crest" aria-hidden="true">{{ crest(club.clubName) }}</span>
          <span class="club-info">
            <span class="club-name">{{ club.clubName }}</span>
            <span class="club-sub">{{ club.subtitle }}</span>
          </span>
          <span class="chevron" aria-hidden="true">›</span>
        </button>
        @if (!last) {
          <div class="divider" aria-hidden="true"></div>
        }
      }
    </div>

    <button
      class="setup-btn"
      type="button"
      data-testid="club-picker-setup"
      [attr.aria-label]="msg.newClub"
      (click)="setupNewClub()"
    >
      {{ msg.newClub }}
    </button>
  `,
})
export class ClubPickerPageComponent {
  private readonly router = inject(Router);
  private readonly knownClubs = inject(KfKnownClubsService);

  protected readonly msg = {
    title: kfMsg('kf.picker.title'),
    subtitle: kfMsg('kf.picker.subtitle'),
    openAria: kfMsg('kf.picker.openAria'),
    newClub: kfMsg('kf.signIn.newClub'),
  };

  protected readonly clubs: readonly PickerClub[] = this.buildClubs();

  private buildClubs(): PickerClub[] {
    const demo: PickerClub[] = DEMO_CLUBS.map((c) => ({
      tenantId: c.tenantId,
      clubName: c.clubName,
      subtitle:
        c.profileCount === 1
          ? kfMsg('kf.picker.profileCount.one')
          : kfMsgN('kf.picker.profileCount.other', c.profileCount),
    }));
    const seen = new Set(demo.map((c) => c.tenantId));
    const created: PickerClub[] = this.knownClubs
      .list()
      .filter((c) => !seen.has(c.tenantId))
      .map((c) => ({ tenantId: c.tenantId, clubName: c.clubName, subtitle: kfMsg('kf.picker.created') }));
    return [...demo, ...created];
  }

  protected crest(clubName: string): string {
    return clubName.replace(/^FC\s+|^SV\s+|^TV\s+/i, '').charAt(0).toUpperCase() || '?';
  }

  protected openClub(tenantId: string): void {
    void this.router.navigate(['/t', tenantId, 'p', 'kids-football', 'sign-in']);
  }

  protected setupNewClub(): void {
    void this.router.navigate(['/t', 'demo', 'p', 'kids-football', 'setup']);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-kids-football-ui -- --run club-picker`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-kids-football-ui/src/lib/landing/ libs/pack-kids-football-ui/src/lib/kf-i18n.ts
git commit -m "feat(kids-football): ClubPickerPageComponent — tenant-less landing"
```

---

### Task 5: Export the picker from the lib public API

**Files:**
- Modify: `libs/pack-kids-football-ui/src/index.ts`

- [ ] **Step 1: Add the exports**

In `libs/pack-kids-football-ui/src/index.ts`, under the `// Components` block add:

```ts
export { ClubPickerPageComponent } from './lib/landing/club-picker-page.component.js';
```

And under the `// Data / session` block add:

```ts
export { KfKnownClubsService, type KnownClub } from './lib/data/kf-known-clubs.service.js';
export { DEMO_CLUBS, type DemoClub } from './lib/data/demo-fixtures.js';
```

> Note: `DEMO_CLUBS`/`DemoClub` are added to the existing fixtures export block — fold them into the current `export { DEMO_USERS, … } from './lib/data/demo-fixtures.js';` statement rather than duplicating the module specifier.

- [ ] **Step 2: Verify the lib builds**

Run: `npx nx build pack-kids-football-ui`
Expected: build succeeds (the new public-API symbols resolve).

- [ ] **Step 3: Commit**

```bash
git add libs/pack-kids-football-ui/src/index.ts
git commit -m "feat(kids-football): export ClubPickerPageComponent + KfKnownClubsService"
```

---

### Task 6: Onboarding wizard remembers the created club

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/onboarding/onboarding-wizard.component.ts` (`submit()`, ~line 1200; inject block ~line 891)
- Test: `libs/pack-kids-football-ui/src/lib/onboarding/onboarding-wizard.component.spec.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `onboarding-wizard.component.spec.ts`. It reuses the file's existing `buildStubClient`, `configureTestBed`, `atReviewStep`, `flushMicrotasks`, and `CREATE_RESPONSE` helpers (already defined in that file). Add inside the top-level `describe('OnboardingWizardComponent', …)`:

```ts
  describe('remembers the created club', () => {
    it('calls KfKnownClubsService.remember with the created tenantId + clubName on success', async () => {
      const client = buildStubClient();
      const { fixture, root } = atReviewStep(client);
      const remember = vi.spyOn(TestBed.inject(KfKnownClubsService), 'remember').mockImplementation(() => undefined);

      (root.querySelector('[data-testid="onb-create"]') as HTMLButtonElement).click();
      await flushMicrotasks();

      expect(remember).toHaveBeenCalledWith({
        tenantId: CREATE_RESPONSE.tenantId,
        clubName: CREATE_RESPONSE.clubName,
      });
      void fixture;
    });

    it('does NOT call remember when the create fails', async () => {
      const client = buildStubClient(() => Promise.reject(new Error('boom')));
      const { root } = atReviewStep(client);
      const remember = vi.spyOn(TestBed.inject(KfKnownClubsService), 'remember').mockImplementation(() => undefined);

      (root.querySelector('[data-testid="onb-create"]') as HTMLButtonElement).click();
      await flushMicrotasks();

      expect(remember).not.toHaveBeenCalled();
    });
  });
```

Add the import at the top of the spec (next to the other `../data/…` imports):

```ts
import { KfKnownClubsService } from '../data/kf-known-clubs.service.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-kids-football-ui -- --run onboarding-wizard`
Expected: FAIL — `remember` not called (the hook doesn't exist yet).

- [ ] **Step 3: Wire the hook**

In `onboarding-wizard.component.ts`, add the import (next to the other `../data/…` imports):

```ts
import { KfKnownClubsService } from '../data/kf-known-clubs.service.js';
```

Add to the inject block (after `private readonly session = inject(KfSessionService);`, ~line 896):

```ts
  private readonly knownClubs = inject(KfKnownClubsService);
```

In `submit()`, immediately after `const res = await this.client.createClub(req);` (line 1206) and BEFORE `this.session.signIn({…})`, insert:

```ts
      // Remember the new club so it reappears on the tenant-less club picker
      // (no "list all tenants" API exists — this is the only client-side record).
      this.knownClubs.remember({ tenantId: res.tenantId, clubName: res.clubName });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-kids-football-ui -- --run onboarding-wizard`
Expected: PASS (both new tests + the existing suite still green).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-kids-football-ui/src/lib/onboarding/onboarding-wizard.component.ts libs/pack-kids-football-ui/src/lib/onboarding/onboarding-wizard.component.spec.ts
git commit -m "feat(kids-football): onboarding wizard remembers the created club for the picker"
```

---

### Task 7: Host route wiring — `/` → club picker

**Files:**
- Modify: `apps/pack-football-visual-editor/src/app/app.routes.ts`
- Test: `apps/pack-football-visual-editor/src/app/app.routes.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/pack-football-visual-editor/src/app/app.routes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ClubPickerPageComponent } from '@de-braighter/pack-kids-football-ui';

import { appRoutes } from './app.routes';

describe('appRoutes default landing', () => {
  it('redirects the empty path to the club picker', () => {
    const root = appRoutes.find((r) => r.path === '' && r.pathMatch === 'full');
    expect(root?.redirectTo).toBe('/kids-football');
  });

  it('mounts the tenant-less club-picker route', () => {
    const picker = appRoutes.find((r) => r.path === 'kids-football');
    expect(picker).toBeDefined();
    expect(picker?.component).toBe(ClubPickerPageComponent);
  });

  it('keeps the legacy football editor reachable by direct URL', () => {
    expect(appRoutes.some((r) => r.path === 'p/football/editor')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-visual-editor -- --run app.routes`
Expected: FAIL — `redirectTo` is `/p/football/editor`, and no `kids-football` route exists.

- [ ] **Step 3: Wire the routes**

In `apps/pack-football-visual-editor/src/app/app.routes.ts`:

Add to the import from `@de-braighter/pack-kids-football-ui` (line 9):

```ts
import { ClubPickerPageComponent, KIDS_FOOTBALL_ROUTES } from '@de-braighter/pack-kids-football-ui';
```

Change the default redirect (line 30) and add the picker route immediately after it:

```ts
  { path: '', pathMatch: 'full', redirectTo: '/kids-football' },
  { path: 'kids-football', component: ClubPickerPageComponent },
  { path: 'p/football/editor', component: VisualEditorShell },
```

> Use a plain `component:` (not `loadComponent`), matching the adjacent `{ path: 'p/football/editor', component: VisualEditorShell }` line — `ClubPickerPageComponent` is a named import from the lib barrel, already in the entry bundle, so a dynamic `import()` would add nothing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-visual-editor -- --run app.routes`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pack-football-visual-editor/src/app/app.routes.ts apps/pack-football-visual-editor/src/app/app.routes.spec.ts
git commit -m "feat(kids-football): default route -> tenant-less club picker"
```

---

### Task 8: Gate + manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + test the two touched projects**

Run: `npx nx run-many -t lint test --projects pack-kids-football-ui,pack-football-visual-editor`
Expected: all green.

- [ ] **Step 2: Full local gate**

Run: `npm run ci:local`
Expected: PASS. (No DB lane needed — this change touches no Prisma/RLS path, so `test:db` is not required.)

- [ ] **Step 3: Manual browser run-through**

Start servers (API `:3150`, UI `:4200`), then:
1. Visit `http://localhost:4200/` → redirects to `/kids-football`; picker shows **FC Sonnenberg (3 profiles)** + **FC Stadtpark (1 profile)**.
2. Click **FC Sonnenberg** → lands on `/t/<sonnenberg>/p/kids-football/sign-in` showing only that club's 3 profiles.
3. Back to `/kids-football` → click **Set up a new club** → wizard; complete it → after create, revisit `/kids-football` → the new club now appears with "You created this club".
4. Keyboard: Tab through the club buttons + "Set up a new club"; confirm visible focus ring and Enter activates.

Capture a screenshot to `docs/club-grass-club-picker-landing-proof.png` (workbench `docs/`).

- [ ] **Step 4: No commit** (verification only). Record the screenshot path + a one-line result in the PR body.

---

## Landing the PR (after all tasks pass)

This is a `domains/exercir` change → open the PR, run the **review floor** then the verifier wave, drain findings, merge, run the twin ritual.

1. **PR body** carries: `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: standard`, and `Effect: cycle-time <pred>±<sd> expert` + `Effect: findings <pred>±<sd> expert` (self-observing on exercir PRs).
2. **Review floor (mandatory, per CLAUDE.md 2026-06-13):** non-trivial PR (new component + service + route) → full **verifier wave** — `local-ci` + `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer`, all `isolation: "worktree"`.
3. **Findings ritual:** open PR before the wave; after the wave write findings JSON and `post-findings de-braighter/exercir#NN findings.json` before merge.
4. **After merge:** `drain exercir#NN` → `backfill OWNER/REPO#NN` → `reconcile exercir#NN` (twin ritual is mandatory).
5. **Charter watch:** this surfaces NO inferred player state, so `subjectSensitivity` stays unarmed — confirm with `exercir-charter-checker`. The picker reads only fixtures + localStorage; no PHI, no outbound (`demo_mode` D7 untouched).

## Self-review notes

- **Spec coverage:** §4.1 KfKnownClubsService → Task 2; §4.2 DEMO_CLUBS → Task 1; §4.3 ClubPickerPageComponent → Task 4 (+ i18n Task 3); §4.4 onboarding hook → Task 6; §4.5 host wiring + export → Tasks 5+7; §6 testing → folded per-task; §7 YAGNI/demo-seam → component doc-comment. All covered.
- **Type consistency:** `KnownClub { tenantId, clubName }` and `remember(KnownClub)` used identically in Tasks 2/4/6; `DemoClub { tenantId, clubName, profileCount }` in Tasks 1/4; `PickerClub` is component-internal.
- **Profile-count pluralization:** the picker uses `.one`/`.other` keys (one tasteful exception on the literal front door) — the rest of the app's `{n} X` convention is unchanged.
