---
name: reactive-forms-cva-governance
description: Enforce reactive forms and reusable ControlValueAccessor components for all form controls.
tags: [governance, angular]
---

# Reactive Forms & CVA Governance

## What this skill does

Audits and enforces that every form in the codebase uses Angular Reactive Forms with reusable ControlValueAccessor (CVA) components. Detects anti-patterns, missing CVA wrappers, and non-compliant form construction. Also validates that recognized architectural strengths are preserved and not degraded.

## Scan scope

When invoked, scan the target file(s) or diff for:

1. **Template-driven violations** — any `ngModel`, `[(ngModel)]`, or `FormsModule`-only usage in form contexts
2. **Inline form controls** — raw `<input>`, `<select>`, `<textarea>` elements not wrapped in a CVA component
3. **Missing CVA provider** — components that act as form controls but lack `NG_VALUE_ACCESSOR` provider
4. **Form builder violations** — forms built inline instead of via exported `for[EntityName]` factory functions
5. **CVA contract violations** — CVA components that break the base contract (missing `writeValue`, `registerOnChange`, `registerOnTouched`)
6. **ViewMode violations** — form components that don't accept or propagate `viewMode` (READ/EDIT/CREATE)
7. **Error display violations** — form controls missing `app-invalid-marker` or equivalent error feedback
8. **i18n violations** — hardcoded labels, missing Transloco keys, wrong translation module usage
9. **Pattern degradation** — changes that break recognized architectural strengths (see Recognized Patterns)

---

## Recognized Patterns (preserve and enforce)

These are proven architectural strengths in the codebase. Any change that degrades them is a violation.

### P1 — Reusable CVA component library
The project maintains a library of 21+ form input CVA components in `src/core/component/form/`. Every form input is a self-contained, testable, translatable, viewMode-aware widget. New form controls must always be added to this library rather than inlined in feature templates. Never bypass the library with one-off inputs.

### P2 — Consistent feature structure
Every feature follows the same directory pattern:
```
feature/{name}/
├── search/{name}-search.component.ts
├── form/{name}-form.component.ts
├── form/head-data/{name}-form-head-*.component.ts
├── actions-menu/{name}-actions-menu.component.ts
└── shared/component/
```
New features must follow this structure. Form components live under `form/`, search under `search/`.

### P3 — Form factory functions (`for[EntityName]`)
Form shape is decoupled from components via exported factory functions in co-located `.lib.ts` files. The factory accepts an optional entity for pre-population and returns a typed `FormGroup`. This pattern must not be replaced with inline `FormBuilder.group()` calls.

### P4 — ViewMode tri-state (READ / EDIT / CREATE)
One component tree renders three different experiences controlled by `ViewMode`. Guards and resolvers wire this from route data. Every form component and CVA child must honor `viewMode` — rendering read-only display in READ, editable form in EDIT/CREATE.

### P5 — Centralized validation UX
All form controls use `<app-invalid-marker>` with `NgbPopover` for localized error messages. This gives users a consistent validation experience everywhere. Never use custom inline error rendering in feature templates.

### P6 — Full i18n coverage (Transloco)
Every user-facing label uses a Transloco translation key — no hardcoded strings. CVA components accept `labelKey` and render via the `transloco` pipe or structural directive. Read-only placeholders use `'common.labels.no-value'`.

### P7 — Generic REST layer integration
Forms persist via `DefaultRestService` with type-to-endpoint mapping. `BaseHeadDataFormComponentGroupComponent` handles create/update lifecycle with `prePersist`/`postPersist` hooks. Feature forms must use this lifecycle — not raw `HttpClient` calls.

### P8 — Signal-based state via DataStateService
Form containers read entity data from `DataStateService.item<T>(type)` signals. Parent forms call `setItem` on changes, children react via `effect()`. Forms must not introduce alternative state management patterns (local subjects, manual subscriptions for state).

---

## Rules

### R1 — No template-driven forms
- `FormsModule` must NEVER be imported for form binding (only allowed for `NgbTypeahead` or third-party lib requirements)
- `ngModel` and `[(ngModel)]` are banned in form contexts
- All forms must bind via `[formGroup]` and `formControlName`

### R2 — Every form input must be a CVA component
- Raw `<input>`, `<select>`, `<textarea>` elements must NOT appear directly in feature templates
- Each must be wrapped in a reusable CVA component (e.g., `app-text-input`, `app-select`, `app-date-input`)
- Exception: inputs inside a CVA component's own template are allowed
- New CVA components must be added to `src/core/component/form/` (see P1)

### R3 — CVA components must extend BaseValueAccessorComponent
- All CVA components must extend `BaseValueAccessorComponent<T>` from `src/core/component/form/`
- Must register `NG_VALUE_ACCESSOR` provider with `forwardRef`
- Must be standalone components
- Must accept `@Input() formControlName`, `@Input() viewMode`, `@Input() labelKey`, `@Input() required`

### R4 — CVA template contract
Every CVA component template must:
- Render a translated label via Transloco (`{{ labelKey | transloco }}` or `*transloco` structural directive)
- Show required indicator when `required === true`
- Conditionally render edit vs read mode based on `viewMode`
- Include `<app-invalid-marker [errors]="errors">` for validation feedback (see P5)
- Call `onTouch()` on blur of the input element
- Bind the input via `[formControlName]="formControlName"`

### R5 — Form factory functions
- Forms must be built via exported factory functions named `for[EntityName]` (see P3)
- Factory lives in a co-located `.lib.ts` file (e.g., `newspaper-form.lib.ts`)
- Factory accepts an optional entity `(item?: T)` and returns a typed `FormGroup`
- Validators are applied inline in the factory: `new FormControl(value, [Validators.required])`
- Components must NOT use `FormBuilder.group()` for top-level forms (only for internal sub-forms in composite CVA components)

### R6 — ViewMode propagation
- Every form container must pass `[viewMode]` to all CVA children (see P4)
- CVA components must render read-only display in `ViewMode.READ`
- Read-only display shows the current value or a `'common.labels.no-value'` placeholder

### R7 — Form actions via FormActionsComponent
- All editable forms must include `<app-form-actions>` bound to `[dirty]`, `[valid]`, `[viewMode]`
- Form actions emit `(persist)` and `(reset)` — parent handles logic
- No inline submit buttons outside of `app-form-actions`

### R8 — Composite CVA components
When a single form control represents a composite value (e.g., Location = zip + city + canton):
- Create an internal `FormGroup` via `FormBuilder` inside the CVA component
- Sync the internal form to the outer `ControlValueAccessor` value
- Present sub-fields as individual inputs within the CVA template

### R9 — Specialized select wrappers
Domain-specific selects (e.g., canton, language, publisher) must:
- Extend `BaseValueAccessorComponent<T>` or wrap `<app-select>`
- Pre-configure options from constants, enums, or route resolver data
- Provide a custom `LabelProvider` for display formatting

### R10 — i18n via Transloco only
- All user-facing text must use Transloco translation keys (see P6)
- Import `TranslocoDirective` (preferred) or `TranslocoPipe` — never `TranslateModule` from `ngx-translate`
- Labels: `{{ labelKey | transloco }}` or `<ng-container *transloco="let t">{{ t(labelKey) }}</ng-container>`
- No hardcoded user-facing strings in templates or component classes
- Translation keys must follow the existing namespace pattern: `{feature}.labels.{field}`

### R11 — Form lifecycle via base classes
- Feature form pages must extend `BaseFormComponent<T>` (see P7)
- Form data sections must extend `BaseHeadDataFormComponentGroupComponent<T>`
- Entity persistence must use the `persist()` lifecycle with `prePersist`/`postPersist` hooks
- State must be read from `DataStateService` signals, not manual HTTP subscriptions (see P8)

---

## Severity levels

| Severity | Description |
|----------|-------------|
| **error** | Template-driven binding in form context, raw input in feature template, missing NG_VALUE_ACCESSOR, hardcoded user-facing string, `ngx-translate` usage |
| **warning** | Missing viewMode propagation, missing error marker, inline form construction, bypassing base class lifecycle, alternative state management |
| **info** | Missing required indicator, form actions not used, feature structure deviation |

## Output contract

Return sections in this order:

1. **Violations table** — file, line, rule, severity, description
2. **Compliance score** — 0-100 based on weighted violations (error=10, warning=3, info=1, score = max(0, 100 - sum))
3. **Pattern health** — which recognized patterns (P1-P8) are upheld vs degraded by the scanned code
4. **Missing CVA components** — list of raw inputs that need CVA wrappers, with suggested component names
5. **Form factory audit** — forms not using factory pattern, with suggested factory signature
6. **Remediation plan** — ordered steps to fix all violations, prioritized by severity

## Scaffolding

When asked to create a new form or CVA component, use the templates in `templates/`:
- `cva-template.md` — for new CVA components
- `form-builder-template.md` — for new form factory functions
- `feature-form-template.md` — for new feature form pages (container + head-data)
