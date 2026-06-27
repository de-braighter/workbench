# Claude Design — token-name alignment prompt

**Purpose:** make Claude Design's saved "de Braighter" design system emit our PRODUCTION
token contract (`@de-braighter/design-system-css/tokens.css`) verbatim, so exported
screens drop into the codebase with no translation layer.

**Why this exists:** the current Claude Design handoff (`colors_and_type.css`) emits a
dark glass/neon vocabulary (`--fg-1`, `--bg-0..3`, `--line-1..3`, `[data-skin]`, Space
Grotesk). Our shipping apps use a different, authoritative vocabulary (`--ink`, `--bg`,
`--rule`, `--accent`, `[data-theme]`, Newsreader + Inter Tight). The studio components
were built against the handoff names (plus ad-hoc abbreviations `--f1/--b1/--l/--ac`),
so nothing lined up. This prompt realigns the design source of truth.

---

## PROMPT (paste into Claude Design)

Update the saved **de Braighter** design system so every screen you export references our
PRODUCTION token contract **verbatim**. Today your foundation emits dark glass/neon tokens
(`--fg-1`, `--bg-0..3`, `--line-1..3`, `[data-skin]`, Space Grotesk). Our shipping app
(`@de-braighter/design-system-css/tokens.css`) uses the authoritative vocabulary below.
Rename your foundation **and every component/screen** to match it EXACTLY, and persist it
into the saved design-system asset so future exports inherit it.

### 1. Theming model (critical)
- Theme is selected by `[data-theme="…"]` on `<html>` — **NOT** `[data-skin]`.
- Themes: `cancer`, `football`, `health`, `neutral`, `sport`. Set a default of `football`.
- The base semantic tokens (`--bg`, `--ink`, `--rule`, `--accent`, …) are defined ONLY
  inside each `[data-theme]` block. There is **no `:root` fallback** — a default theme MUST
  be set on `<html>` or the UI renders unstyled.
- The theme-agnostic scale (`--color-*`, `--sem-*`, `--font-*`, `--t-*`, `--s-*`, `--r-*`,
  motion, shadows, data-viz) lives at `:root`.

### 2. Token contract — use these names ONLY
- **Surfaces** (per-theme): `--bg` (page), `--bg-elev` (raised), `--bg-sunken`, `--paper` (card)
- **Ink/text** (per-theme): `--ink`, `--ink-2`, `--ink-3` (meta), `--ink-4` (faint/disabled)
- **Rules** (per-theme): `--rule` (hairline), `--rule-strong` (divider)
- **Accent** (per-theme): `--accent`, `--accent-2`; helpers `--accent-soft`, `--accent-rim`, `--line` (= `var(--rule)`)
- **Surface aliases** (`:root`, what components reference): `--color-bg`, `--color-bg-raised`,
  `--color-bg-sunken`, `--color-paper`, `--color-paper-2`, `--color-paper-3`, `--color-paper-sunk`,
  `--color-border`, `--color-border-strong`, `--color-hair`, `--color-hair-strong`
- **Ink aliases** (`:root`): `--color-ink-strong`, `--color-ink`, `--color-ink-muted`,
  `--color-ink-2`, `--color-ink-3`, `--color-ink-4`
- **Accent aliases** (`:root`): `--color-accent`, `--color-accent-on`, `--color-accent-ink`, `--color-accent-soft`
- **Status** (`:root`): `--color-ok(/-soft)`, `--color-warn(/-soft)`, `--color-risk(/-soft)`,
  `--color-rest(/-soft)`; `--sem-success(/-bg)`, `--sem-warning(/-bg)`, `--sem-danger(/-bg)`,
  `--sem-info(/-bg)`; tones `--tone-accent/-neutral/-ok/-warn/-risk/-rest`
- **Type families**: `--font-display` = "Newsreader" (serif), `--font-ui` = "Inter Tight",
  `--font-mono` = "JetBrains Mono"
- **Type sizes**: `--t-display-1` 88, `--t-display-2` 56, `--t-headline` 40, `--t-title` 28,
  `--t-subtitle` 20, `--t-lede` 18, `--t-body` 14, `--t-body-sm` 13, `--t-meta` 12,
  `--t-caption` 11, `--t-eyebrow` 10, `--t-tick` 9
- **Line-height/tracking/weight**: `--lh-tight/-snug/-normal/-body/-loose`;
  `--tr-display/-headline/-title/-body/-mono/-eyebrow/-caps`; `--w-regular/-medium/-semibold`
- **Spacing/radius/container**: `--s-1`…`--s-16` (4px base); `--r-xs/-sm/-md/-lg/-xl/-pill`;
  `--container-xs`…`--container-xl`
- **Density/icons**: `--density-comfortable/-default/-compact`; `--icon-xs`…`--icon-xl`,
  `--icon-stroke`, `--icon-stroke-xs`
- **Motion**: `--ease`, `--ease-spring`, `--ease-in`, `--ease-out`;
  `--dur-instant/-fast/-base/-slow/-slower`
- **Elevation/z**: `--shadow-flat/-hairline/-1/-2/-3/-4/-overlay`;
  `--z-base/-raised/-sticky/-dropdown/-drawer/-modal/-toast/-tooltip`
- **Data-viz/domain** (keep as-is): `--cat-1..6`, `--seq-1..5`, `--hr-z1..5`,
  `--layer-phase/-context/-capability/-trait/-indicator/-resource/-intervention`,
  `--rel-positive/-adverse/-structural/-conserving/-temporal`, `--kls-*`, `--fc-blue/-gold`,
  `--ink-50..950`

### 3. Utility classes — use these, don't reinvent type
- **Type**: `.t-display`, `.t-display-1`, `.t-display-2`, `.t-display-i`, `.t-headline`,
  `.t-title`, `.t-subtitle`, `.t-lede`, `.t-body`, `.t-body-sm`, `.t-meta`, `.t-caption`,
  `.t-tick`, `.t-eyebrow`, `.t-mono`, `.t-num`, `.tabular`, `.proportional`
- **Icons**: `<svg class="ico ico-sm|md|lg">` with `[data-stroke]`/`[data-fill]`/`[data-accent]`;
  `.ico-muted`, `.ico-accent`
- **Rules/grid/dots**: `.hr`, `.hr-strong`, `.grid-bg`, `.layer-dot` + `.dot-phase/-context/…`

### 4. Rename map — migrate your current foundation + every screen
- `--fg-1 → --ink` · `--fg-2 → --ink-2` · `--fg-3 → --ink-3` · `--fg-4 → --ink-4` · `--fg-on-glow → --color-accent-on`
- `--bg-0 → --bg` · `--bg-1 → --bg-elev` · `--bg-2 → --paper` · `--bg-3 → --bg-elev` · `--bg-inset → --bg-sunken`
- `--line-1 → --rule` · `--line-2 → --rule-strong` · `--line-3 → --rule-strong`
- `--accent` keep · `--accent-strong/--accent-deep → --accent-2` · `--accent-soft` keep · `--accent-rim` keep
- `--ok → --color-ok` · `--ok-bg → --color-ok-soft` · `--warn → --color-warn` · `--warn-bg → --color-warn-soft`
  · `--err → --color-risk` · `--err-bg → --color-risk-soft` · `--info → --sem-info` · `--info-bg → --sem-info-bg`
- `--font-display` (Space Grotesk) → `--font-display` (Newsreader) · `--font-body → --font-ui` · `--font-mono` keep
- `--fs-display/-h1 → --t-display-1/--t-headline` · `--fs-h2/-h3/-h4 → --t-title/--t-subtitle/--t-subtitle`
  · `--fs-body → --t-body` · `--fs-body-sm/-meta/-overline → --t-body-sm/--t-meta/--t-eyebrow`
- `[data-skin="exercir"|"strategir"|"operir"] → [data-theme="football"|"neutral"|"health"]`

### 5. Hard rules
- Output CSS may reference ONLY the names in §2/§3. **No** `--fg-*`, `--bg-0..3`, `--line-*`,
  `--fs-*`, and **no** abbreviations (`--f1`, `--b1`, `--l`, `--ac`, `--accent-1`, `--ok-1`, …).
- Use `[data-theme]` for theming; always set a default theme on the root element.
- Load Newsreader, Inter Tight, JetBrains Mono.
- For a dark surface: **do not invent new names** — add a new `[data-theme="…"]` block that
  re-binds the SAME base tokens (`--bg`/`--ink`/`--rule`/`--accent`/…) to dark values. The
  naming contract is invariant; only values change per theme.
- Persist all of the above into the saved design-system asset so future exports inherit it.
