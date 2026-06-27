# Session prompt — kids-football MVP slice 4 (drill library + editor + pitch sketcher)

> Paste into a fresh session launched from `de-braighter/`.

---

Continue the exercir kids-football-club MVP — build slice 4 (drill library + editor +
pitch sketcher) via subagent-driven-development.

Context (read in this order):
- Memory exercir-kids-football-mvp-arc — slices 1–3 shipped state (ex#240, ex#244,
  ex#249), the slice-3 mechanism catalog (MutableStubTenantRegistry on the forRoot
  seam; @Public + undecorated = pre-auth recipe; demo_mode anchor FIRED), and the
  battle-tested gotcha catalog (browser-run-through blind spots; orphan :3150 holder;
  NEVER pipe a background `nx serve` through `head -N` — SIGPIPE kills it; @Public
  endpoints need zod upper bounds; `.max().default([])` chain order; interface growth
  fans out to sibling spec literals). Read FIRST.
- Memory exercir-board-runtime-arc — the domain-free board engine (exercir#214): ONE
  engine + rich board + portable persistence port. THIS is the reuse candidate for the
  sketcher (design §7: "adapt, don't fork"). Read SECOND — design question 1 hinges
  on it.
- Memory drill-library-arc — the pack-football drill arc's form-a11y MUST-FIX patterns
  (24px targets, focus-mgmt-on-swap, enabled-submit, live count).
- Design spec: workbench docs/superpowers/specs/2026-06-11-exercir-kids-football-mvp-design.md
  (§8 slice ladder; slice 4 row: "drill CRUD, the SVG sketcher (reuse the board
  engine), the 'expected effect' card"; §5 the expected-effect seam — plain pack data,
  NO kernel promotion; §7 reuse pins).
- Handoff source of truth: domains/exercir/docs/design/exercir-mvp-handoff/README.md —
  screen 3 "Drill library (coach home)" (search 260px + focus-area chips + card grid
  minmax(280px,1fr) with mini sketch thumbnails + phase tag + meta + intensity dots) +
  screen 4 "Drill editor" (sketch-first layout: sticky header w/ inline display-font
  name input + Delete/Cancel/Save; left = sketcher; right 430px column: focus chips,
  phase + age selects, duration stepper 2–45′, players, equipment chips, intensity
  picker, organisation, coaching points rows, the EXPECTED-EFFECT highlighted card —
  bg color-mix(accent 14%, white), 1.5px accent border, "keep it visually distinct
  everywhere") + the sketcher interaction spec (SVG 860×560, tool rail: select/player/
  opp/cone/ball/pass/run/zone/erase + divider + undo 24-step + clear; click places,
  drag draws arrows/zones min-length 18, select-drag moves w/ 20px hit areas, 16px hit
  lines) + the prototype exercir/proto/drills.jsx + sketcher.jsx.

No slice-4 plan exists yet. Phase 1: write it with superpowers:writing-plans, mirroring
the slice-3 plan's shape (TDD tasks, design-decisions section, pre-flight reading list
pointing at the NOW-IN-REPO slice-3 reference files: the drill table + STARTER_DRILLS +
DrillSchema/sketch-element union in contracts, the seed-only DRILL_REPOSITORY
(createMany/list) + Prisma adapter, the FOR UPDATE RLS policy already in place, the
onboarding service as the seed consumer, the slot vertical as the full-CRUD exemplar,
the admin pages + kf-modal-focus + kf-i18n UI patterns). PR the plan to the workbench,
verifier-review it, merge, then Phase 2: execute.

THREE DESIGN QUESTIONS the plan must answer FIRST (resolve at plan time; if question 1
needs a real spec, do a designer-first pass before the plan PR):
1. Board-engine reuse for the sketcher. Design §7 pins "reuse the pack-football board
   engine — adapt, don't fork". Determine: where the engine actually lives after
   exercir#214 (pack-football lib? pack-ui-shared? — check ADR-099 visual-board shared
   SVG primitives), what it exposes (coordinate space, place/drag, undo history,
   renderers), and whether pack-kids-football-ui may LEGALLY import it under the nx
   scope-tag boundaries. Three outcomes: (a) import as-is, (b) extract the domain-free
   core to a shared lib first (its own task + possibly its own PR), (c) fork-minimal
   with a pinned justification. Pick by boundary legality + actual API fit against the
   sketcher interaction spec — NOT by enthusiasm for reuse. If (b), designer-first.
2. Stub-club drill seed. Slice 3 seeds drills ONLY via onboarding — the stub clubs
   (FC Sonnenberg/Stadtpark) have empty libraries, so the demo + browser run-through
   would start blank. Decide: bootstrap-seed STARTER_DRILLS for both stub clubs
   (mirroring seedDemoMembers/Teams/Resources, in-memory mode only) vs create-live in
   the run-through. Lean seed — the library is the coach HOME; it must demo populated.
3. Sketcher a11y posture (WCAG 2.5.7 dragging alternatives). Click-to-place covers the
   point tools; pass/run arrows + zones are DRAG-ONLY in the prototype. Decide + pin:
   a keyboard/click-click alternative (e.g. click-start/click-end), or a documented
   prototype exemption with the upgrade seam named. Budget the a11y task either way;
   tell the wave's qa-engineer what was decided.

Scope (in dependency order):
1. Drill permissions + manifest — drillRead/drillWrite in KF_PERMISSIONS + manifest
   (8→10 permissions; this BREAKS existing pack-manifest.spec assertions — update in
   the same red→green pass). Grants per the handoff nav table: coach + assistantCoach
   get drillRead+drillWrite (both have Drills nav + full planning), clubAdmin inherits
   via Object.values, teamManager/facilities get NEITHER (no Drills nav). Pin the
   rationale like slice 2 did for slotRead.
2. Drill vertical completion — update/delete on DrillRepository (port + in-memory +
   Prisma on the ONE contract suite; the FOR UPDATE RLS policy already exists from
   slice 3 — no migration needed; if any migration IS otherwise needed, fold in the
   #251 redundant-club-@@index drop), use-case services (list/create/update/delete,
   Result<T,E>, CreateDrillInputSchema = DrillSchema.omit({id}) + zod), HTTP controller
   + RBAC e2e (coach 2xx writes, teamManager 403, cross-club invisibility), stub-club
   demo seed per design question 2. Drill→template cascade is slice-5 territory —
   doc-comment the seam (the slice-2 convention). #245 posture extends to the new
   mutations (or wire F1 — same decision row as before, say so in the PR).
3. Sketch thumbnail renderer — a small read-only SVG component rendering drill.sketch
   scaled (library cards + editor preview share it). Pure, prop-driven, testable.
4. Pitch sketcher — per design question 1's outcome: 860×560 viewBox, green pitch +
   mowing stripes + white lines, tool rail, place/drag/move/erase, 24-step undo,
   clear; emits the contracts DrillSketchElement[] (the zod union from slice 3 IS the
   wire shape — no new types).
5. Drill library page (THE COACH HOME) + coach navigation — routed /drills under the
   shell; shell nav becomes role-gated (Drills for coach/assistantCoach/clubAdmin;
   Club stays admin-only); sign-in landing becomes role-dependent (coach → /drills,
   club-admin → /admin/members — the wizard's landing on /admin/slots stays); search +
   focus-area filter chips + card grid + thumbnails + intensity dots + "+ New drill".
6. Drill editor page — screen 4 layout, reactive forms + the a11y MUST-FIX set,
   expected-effect highlighted card (the product differentiator — visually distinct),
   Save disabled-until-named per handoff vs enabled-submit house pattern: follow
   enabled-submit (pinned deviation, same as slice 3), in-editor delete w/ confirm.
7. Gate + browser run-through — ci:local + test:db (proof set unchanged unless a
   migration lands); full run-through: coach Bruno sign-in → lands on a POPULATED
   drill library (8 starter drills, thumbnails rendering) → search + filter → open a
   drill → edit the sketch (place a player, draw a pass, undo) → save → thumbnail
   updates → new drill from scratch incl. expected effect → role regression (team
   manager sees NO Drills nav; 403 on direct write), club isolation, slice-3 wizard
   smoke (create a club → its library has the 8 starters). Screenshots: the library
   grid + the editor with a sketch → de-braighter/docs/club-grass-drill-{library,editor}-s4-proof.png.

Constraints: substrate ^2.0.0 surface as pinned (auth/tenant/RLS only — 2.1.0 is in
range but adopt NOTHING new; no kernel/inference; the expected-effect field stays plain
pack data per design §5); cut feat/kids-football-s4-drills off exercir origin/main in a
fresh worktree (domains/exercir-wt-kf-s4), npm ci; per-task two-stage review (spec then
quality); any workspace package.json change re-runs npm install + commits the lockfile;
gates = npm run ci:local + npm run test:db; verifier wave (local-ci + reviewer +
charter-checker + exercir-charter-checker + qa-engineer, wave prompts forbid git ops in
shared clones, PR head readable in the dedicated worktree; tell qa-engineer the design-
question-3 a11y decision) + twin ritual (drain → post-findings FULL de-braighter/
exercir#NN form, severities blocking|should-fix|nit|note, lines that exist in the diff
→ merge → backfill → reconcile → ritual:post-merge). PR carries Producer:/Effort: deep/
Effect: cycle-time+findings lines and Closes a story issue.

Carry-forwards to honor: exercir#245 (F1 event-log posture — drill update/delete are
NEW mutations; extend the doc-comment posture or wire it, and say which in the PR);
exercir#251 (S3 nits — fold ONLY what slice 4 naturally touches: the club @@index drop
if a migration happens, the GUC-const dedup if the drill adapter is being edited
anyway; the wizard extraction is NOT triggered — slice 4 doesn't touch the wizard);
en-only i18n (de/en split stays tracked); published skin canonical-not-loaded (ex#246
— no global skin load in the shared host); demo_mode anchor: slice 4 ships no outbound
path — nothing new fires, but the editor must NOT add one; subjectSensitivity
'developmental-minor' still does NOT fire (drills are authored coaching content, not
inferred player state) — it arms at slice 7/8, and per the #249 charter-checker note,
when it fires set PackManifest.subjectSensitivity so the ADR-187/188/189 gates engage.
