# Handoff: Path Builder Studio (System Builder Studio)

## Overview
Path Builder Studio is a domain-agnostic **system builder**: you author a *System* (a plan-tree of intervention → outcome nodes that carry predicted effects and gates), then operate it. A "System" models its subjects, measures (traits), capabilities, phases, interventions, resources and external actions over time; any System can also drop into another as a single action.

The app is German (de-CH) chrome with English form labels, dark "glass" UI on the **de Braighter** design system, **exercir** (cyan) skin.

There are three top-level tabs — **Katalog** (library), **Betreiben** (operate), **Ergebnisse** (results) — plus two full-page editors reached from the catalog.

## About the Design Files
The files in this bundle are **design references created in HTML** — working prototypes that show the intended look, layout and behavior. They are **not production code to copy directly**.

They are authored as "Design Components" (`*.dc.html`) that run on a small bespoke prototype runtime (`support.js`) using a template + logic-class pattern. **Do not port `support.js` or the `.dc.html` template syntax.** Instead, **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, SwiftUI, etc.) using its established components, state, and routing. If no environment exists yet, pick the most appropriate framework (React + a state store is a natural fit given the graph editing) and implement there.

Read each `.dc.html` as: a `<x-dc>` HTML template (markup with `{{ value }}` holes and `<sc-for>` / `<sc-if>` control flow) plus a `class Component extends DCLogic` block (plain JS: `state`, `setState`, and a `renderVals()` that returns the values the template binds to). The data model and all behavior live in that class — that is the source of truth to reimplement.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, glass treatment, glow, and interactions are all intended as shown. Recreate the UI pixel-faithfully using the codebase's libraries and the exact design tokens listed below. Icons are inline single-path/multi-path SVGs in the [Lucide](https://lucide.dev) style (1.6–2px stroke, `currentColor`) — use the codebase's Lucide (or equivalent) set.

---

## The data model (most important section)

Everything is one in-memory catalog with eight item *libraries*. IDs are short slugs. Cross-references are by id. The editors deep-clone the catalog and mutate locally (a prototype convenience — in production this is your store/back-end).

### Libraries
| key | label | one item is… |
|---|---|---|
| `systems` | Systems | a whole model = a **plan-tree** (the runnable SDLC/delivery path). Opens the **plan-tree Editor**. |
| `subjects` | Subject types | the things you model; they **nest** (`contains`) and **have traits** (`hasTraits`). |
| `phases` | Phases | blocks of time; sequenced into a timeline. Carry **blocking conditions**. |
| `capabilities` | Capabilities | what a subject can do/become; **read from traits and other capabilities** (weighted tree). |
| `traits` | Traits | the measurable things; carry a **scale** and **measurement methods**. |
| `interventions` | Interventions | actions you take; each changes traits (**predicted effect**) and draws on resources. |
| `resources` | Resources | what interventions consume / what measurements use. |
| `actions` | Actions | external calls (webhook / integration / script) linked into interventions. |

### Item shapes (fields)
Common to all: `id`, `name`, `domain`, `desc`.

- **systems**: rendered as a plan-tree (see Editor). Root node `{ id, kind:'epic', title, children:[] }`; children are `kind:'work'` (carry `effect`, `actions`, `needs`) or `kind:'gate'` (carry `conds`).
- **subjects**: `contains: string[]` (subject ids), `hasTraits: string[]` (trait ids), `usedIn: string[]` (system ids).
- **phases**: `meta` (duration string), `usedIn: string[]`, `conditions: Condition[]`.
  - `Condition` = `{ type:'after', phase:<phaseId> }` **or** `{ type:'trait', subject:<id>, trait:<id>, op:'between'|'min'|'max', min?, max? }`.
- **capabilities**: `inputs: Input[]`, `usedIn: string[]`.
  - `Input` = `{ kind:'trait'|'capability', t:<id>, w:1..5, dir:'up'|'down' }`. A trait input may also carry a **per-capability scale override**: `override:boolean, ovMin, ovMax, ovNormalLow, ovNormalHigh`.
- **traits**: `unit` (string), `step` (number, e.g. `1` or `0.00001`), `min`, `max`, `baseline`, `normalLow`, `normalHigh`, and `measures: Measure[]`.
  - `Measure` = `{ name, resource:<resourceId|''>, trust:'low'|'med'|'high', error:number }`.
- **interventions**: `changes: Change[]`, `needs: string[]` (resource ids), `usedIn: string[]`, `meta` (cost string), `actionChain: ChainLink[]`, `failFast:boolean`.
  - `Change` = `{ t:<traitId>, dir:'up'|'down', strength:0..1, conf:0..1, dist:'single'|'range', spread:number, horizon:number(weeks), basis:'expert'|'literature'|'derived', evidence:string[] }`.
  - `ChainLink` = `{ action:<actionId>, when:'start'|'complete'|'measure'|'scheduled', measure?:<traitId>, every?:string }`.
- **resources**: `meta` (capacity string).
- **actions**: `type:'webhook'|'integration'|'script'`, `target`, `method:'GET'|'POST'|'PUT'`, `auth`, `payload:{k,v}[]`, `retry:'none'|'retry3'|'alert'`.

### Derived relationships (compute, don't store)
- A trait's **Used by** = capabilities whose `inputs` include it (as a trait) + interventions whose `changes` include it + subjects whose `hasTraits` include it.
- A resource's **Used by** = interventions that `need` it + **traits whose `measures` reference it**.
- A capability's **Aggregated by** = capabilities whose `inputs` reference it (as a capability).
- An action's **Linked by** = interventions whose `actionChain` references it.
- "unused" items (empty usage) surface a **drop** affordance; in-use items show a lock note.
- **Cycle protection**: a capability may not take an input that (transitively) already depends on it.

### Visibility
Every item has a per-item visibility level: `private` → `org` → `customers` (cycles in that order). Shown as a mono chip; affects a rail filter and card chips. Labels: Private / Org / Customers. Colors: private = `--fg-3` on `--bg-inset`; org = `--info` on `--info-bg`; customers = `--ok` on `--ok-bg`.

---

## Screens / Views

### 1. Studio shell (`Studio.dc.html`)
- **Purpose**: top-level nav + in-app routing (no reloads). Holds `screen` state and mounts the active surface.
- **Routes**: `catalog` → Catalog · `betrieb` → Betrieb · `ergebnisse` → Reproduzierbarkeit · `editor` (payload = system id) → plan-tree Editor · `item` (payload = `{lib, id}`) → ItemEditor.
- Each surface receives an `onNavigate(key, payload)` callback and an `embedded` flag; standalone, each surface falls back to page navigation.

### 2. Catalog (`Catalog.dc.html`)
- **Purpose**: the item library across all 8 types. Browse, search, filter by visibility, create, and open items.
- **Layout**: fixed 58px top bar (glass) with brand + segmented tabs + search (230px) + primary "New …" button; a 244px left rail (glass) with a Visibility filter and two grouped sections (**Compose** → Systems; **Building blocks** → the other 7); a fluid main area with a heading + intro + responsive card grid (`repeat(auto-fill, minmax(296px, 1fr))`, 16px gap).
- **Cards**: solid `--bg-2` cards (`--r-4` 16px radius, `--shadow-1`); featured cards use the glass + accent-rim + 2px top accent bar treatment. Each card: type icon, domain overline, visibility chip, name (display font 15.5px), description (min-height 38px), optional ready-bar, chips (e.g. "changes / needs / actions"), and a relationship footer.
- **Opening an item routes to a full-page editor**: Systems → Editor; everything else → ItemEditor. (There is **no** detail drawer — every type opens full-page.)
- **New**: the top "New …" button and the dashed "+ New" card both create an empty item — Systems → empty Editor; other types → empty ItemEditor draft.

### 3. Plan-tree Editor (`Editor.dc.html`) — Systems only
- **Purpose**: author a System as a structural indented-outline plan-tree.
- **Layout**: top bar (brand, "Katalog" back, System title + domain, visibility cycle, "In Foundry ausführen" actuation button); body = graph pane (left, flexible) + node inspector (right, 452px glass).
- **Graph pane**: indented outline; each row = elbow connector + glyph (epic/gate = rotated accent/warn square, work = dot) + mono id + title + tags; per-row hover tools: add child, add gate, indent, outdent, move up/down, delete. "+ Knoten auf oberster Ebene" appends a root-level node.
- **Inspector** (depends on selected node):
  - **work node** → "Vorhergesagte Wirkung": indicator picker, direction (verbessert/verschlechtert), μ and ±σ number inputs, a **Gaussian prior bell-curve** SVG with a ±2σ band, confidence slider, basis picker; plus **Aktionen** and **Bedarf** chip pickers.
  - **gate node** → state chip (pulsing), path-derived conditions list, inline **Freigeben** / Zurückweisen.
  - **epic/root** → description + counts (work-items, gates, effects). Editing the root title also renames the System.
- New empty system seeds a single epic root titled "Neues System".

### 4. Item Editor (`ItemEditor.dc.html`) — the 7 non-system types
A single shared full-page editor that adapts per type. Top bar mirrors the Editor (brand, "Katalog" back, kind · id + name, visibility cycle).

Two layout modes:
- **Single column** (centered, max-width 680) for: **traits, resources, phases, subjects, interventions**. Common fields (Name, Domain, Description) at top; type-specific section(s) below; then relationships + drop fold in at the bottom. Visibility lives in the top bar.
- **Two-pane** (tree/main + 372px glass inspector) for: **capabilities** (and **actions** keep a right meta panel).

Per-type specifics:
- **Trait** — a **Scale** section: Unit (text) + Step size (`<input type=number step=any>`, supports values like `0.00001`); Lower boundary, Upper boundary, Baseline; a **Normal range** (low–high); and a horizontal **scale visualization** (track with the normal band highlighted and a baseline tick + min/max labels). Then a **How to measure** section: a list of measurement methods, each = name + linked **resource** (`via …`) + **trust** segmented (rough / decent / precise) + **± exact** number in the trait's unit. Linking a resource makes the trait appear under that resource's "Used by".
- **Resource / Phase** — Capacity / Duration text field. Phase also has **Blocked by** (predecessor "waits until X has ended" + trait-range conditions on a subject) and **Blocks** (downstream successor phases it gates, as navigable chips; adding one writes the predecessor condition onto that successor — single source of truth).
- **Subject** — **Contains** (subject chips) and **Has traits** (trait chips) multi-pickers.
- **Capability** — **two-pane**. Left = an **indented read-from tree**: the capability at the root, its direct inputs nested below, and any sub-capability expanded **read-only** down to its own traits (the full rollup). Each row shows kind + share% (direct) or `raises/lowers · w{n}` (nested); rows are selectable. A grouped "+ add input" select (Traits / Capabilities) with cycle protection. Right = **inspector for the selected node**: root → name/domain/description + rollup stats + Used in / Aggregated by + drop; direct input → Open, Direction (raises/lowers), Weight slider (1–5) + normalized **share %** + bar, and for **trait inputs** a **"Scale here"** override (toggle → editable lower/upper bound + normal range, seeded from the trait, with a band+baseline preview; overridden rows get a **SCALE** badge); nested input → read-only direction/weight + "Open" / "Edit in {owner}".
- **Intervention** — **single column**. The merged **Predicted effect** editor: one or more *changes*, each = trait select, direction (up/down), a 5-stop **magnitude** picker, a **Magnitude-Prior** Gaussian SVG (±2σ band), confidence slider, and a collapsible "exact values & evidence" group (exact effect, single/range distribution + spread, horizon weeks, confidence, basis, evidence rows). Then **Needs** (resource chips), **Actions** (an ordered **action chain** — each link: action, "fires" when [start/complete/on-change/scheduled], optional measure/every; reorder/remove; a **fail-fast** toggle when >1), and a cost line. Relationships + drop fold in at the bottom.
- **Action** — type segmented (Webhook/Integration/Script), endpoint/target, method (webhook only), auth secret, payload key/value rows, on-failure (don't retry / retry ×3 / alert). Right meta panel shows visibility + "Linked by" + drop.

### 5. Betrieb (`Betrieb.dc.html`) — operating dashboard
Reads as an instance of a running System: a Story-Ticket queue (same node ids), claim chips, an observe feed, and a prominent gate-decide. *(Not modified in the recent design pass — treat existing file as the reference.)*

### 6. Reproduzierbarkeit (`Reproduzierbarkeit.dc.html`) — results
Run manifest + predicted-vs-observed ±2σ bands. *(Reference as-is.)*

---

## Interactions & Behavior
- **Navigation is in-app** through the Studio shell — surfaces mount/unmount, no page reloads; selection/scroll state is local to each surface (in production, lift to router + store as needed).
- **Editing is live**: every field writes back to the in-memory item on change; derived chips/relationships/labels recompute immediately.
- **Capability tree**: clicking a row selects it (accent border + glow + `--bg-3`); the inspector swaps to that node. Adding an input selects the new node; removing selects the root. Cross-jump via "Edit in {owner}" / "Open".
- **Phase Blocked-by/Blocks** mirror each other through one stored predecessor condition.
- **Hover**: background lifts one step, border lifts one line step (120ms). **Focus**: 3px `--accent-soft` glow ring + `--accent-rim` border. **Press**: `scale(0.98)`. **Disabled**: 40% opacity.
- **Gate state dots / attention dots** pulse 1.6s ease-in-out (100%→40%).
- No fade-and-slide; entrances are `scale(0.96)→1` + fade over ~200ms. Drawer (catalog, now removed) used a 0.22s slide-in.

## State Management
- One catalog object (8 arrays). Editors hold: a deep-cloned `data`, plus `vis` (visibility overrides), `removed` (dropped ids), and view-local selection (`selectedId` in Editor, `selInput` in capability ItemEditor) and `exactOpen` (per-change expand flags).
- Mutations are immutable updates (map/filter/concat) committed via `setState`. Tree ops in the Editor: add child/gate, indent/outdent (reparent), move up/down, delete, with locate/clone helpers.
- In production: replace the cloned-catalog pattern with your store + persistence; keep the derived-relationship functions pure.

## Design Tokens
Source: `de-braighter .../colors_and_type.css`. Set `data-skin="exercir"` on a wrapper (or `<html>`). Dark theme.

**Surfaces** — `--bg-0 #050608` (void) · `--bg-1 #0a0d14` (app frame) · `--bg-2 #0f1320` (card) · `--bg-3 #161b2c` (raised/hover) · `--bg-inset #04050a` (sunken/inputs).
**Hairlines** — `--line-1 rgba(148,163,210,.08)` · `--line-2 …14` · `--line-3 …22`.
**Foreground** — `--fg-1 #e8ecf7` · `--fg-2 #a4adc8` · `--fg-3 #6b7390` · `--fg-4 #3d4360` · `--fg-on-glow #04060d`.
**Status** — ok `#22d39a` / `rgba(34,211,154,.12)` · warn `#f5b544` / `…(.12)` · err `#ff5d6c` / `…(.12)` · info `#6dd2ff` / `…(.12)`.
**Accent (exercir)** — `--accent #6dd2ff` · `--accent-strong #38bdf8` · `--accent-deep #0ea5e9` · `--accent-soft rgba(109,210,255,.16)` · `--accent-rim rgba(109,210,255,.45)`. Buttons fill `linear-gradient(180deg, --accent-strong, --accent-deep)` with `--fg-on-glow` text.
**Glow** — `--glow: 0 0 24px rgba(109,210,255,.45), 0 0 80px rgba(56,189,248,.18)` · `--glow-soft: 0 0 12px rgba(109,210,255,.30)`.
**Glass** — background `linear-gradient(180deg, rgba(22,27,44,.72), rgba(15,19,32,.62))` + `backdrop-filter: saturate(140%) blur(18px)` + `--rim` inner shadow.
**Type** — display `"Space Grotesk"` 600 · body `"Inter"` 400/500/600 · mono `"JetBrains Mono"` (ids, overlines, ticks). Overlines: mono, ~9–10px, `text-transform:uppercase`, `letter-spacing:.1–.14em`, `--fg-4`. (Note: the live files reference `--font-display` / `--font-body` / `--font-mono`.)
**Type scale** — overline 11 / meta 12 / body-sm 13 / body 15 / body-lg 17 / h4 20 / h3 24 / h2 32 / h1 44 / display 64. `--tracking-tight -0.02em`, `--tracking-caps .14em`.
**Spacing** — 4px base: `--s-1…20` = 4,8,12,16,20,24,32,40,48,64,80.
**Radii** — `--r-1 4` · `--r-2 8` · `--r-3 12` · `--r-4 16` · `--r-5 24` · `--r-pill 999`.
**Shadows** — `--shadow-1 0 1px 2px rgba(0,0,0,.4)` … `--shadow-4 0 24px 80px rgba(0,0,0,.7)` (+ inner rim). `--rim: inset 0 1px 0 rgba(255,255,255,.06), inset 0 0 0 1px rgba(148,163,210,.08)`.
**Motion** — `--ease-out cubic-bezier(.22,1,.36,1)` · `--ease-in-out cubic-bezier(.65,0,.35,1)`. Durations 120 / 200 / 320 / 520ms.

## Assets
- **Fonts**: Space Grotesk, Inter, JetBrains Mono (Google Fonts; loaded via `@import` in `colors_and_type.css`). Use your codebase's font pipeline.
- **Icons**: inline Lucide-style SVGs (`viewBox 0 0 24 24`, `stroke="currentColor"`, 1.6–2px). No icon files shipped — map to your Lucide set (server, target, gauge, zap, package, webhook, clock, layers, users, lock, globe, etc.).
- **Imagery**: none. Glow + glass only.
- The bell-curve / prior / scale visualizations are hand-built inline SVG/divs — reproduce with your charting or plain SVG.

## Files (in this bundle)
- `Studio.dc.html` — shell + in-app routing.
- `Catalog.dc.html` — item library (8 types), cards, search, visibility filter, routing, "New".
- `Editor.dc.html` — Systems plan-tree editor (graph + node inspector).
- `ItemEditor.dc.html` — shared full-page editor for the 7 non-system types (this is where most recent work lives: trait scale + measurement, capability read-from tree + inspector + per-trait scale override, phase conditions, intervention predicted-effect, action call config).
- `Betrieb.dc.html`, `Reproduzierbarkeit.dc.html` — operate + results surfaces (reference as-is).
- `support.js` — the prototype runtime. **Reference only; do not port.**
- `colors_and_type.css` — the design tokens (copied from the de Braighter design system). Lift token values from here.

> To run a reference file as-is, it expects `colors_and_type.css` at the design-system path and `support.js` alongside. Treat these as visual references; the README + the logic classes are the spec.
