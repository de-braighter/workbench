# Studio Node-Detail Inspector — Design

- **Date:** 2026-06-29
- **Status:** Draft for founder review
- **Scope:** `domains/foundry` (catalog mapper) + `domains/studio` (metamodel + editor-model + system-editor inspector)
- **Builds on:** the studio-catalog-substrate-adapter (foundry#76 `/api/catalog`) + the nested-`SystemItem.root` enhancement (foundry#77). Studio renders the foundry SDLC tree; this surfaces each node's metadata when selected.
- **Constraints:** ZERO kernel change · ZERO design-system change · read-only · ADR-176-aligned (the `meta` bag is the deliberate metadata-extension space, mirroring the kernel's `metadata` JSONB)

## 1. Purpose

When a node is selected in the studio system-editor, the inspector ("Knoten-Inspektor") currently shows only `{kind} · {id}` + an editable title (and, for studio-authored work nodes that carry an `effect`, the predicted-effect editor). For a **foundry-sourced** node it shows essentially nothing beyond kind/id/title, because:

1. the foundry catalog mapper passes only `{ id, kind, title, children }` onto each `SystemNode` — the kernel node's rich `metadata` (`status`, `scope`, `yields`, `dependsOn`, `itemId`, `resource`, `riskTier`, …) is dropped; and
2. foundry work-items carry no authored `effect`, so the existing effect editor never renders.

**Goal:** surface **all available foundry node metadata, read-only**, in a "Details" section of the inspector, so selecting a node tells you what it is, whether it's done, where it lives, what it produces, and what it depends on.

## 2. Decisions

- **D1 — What to show: all available metadata, read-only.** Render every metadata field the node carries (status, scope, yields, dependsOn, itemId, resource, riskTier, repo, …), plus the structural parent/kind/children. No editing/write-back (foundry is the source of truth; the studio's catalog `save()` is already a no-op).
- **D2 — Data source: generic `meta` passthrough (Approach A).** Carry the kernel node's metadata across to the studio on each `SystemNode` as an optional `meta` bag; the inspector renders it. Rejected alternatives: (B) studio reads `/api/plan-tree` by id — couples the generic inspector to a foundry-specific async fetch, foundry-only; (C) typed `status?/scope?/…` fields on `SystemNode` — pollutes the generic studio metamodel with foundry vocabulary, brittle.
- **D3 — Namespaced under `sourceMeta` after projection.** The editor projects `SystemNode` → kernel `BuildPathDraft` (PlanNodes) once via `projectSystemToDraft`; `authoringFields` assigns a **synthetic `scope`** (`work/{id}/`) to every work node for the "In Foundry ausführen" actuator. The foundry source metadata therefore rides a **separate namespaced key `sourceMeta`** on the projected PlanNode — never spread into raw keys — so it can't collide with the build-path operational fields (`scope`, `dependsOn`, `effort`).
- **D4 — Generic, inert where absent.** `SystemNode.meta` is optional; studio-authored systems don't set it, so the Details section is empty/absent for them. The feature is generic, not foundry-special-cased in the studio metamodel.
- **D5 — Hide internal/redundant keys.** Drop `title` (already the heading) and `_`-prefixed internal keys (`_cascadeKey`) at the mapper boundary.

## 3. Architecture & data flow

```
foundry catalog-mapper          studio metamodel        studio editor-model            studio inspector
─────────────────────           ────────────────        ──────────────────            ────────────────
buildSystemNode() attaches  →   SystemNode gains    →   projectSystemToDraft()    →   selectedDetail()
cleaned node.metadata as        meta?: Record<          authoringFields() copies      reads sourceMeta off the
n.meta on each SystemNode       string,unknown>         sn.meta → PlanNode             selected PlanNode + parent
                                                        metadata['sourceMeta']        title; renders read-only
```

### Layer 1 — foundry `catalog-mapper.ts`

`buildSystemNode(node, childrenByParent)` already runs over every node. Add a cleaned `meta` to the produced `SystemNode`:

```ts
function cleanMeta(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'title' || k.startsWith('_')) continue; // already the title / internal
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
// in buildSystemNode:
return { id: node.id, kind, title, children: [...], ...(meta ? { meta } : {}) };
```

The local `SystemNode` twin in `catalog-mapper.ts` gains `meta?: Record<string, unknown>`.

### Layer 2 — studio `item-shapes.ts`

`SystemNode` gains one optional field:

```ts
export interface SystemNode {
  id: string;
  kind: SystemNodeKind;
  title: string;
  children: SystemNode[];
  effect?: SystemEffect;
  actions?: string[];
  needs?: string[];
  conds?: SystemGateCond[];
  /** Read-only source metadata (e.g. the foundry kernel node's metadata),
   *  surfaced in the inspector Details section. Absent for studio-authored nodes. */
  meta?: Record<string, unknown>;
}
```

### Layer 3 — studio `editor-model.ts`

In `authoringFields(systemNode, isRoot)`, after the existing fields, carry the source metadata under the namespaced key:

```ts
const SOURCE_META = 'sourceMeta';
// …
if (systemNode.meta && Object.keys(systemNode.meta).length > 0) {
  fields[SOURCE_META] = { ...systemNode.meta };
}
```

Add a defensive reader (pure, never throws):

```ts
export function readSourceMeta(node: PlanNode): Record<string, unknown> | undefined {
  const v = node.metadata[SOURCE_META];
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
```

### Layer 4 — studio `system-editor.page.ts`

A `selectedDetail()` computed mirrors the existing `effect()`: it locates the selected draft node (by `selectedId()`), reads `readSourceMeta(node)`, and resolves the parent title from the draft. The template renders a read-only "Details" section below the title header (and before the effect editor for the rare node that has both).

## 4. Rendering (the Details section)

```
DETAILS
Status      ● done                       dot: done→green, else neutral
Scope       de-braighter/foundry
            src/wt-pool.ts               repo line + pathPrefix under
Item        foundry/slice3-1
Resource    ai
Yields      pack: slot-lease-primitive   one row per {kind,id}
DependsOn   —                            or a list of ids
Parent      Warm pool                    structural, from the draft
```

- **Known-field renderers** for the recognised shapes: `status` (dot + label), `scope` (`{repo, pathPrefix}` → repo line + path line), `yields` (`[{kind,id}]` → `kind: id` rows), `dependsOn` (`string[]` → comma list or `—`). Scalar fields (`itemId`, `resource`, `riskTier`, `repo`, `productKey`, …) render as `Label: value`.
- **Generic fallback:** any other scalar key renders `key: value`; any unrecognised object/array renders as compact JSON (shown, not dropped — "all available" holds as foundry evolves).
- **Always-available structural facts** (Kind / Parent / Children count) render for every node, so sparse nodes (capabilities/features with only a title) are never an empty panel.
- **`status` is the stored seed, not live state.** The `status` field in a foundry node's metadata is the bootstrap seed value baked into `FOUNDRY_PRODUCT` (per its own header comment, the live status is derived from the canonical event log via `fold()`, not the plan node). The Details section shows the node's metadata **as stored** — honest for a "show this node's metadata" feature. Joining live delivery status (from `/api/snapshot`, keyed by `itemId`) is a deliberate future enhancement, out of scope here.
- **Read-only.** No inputs in this section. The existing editable title input is unchanged.
- **A11y:** the section is a labelled group; key/value pairs use a description-list semantic (`dl`/`dt`/`dd` or equivalent ARIA) so a screen reader reads "Status: done". The status dot is decorative (`aria-hidden`); the label text carries meaning. No new design tokens — reuse existing `--ink-*`, `--rule`, `--accent`, `--color-*` and the `glass-panel` utility.

## 5. Touch points & isolation

| Repo | File | Change |
|---|---|---|
| foundry | `src/dashboard/catalog-mapper.ts` | `cleanMeta` + attach `meta` on `SystemNode`; local twin gains `meta?` |
| foundry | `src/dashboard/catalog-mapper.spec.ts` | meta attached + `title`/`_cascadeKey` dropped + absent-when-empty |
| studio | `apps/studio-ui/src/app/metamodel/item-shapes.ts` | `SystemNode.meta?` |
| studio | `apps/studio-ui/src/app/system-editor/editor-model.ts` | `authoringFields` carries `sourceMeta`; `readSourceMeta` reader |
| studio | `apps/studio-ui/src/app/system-editor/editor-model.spec.ts` | projection preserves `sourceMeta`; reader is defensive |
| studio | `apps/studio-ui/src/app/system-editor/system-editor.page.ts` | `selectedDetail()` + Details template section |
| studio | `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts` | renders known fields + generic fallback + sparse fallback + hides internal keys |

Each unit stays single-purpose: the mapper cleans+attaches; the metamodel declares the optional field; the projection namespaces it; the inspector reads+renders. Each is testable independently.

## 6. Testing

- **Mapper:** a node with `metadata: { title, _cascadeKey, status, scope, yields }` → `SystemNode.meta` has `status/scope/yields`, omits `title`/`_cascadeKey`; a node with only `title` → `meta` is `undefined`.
- **Projection:** `projectSystemToDraft` on a `SystemItem` whose `root` carries `meta` → the projected PlanNode's `metadata.sourceMeta` deep-equals the source `meta`, and the synthetic `scope` is still assigned independently (no collision). `readSourceMeta` returns `undefined` for a malformed/absent shape.
- **Inspector:** with a selected node carrying `sourceMeta`, the Details section renders status/scope/yields/dependsOn/itemId; a node with only structural facts renders Kind/Parent/Children; internal keys never appear; an unknown object value renders as JSON, not dropped.

## 7. Out of scope (YAGNI)

- Editing or write-back of any metadata field.
- Surfacing details in the flat `/plan-tree` panel (it has no node selection).
- Per-field deep-linking (clicking a repo/path to open it).
- Localising every metadata key label (keys render verbatim; only the section heading + known-field labels are localised, consistent with the de-CH chrome).

## 8. Process

Two-repo execution via subagent-driven-development, same as the prior slices: foundry PR (mapper) → review/wave/merge/ritual, then studio PR (metamodel + editor-model + inspector) → review/wave/merge/ritual. Browser re-verify at the end (select a foundry work-item, confirm the Details section renders its metadata).
