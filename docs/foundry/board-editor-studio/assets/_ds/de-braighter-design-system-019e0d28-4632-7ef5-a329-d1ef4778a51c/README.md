# de Braighter — Design System

> A SaaS platform for managing dev and ops with skinnable, glass-forward interfaces. Currently in scope: **exercir** — the dev-side tool for managing MCP server state.

---

## Index

| File | Purpose |
| --- | --- |
| `README.md` | This file. Brand context, content + visual + iconography fundamentals. |
| `SKILL.md` | Agent SKILLS-compatible entry point. Read first if invoked as a skill. |
| `colors_and_type.css` | All design tokens. Three skins (`exercir`, `strategir`, `operir`) plus base scales. |
| `fonts/` | Empty — fonts are loaded from Google Fonts. See **Caveats** below. |
| `assets/` | Logos and shared visual assets. |
| `preview/` | Per-token preview cards (Design System tab). Ignore unless extending. |
| `ui_kits/exercir/` | The full UI kit for **exercir** — JSX components + an interactive index.html. |
| `slides/` | Slide deck template (TitleSlide, KPISlide, ComparisonSlide, BigQuoteSlide, AgendaSlide). |

## Brand & products

**de Braighter** is the parent company. The portfolio is a family of SaaS tools whose names share an `-ir` ending (Latinate, action-flavored). Each product lives under one of three skins so they share chrome, components, and content tone but feel distinct in color.

| Product | Status | Skin | Domain |
| --- | --- | --- | --- |
| **exercir** | In scope | Cyan / electric blue | Dev — MCP server state, tool registries, deployments |
| **strategir** | Future | Violet | Strategy / planning |
| **operir** | Future | Emerald | Operations / runtime |

The same component library renders all three by toggling `[data-skin="…"]` on `<html>`.

## Sources

The user did not attach any prior assets, codebase, Figma, or slide deck. Everything in this system is original, designed against the brief: "dark background with glassy glowing elements" for a devops SaaS. **There is no upstream source of truth to verify against.**

---

## CONTENT FUNDAMENTALS

### Voice
Speak like a calm, terse on-call engineer. The product is a control surface — every word is doing work. Confidence without bravado, clarity over cleverness, mechanical sympathy with the systems we're describing.

### Casing
- **Sentence case** for headings, button labels, menu items. Never Title Case.
- **lowercase** for product names (`exercir`, `strategir`, `operir`) and infra-style identifiers (`stripe-prod`, `us-east-1`). Capitalize **de Braighter** at the start of a sentence; otherwise leave as written.
- **UPPERCASE** only for `OVERLINE` labels (caps tracked at +0.14em, used as sub-section captions).

### Person
- **You** for the operator. ("You haven't deployed in 4 days.")
- **We** sparingly, only when the platform is taking the action. ("We restarted 2 servers.")
- Never **I**. Never refer to the product as a person.

### Tone moves
- Lead with the noun, not the verb. *"3 servers degraded"* > *"There are 3 degraded servers"*.
- State, then explain. *"Failed. The endpoint returned 502 for 4 of 12 tools."*
- Numbers go first, units after. *"184ms p95"*, never *"p95 of 184ms"*.
- No exclamation marks. Ever.
- No emoji. Status is conveyed via colored dots, badges, and glow.
- No marketing adjectives — never "powerful", "seamless", "modern", "robust", "intuitive".
- Errors are blameless and actionable: *"Couldn't reach mcp.acme.io. Check the endpoint or retry."* — not *"Error: connection failed."*

### Examples (good)
- Empty state: *"No servers yet. Connect one to get started."*
- Confirm: *"Disconnect stripe-prod? Tools using it will fail until reconnected."*
- Toast: *"Deployed v1.42.0 to us-east-1."*
- KPI label: `LATENCY P95`
- Tooltip: *"Last health check 12s ago."*

### Examples (avoid)
- ~~"Awesome! Your server is now live 🚀"~~
- ~~"Oops — something went wrong."~~
- ~~"Powerfully manage your MCP infrastructure."~~

---

## VISUAL FOUNDATIONS

### The signature
A **near-black void** with **frosted glass panels** that catch the light from a single, colored **halo**. The halo color is the skin. Everything else is a study in restraint — neutral grays, hairline borders, a single accent that never appears in body copy.

### Color
- **Surfaces:** five steps from `#050608` (`bg-0`, the void) to `#161b2c` (`bg-3`, raised glass on hover). All have a faint blue undertone — never neutral gray. A separate `bg-inset` (`#04050a`) is darker than the void; use it for sunken elements (text inputs, terminals).
- **Foreground:** four steps from `#e8ecf7` to `#3d4360`. Body copy is `fg-2` (`#a4adc8`); headings are `fg-1`. Hierarchy by weight, not size.
- **Accent:** one color per skin, with three shades (`accent`, `accent-strong`, `accent-deep`) and two glow tokens (`accent-soft` for filled backgrounds, `accent-rim` for borders). Never use accent for body copy — only edges, glows, primary buttons, and active states.
- **Status:** `ok` / `warn` / `err` / `info` are skin-independent. They appear as 6px dots with 6px outer glow and as soft-fill pills with a 12% alpha background.

### Type
- **Display:** Space Grotesk 600 — for headings, KPI numbers, hero copy. Tracking −0.02em.
- **Body:** Inter 400/500 — everything else. ss01 + cv11 enabled for the alternate `g`.
- **Mono:** JetBrains Mono 400/500 — code, terminal output, IDs, timestamps, KPI units, and OVERLINE labels.
- **Scale:** 11/12/13/15/17/20/24/32/44/64. The OVERLINE (11px mono caps, +0.14em tracking) is a recurring motif — it labels every panel, KPI, and sidebar group.

### Spacing
4px base. Use the named tokens (`--s-1` … `--s-20`), not raw px. Density is intentionally tight — this is a control surface, not a marketing site. Card padding is typically `--s-4` (16px) on small cards, `--s-5` (20px) on large.

### Background
- **Page:** `bg-0` solid, with **two soft radial gradients** behind the chrome: one in the brand color from the top-right at ~10% alpha, one in a complementary skin's color from the bottom-left at ~6% alpha. These create the "ambient glow" without ever calling attention to themselves.
- **No imagery, no patterns, no scanlines.** The void is the canvas. Imagery, when used (rare), is full-bleed and tinted toward the brand color — cool, slightly desaturated, never warm.
- **No gradients on UI elements** other than the subtle vertical sheen on glass (4% white at top → transparent at 30%) and the linear-fill on primary buttons.

### Glass — the foundational surface
Every modal, sidebar, popover, dropdown, and floating panel uses the same composition:
- Background: `linear-gradient(180deg, rgba(22,27,44,0.72), rgba(15,19,32,0.62))`
- `backdrop-filter: saturate(140%) blur(18px)`
- 1px hairline border at `rgba(148,163,210,0.08)`
- Outer shadow: `0 12px 40px rgba(0,0,0,0.6)`
- Inner rim: `inset 0 1px 0 rgba(255,255,255,0.06)` — catches the halo light

Solid (non-glass) cards use the same shape but with `bg-2` background and no blur. Use them inside scroll regions where the blur would tank performance.

### Glow
The skin's accent color is **only ever** used as light, not paint. Treatments:
- **Rim** — 1px border at 45% alpha, used on focused inputs and feature cards.
- **Halo** — `0 0 24px var(--accent-rim), 0 0 80px` for primary buttons, active nav items, status dots.
- **Bar** — a 2px gradient line `linear-gradient(90deg, transparent, accent, transparent)` with an outer glow, used as an accent strip on feature cards and as the border of active tabs.

### Borders
- **Hairlines** at 8% alpha for default, 14% on hover, 22% for true dividers. They're translucent so they layer correctly over glass.
- **No borders on top of glass for grouping** — use a faint inner shadow `inset 0 1px 0 rgba(255,255,255,0.04)` instead, which reads as a subtle bevel.

### Corner radii
Pill-or-square. Use `--r-1` (4px) for chips and tags, `--r-2` (8px) for inputs and small cards, `--r-3` (12px) for default cards/panels, `--r-4` (16px) for feature cards, `--r-5` (24px) for full-page hero panels, and `--r-pill` (999px) for badges and rounded buttons. Avoid in-between values.

### Cards
Three flavors:
1. **Default** — solid `bg-2`, 1px hairline, `r-3`, `shadow-1`. The workhorse.
2. **Glass** — the signature panel above, `r-3`, `shadow-2`. Floating things.
3. **Feature** — glass + `accent-rim` border + `accent-soft` outer glow + 2px accent bar at the top. Used sparingly for the one card on a screen that earns attention.

### Shadows
- **Outer** — four steps from a 1px lift (`shadow-1`) to a 24px / 80px diffuse lift for modals (`shadow-4`).
- **Inner rim** — every glass surface gets `inset 0 1px 0 rgba(255,255,255,0.06)`. This is non-negotiable; it's what makes glass read as glass.
- **Glow** — only on focused elements, primary CTAs, and status dots. Never decorative.

### Animation
- **Easing:** Default to `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out). Two-way state changes use `cubic-bezier(0.65, 0, 0.35, 1)` (ease-in-out). No bounces in product UI; reserve spring for marketing/decks only.
- **Duration:** 120ms for hovers, 200ms for state changes, 320ms for entrances, 520ms for full-screen transitions.
- **Glow pulse:** Status dots that need attention pulse at 1.6s ease-in-out, 100% → 35% opacity. Used for `healthy` (subtle reassurance) and `down` (urgent demand).
- **No fade-and-slide.** Things appear at full opacity; if they need an entrance, they `scale(0.96) → scale(1)` with a fade over 200ms.
- **Scroll-triggered animations:** never. This is software, not a brochure.

### Hover, focus, press
- **Hover:** background lifts to next bg step (`bg-2 → bg-3`), border lifts to next line step (`line-1 → line-2`). No color shifts on text. 120ms.
- **Focus:** 3px outer glow at `accent-soft` + border at `accent-rim`. Always visible — never `outline: none` without a replacement.
- **Press:** `transform: scale(0.98)`, no color change. 80ms.
- **Disabled:** 40% opacity, `cursor: not-allowed`, no hover state.

### Transparency & blur
- Glass panels use blur. Solid cards inside scroll regions don't.
- Backdrop blur on any panel that floats over scrolling content (sidebar, top bar, modals).
- The `accent-soft` token (16% alpha of the accent) is the only place transparency colors body content — used as a focus halo and as the fill of `info` badges.

### Layout rules
- App chrome is **fixed**: a 240px left nav (collapses to 56px), a 56px top bar, content fills the rest. Both nav and top bar are glass.
- Content uses a 12-column grid at `--s-6` (24px) gap on desktop. Cards snap to the grid.
- Page padding is `--s-6` (24px) at the edges, `--s-8` (32px) between sections.

### Iconography see below.

---

## ICONOGRAPHY

**Library:** [Lucide](https://lucide.dev/) — loaded from CDN as `lucide-static` SVG sprites in JSX. We picked Lucide because the 1.5–2px stroke weight reads as instrumented and precise on a dark surface, the icon set is comprehensive for devops concepts (server, terminal, git-branch, activity, shield, key), and the geometry is calm — no quirky flourishes that would compete with the glow.

**Substitution flag:** No icon font or sprite was provided by the user; Lucide is our chosen substitute. If the brand later commissions a custom set, replace via `assets/icons/` — every icon usage in the UI kit is wrapped in a small `<Icon name="…" />` component to make swapping trivial.

**Stroke + size:**
- Default stroke width: **1.6px** (slightly thinner than Lucide's default 2px, to match the airy feel of the type).
- Default sizes: **14px** in dense table rows and inline with body text, **16px** for sidebar and button icons, **20px** in section headers and tooltips, **24px** in empty-state hero illustrations.
- Color: inherit from text. On nav items in active state, icons take the accent color and pick up a `drop-shadow(0 0 6px var(--accent-rim))` glow.

**Custom marks:** The three product logomarks (`exercir`, `strategir`, `operir`) are the only custom icons. They are simple geometric monograms drawn in the skin's accent color with a 1.6px stroke and a 6px outer glow. See `assets/`.

**Status dots:** Colored 6px circles with a 6px outer glow are used in place of icons wherever space is tight (table rows, breadcrumb, inline status). Color comes from the status token (`--ok`, `--warn`, `--err`, `--info`).

**Emoji:** Never. Emoji clash with the dark, glass-forward look — the saturated pixel-art shapes break the calm.

**Unicode glyphs:** Used sparingly for arrows in compact contexts: `→` in CTAs ("Deploy server →"), `↑` `↓` for KPI deltas, `·` (middle dot) as a metadata separator. Never for icons that have a Lucide equivalent.

**Where icons live:**
- Sidebar nav items
- Button left-affordance (e.g. `<Plus/> New server`)
- Empty states (single 24px icon above the heading)
- Inline with metadata (`<Clock/> 2m ago`)
- Never decoratively in headings or as bullets in lists.

---

## CAVEATS

- **No real fonts shipped.** Space Grotesk, Inter, and JetBrains Mono are loaded from Google Fonts. If you want to ship offline-able artifacts, drop the `.woff2` files into `fonts/` and swap the `@import` for `@font-face` rules.
- **No upstream source.** This system was designed to brief, with no codebase, Figma, or screenshots to verify against. Treat it as a strong starting point that needs your eye on it.
- **No imagery.** Brand photography hasn't been commissioned — when needed, we use a tinted dark gradient as a placeholder.
- **Single product UI kit.** Only `exercir` is built; `strategir` and `operir` are documented in tokens (skins) but not yet rendered as full kits.

---

## How to use this system

1. Drop `colors_and_type.css` into your page. Set `<html data-skin="exercir">` (or `strategir` / `operir`).
2. Pull components from `ui_kits/exercir/` — they're plain React/JSX, no build step required (`type="text/babel"`).
3. For decks, copy a layout from `slides/` and lift the `<deck-stage>` host.
4. When in doubt, return to the principle: **the void is the canvas, glass is the surface, glow is the light.**
