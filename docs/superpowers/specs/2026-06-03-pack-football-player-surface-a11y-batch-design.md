# Pack-football player-surface a11y batch (live-region + step-position) — technical design

- **Date:** 2026-06-03
- **Domain:** exercir / pack-football-ui
- **Issue:** [exercir#178](https://github.com/de-braighter/exercir/issues/178) — shared persistent live-region + step-position for player surfaces
- **Source:** deferred F5 + F2 findings from the #177 a11y-pro verifier-wave audit
- **Builds on:** the completed 5/5 player-surfaces showcase arc (#176/#177/#179/#180/#183) + the funnel page
- **Status:** approved scope (founder chose "all 6 surfaces"), pending plan

## 1. Problem

Two accessibility findings, deferred from the #177 audit, batched here.

### F5 — live-region race (moderate, WCAG 4.1.3 Status Messages)

Every player surface renders its loading / failed status node **inside** the
`@switch (state().kind)` control flow:

```html
@case ('loading') {
  <p class="status" role="status" aria-live="polite" data-testid="…-loading">Form wird geladen…</p>
}
@case ('failed') {
  <p class="status failed" role="status" aria-live="polite" data-testid="…-failed">Form konnte nicht geladen werden: {{ failureReason() }}.</p>
}
```

`aria-live` is a **mutation** contract: assistive tech watches an element that
is *already in the accessibility tree* and announces when its text changes.
Angular's `@case` **creates and destroys** the node per state, so AT sees a
brand-new node (announced unreliably across screen readers) and then a deletion
(`loading → loaded` removes the only live node, so **the success transition is
silent**). The bug is structural, not cosmetic.

This gap is **byte-identical across all six surfaces** — the three named in the
issue (form / training / funnel) plus three that shipped after the audit with
the same pattern (log / team / match). All six share the same `LoadState`
discriminant (`idle | loading | loaded | failed`).

### F2 — step-position in the training timeline (moderate enhancement, WCAG 1.3.1)

The training periodization is an `<ol class="phases" list-style:none>`. Most AT
do **not** announce ordinal position for a list-style-none `<ol>`. The active
phase reads "Aktiv:" via an sr-only span but not "Aktiv, Phase 3 von 5". The
`@for`'s `$index`/`$count` are already in scope to supply it.

## 2. Scope decision

**All six live-loading player surfaces** get the F5 fix (founder-approved over
the issue's literal 3): a *shared* helper that leaves half the surfaces broken
is not a fix. F2 is **training-only** (it is the only timeline). UI-only,
`libs/pack-football-ui`. No data, contract, or wire-schema change.

## 3. Deliverables

### D1 — `FcStatusLiveComponent` (new — `libs/pack-football-ui/src/lib/a11y/status-live.component.ts`)

> New `a11y/` folder. The `pack-hex-layout` lint rule governs only
> `platform:node` packs; `pack-football-ui` is an Angular lib (`scope:pack-football`),
> so a new top-level folder is allowed.

A standalone, OnPush, **presentational** component:

- `selector: 'fc-status-live'`, `@Input({ required: true }) message = ''`.
- Template is the single persistent region, **always in the DOM**:
  ```html
  <p class="sr-only" role="status" aria-live="polite" data-testid="fc-status-live">{{ message }}</p>
  ```
- Owns the `.sr-only` style block (the visually-hidden clip rule currently
  re-declared in every surface — centralising it is a bonus DRY).
- Because the element is created once and only its **text** changes, AT
  reliably announces every `loading → loaded → failed` transition (APG
  "status message" pattern).

### D2 — `liveStatusMessage(kind, noun, reason?)` (new — `libs/pack-football-ui/src/lib/a11y/live-status-message.ts`)

A pure function so the German copy is authored once, not in six computeds:

| `kind` | result |
|---|---|
| `idle` | `''` (silent — no announcement before the first load) |
| `loading` | `` `${noun} wird geladen…` `` |
| `loaded` | `` `${noun} geladen.` `` |
| `failed` | `` `${noun} konnte nicht geladen werden: ${reason}.` `` |

The `loading` / `failed` strings are **identical to each surface's existing
visible copy**, so the hidden region and the visible node never disagree; only
the previously-silent `loaded` case gains a (terse) announcement.

### D3 — Per-surface adoption (×6)

For each of `player-form-page`, `player-training-page`, `fc-player-funnel-page`,
`player-log-page`, `player-team-page`, `player-match-page`:

1. Import `FcStatusLiveComponent`; add `<fc-status-live [message]="liveMessage()" />`
   **outside** the `@switch` (top of the template) so it is always present.
2. Add `protected readonly liveMessage = computed(() => liveStatusMessage(this.state().kind, '<noun>', this.failureReason()));`
3. **Strip** `role="status"` + `aria-live="polite"` from the visible `@case`
   `<p>` nodes (keep their visible text **and** their `data-testid`s) — so there
   is exactly **one** live region, not two competing announcers.

Noun per surface (matches each surface's existing visible loading copy):

| Surface | noun | failure helper |
|---|---|---|
| `player-form-page` | `Form` | `describePlayerFunnelFailure` |
| `player-training-page` | `Training` | `describePlayerFunnelFailure` |
| `fc-player-funnel-page` | `Trichter` | `describePlayerFunnelFailure` |
| `player-log-page` | `Protokoll` | `describePlayerFunnelFailure` |
| `player-team-page` | `Team` | `describeSubstrateClientFailure` |
| `player-match-page` | `Nächstes Spiel` | `describeSubstrateClientFailure` |

(`failureReason()` already exists on every surface as a computed off `state()`;
this design only consumes it.)

### D4 — F2 training step-position (`player-training-page` only)

In the phase `@for`, expose the ordinals and extend the existing sr-only span:

```html
@for (ctx of v.view.contexts; track ctx.id; let idx = $index, let cnt = $count) {
  …
  <span class="sr-only">{{ stateWord(ctx.state) }}, Phase {{ idx + 1 }} von {{ cnt }}:</span>
  …
}
```

`aria-current="step"` on the active phase is already present and unchanged. The
ordinal is added to **all** phases (consistent "Phase n von N"), not only the
active one.

## 4. Testing

- **`status-live.component.spec.ts`** (new): the region is present at render
  (before any message); message binding updates text; the node carries
  `role="status"`/`aria-live="polite"` and `.sr-only`.
- **`live-status-message.spec.ts`** (new): all four arms, including the empty
  `idle` string and the `failed` reason interpolation.
- **Each surface spec (×6)**: add an assertion that exactly one
  `[data-testid="fc-status-live"]` exists and carries the state text
  (loading → "…wird geladen…", loaded → "…geladen."); confirm the visible
  `@case` node no longer carries `role="status"` (guards against re-introducing
  a second live region). Existing `data-testid`-based assertions are unaffected.
- **Training spec**: assert the active phase's sr-only text contains
  `Phase 3 von 5` (or the seed's actual ordinals).
- **axe-core** no-violations test stays green on every surface.

## 5. Sequencing (one PR)

1. D1 + D2 (TDD: specs first, then component + function).
2. D3 adoption across the six surfaces (one surface at a time, re-running that
   surface's spec).
3. D4 training step-position.
4. Full local verifier wave (`local-ci` + `reviewer` + `qa-engineer` +
   charter checkers) before merge; full `pack-football-ui` suite via the
   single-fork / `--coverage=false` workaround for the known coverage-OOM.

## 6. Non-goals / out of scope

- No data, contract, wire-schema, or endpoint change.
- No coach-side surfaces (shell / drills / generation also use in-`@case`
  `role="status"`, but they are out of the player-surface arc and this issue).
- No new i18n machinery — copy stays inline German (`de-CH`), consistent with
  the whole player-surfaces arc.
- Not addressing #181 (coach-grant auth carry-forward) or substrate#83
  (`subjectSensitivity`) — tracked separately.

## 7. Rationale notes

- **Why a component, not a directive:** both satisfy "shared helper", but the
  component also absorbs the `.sr-only` CSS duplicated in all six surfaces and
  is trivially testable in isolation. A directive would still require each
  surface to supply its own hidden element + styling.
- **Why keep the visible status text:** sighted users still need to see
  "… wird geladen…" / the error. The visible node loses only its *live-region
  role*; the hidden persistent region becomes the sole announcer, avoiding
  double-announcement.

## As-shipped note (2026-06-03)

Shipped in exercir PR #184 (squash `c6c49f3`), closing #178. The component
selector is **`lib-fc-status-live`** (the repo's `lib-` prefix lint rule), the
F2 denominator uses `v.view.contexts.length` (a `$count` alias tripped a strict
TS2339), and the component spec drives its input via `componentRef.setInput`
(Angular zoneless). The new component carries its *own* scoped `.sr-only`; the
"centralise the sr-only" framing above was an overstatement — each surface
keeps its own for its other hidden spans. Verifier wave (a11y-pro / qa-engineer
/ exercir-charter-checker) all green.
