# Handoff: Board Editor skins (`ivory`, `clinical`, + `night` chrome)

## Overview
This package adds two new **skins** to the Board Editor Studio and documents the editor-chrome tokens that make them work. The de Braighter design system selects a skin via a `[data-theme="…"]` attribute on the root element. We added:

- **`ivory`** — bright, elegant, professional. Warm paper + refined indigo accent.
- **`clinical`** — medical / scientific. Cool near-white paper + clean clinical blue accent.

We also added a set of **editor-chrome tokens** (`--glass-*`, `--rail-bg`, `--scrim`, `--grid-dot`, `--accent-on`, `--code-*`) to every skin the editor uses, including the existing dark **`night`** skin, so all chrome (top bar, side rail, drawer, code panel, preview canvas) is fully theme-driven.

## About the design files
The files here are a **design reference**, not production code to paste in. `skins.css` is a clean, drop-in extract of the relevant `[data-theme]` blocks. The task is to fold these tokens into the target codebase's existing theming layer (CSS variables, a theme provider, Tailwind config, SCSS maps, design-token JSON, etc.) using its established patterns — not necessarily to ship this CSS file verbatim.

## Fidelity
**High-fidelity.** All values are final. Hex/rgba values below are exact and should be reproduced precisely.

## Theming model (important)
- A skin is selected by `[data-theme="ivory" | "clinical" | "night"]` on the root (the editor sets it on its top-level container).
- **Base tokens** (`--bg`, `--ink`, `--rule`, `--accent`, `--glass-*`, …) are defined **only inside each `[data-theme]` block — there is no `:root` fallback.** A theme MUST be set or the UI renders unstyled.
- The **theme-agnostic scale** (`--font-*`, type scale `--t-*`, spacing `--s-*`, radius `--r-*`, status `--color-*`/`--sem-*`, motion `--ease-*`/`--dur-*`, shadows `--shadow-*`) lives at `:root` in the base `colors_and_type.css` and is **unchanged** by this work. Skins only re-bind the base color tokens + chrome tokens.
- Because CSS custom properties inherit, setting `data-theme` on an ancestor themes everything beneath it. Status colors (`--color-ok` etc.) are theme-independent by design.

## Token reference

Every skin defines the same token names; only the values change. Roles:

| Token | Role |
| --- | --- |
| `--bg` | Page background |
| `--bg-elev` | Raised surface / card |
| `--bg-sunken` | Sunken surface / inputs |
| `--paper` | Card surface |
| `--ink`, `--ink-2`, `--ink-3`, `--ink-4` | Text: primary, body, meta, faint |
| `--rule`, `--rule-strong` | Hairline border, divider/hover border |
| `--accent`, `--accent-2` | Accent, deeper accent |
| `--accent-soft` | Focus halo / soft fill (≈10–16% accent) |
| `--accent-rim` | Focus / active border (≈36–45% accent) |
| `--line` | Accent-tinted line |
| `--glass-bg` | Glass-panel background gradient (top bar, drawer, code panel) |
| `--glass-blur` | `backdrop-filter` value for glass panels |
| `--rail-bg` | Left side-rail background gradient |
| `--scrim` | Modal / drawer backdrop overlay |
| `--glass-shadow` | Drawer drop shadow |
| `--grid-dot` | Dot color of the preview canvas grid |
| `--accent-on` | Text/icon color on top of an accent fill (e.g. primary button) |
| `--code-str`, `--code-num` | JSON syntax-highlight colors (string, number) — key uses `--accent` |

### `ivory` — bright, elegant, professional
```
--bg #f4f1ea   --bg-elev #fffdf8   --bg-sunken #ebe6da   --paper #fffdf8
--ink #211e18  --ink-2 #565147     --ink-3 #8a8273       --ink-4 #b8af9d
--rule rgba(33,30,24,0.10)         --rule-strong rgba(33,30,24,0.16)
--accent #4b45c9   --accent-2 #38329f
--accent-soft rgba(75,69,201,0.10) --accent-rim rgba(75,69,201,0.36) --line rgba(75,69,201,0.26)
--accent-on #ffffff   --code-str #0c7a63   --code-num #9a5b00
--grid-dot rgba(33,30,24,0.10)   --scrim rgba(40,36,29,0.26)
--glass-bg linear-gradient(180deg, rgba(255,253,248,0.86), rgba(244,241,234,0.74))
--glass-blur saturate(115%) blur(16px)
--rail-bg linear-gradient(180deg, rgba(255,253,248,0.7), rgba(235,230,218,0.3))
--glass-shadow -22px 0 56px rgba(40,36,29,0.16)
```

### `clinical` — medical / scientific
```
--bg #eef2f6   --bg-elev #ffffff   --bg-sunken #e2e8ee   --paper #ffffff
--ink #142029  --ink-2 #44525f     --ink-3 #76838f       --ink-4 #a7b3bd
--rule rgba(20,32,41,0.10)         --rule-strong rgba(20,32,41,0.16)
--accent #1f74cf   --accent-2 #155aa6
--accent-soft rgba(31,116,207,0.10) --accent-rim rgba(31,116,207,0.36) --line rgba(31,116,207,0.26)
--accent-on #ffffff   --code-str #0c7a63   --code-num #9a5b00
--grid-dot rgba(20,32,41,0.10)   --scrim rgba(18,28,38,0.28)
--glass-bg linear-gradient(180deg, rgba(255,255,255,0.88), rgba(238,242,246,0.76))
--glass-blur saturate(120%) blur(16px)
--rail-bg linear-gradient(180deg, rgba(255,255,255,0.7), rgba(226,232,238,0.3))
--glass-shadow -22px 0 56px rgba(18,28,38,0.16)
```

### `night` — dark (default), chrome tokens added
```
--glass-bg linear-gradient(180deg, rgba(22,27,44,0.72), rgba(15,19,32,0.62))
--glass-blur saturate(140%) blur(18px)
--rail-bg linear-gradient(180deg, rgba(10,13,20,0.5), rgba(5,6,8,0.2))
--scrim rgba(3,4,6,0.5)   --glass-shadow -22px 0 56px rgba(0,0,0,0.5)
--grid-dot rgba(148,163,210,0.22)   --accent-on #04060d
--code-str #6df0b3   --code-num #f5b544
```
(night's base color tokens are unchanged from the design system.)

## Implementation steps
1. Add the three `[data-theme]` blocks from `skins.css` to your theming layer. If you already have `night`, merge only the chrome tokens into it.
2. Drive the active skin from a `data-theme` attribute on the app root (or your theme provider's equivalent). Default to `night`.
3. Reference tokens by name everywhere chrome is styled — never hardcode the hex/gradients. Glass panels: `background: var(--glass-bg); backdrop-filter: var(--glass-blur);`. Primary-button text: `color: var(--accent-on);`.
4. Verify each skin: text contrast (`--ink` on `--bg`), accent affordances (`--accent`, `--accent-soft`, `--accent-rim`), and that the light skins read correctly on the code panel (the `--code-*` tokens are tuned for a light background on `ivory`/`clinical`, a dark one on `night`).

## Notes
- The dark node cards drawn on the preview canvas are **authored content** (a shape definition's own `fill`), not chrome — they are intentionally theme-independent.
- Status colors (`--color-ok`/`-warn`/`-risk` and `--sem-*`) are theme-independent in the base system; we did not alter them.

## Files
- `skins.css` — drop-in extract of the three `[data-theme]` blocks (this package).
- In the project: `Board Editor Studio.dc.html` (the prototype that consumes these), `_ds/.../colors_and_type.css` (the full base token contract).
