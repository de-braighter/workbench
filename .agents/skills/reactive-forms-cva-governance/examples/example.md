---
description: Run reactive-forms-cva-governance to audit forms, scaffold CVA components, or generate feature form pages.
---

## Example 1 — Audit an existing feature form

**Prompt**: Use `/reactive-forms-cva-governance` on the newspaper-order form.

**Expected behavior**:
1. Scan `src/feature/newspaper-order/form/` for all templates and TypeScript files
2. Check every `<input>`, `<select>`, `<textarea>` is wrapped in a CVA component (R2)
3. Verify form is built via `forNewspaperOrder` factory in a `.lib.ts` file (R5, P3)
4. Verify `viewMode` is passed to all CVA children (R6, P4)
5. Verify `app-invalid-marker` is present on all CVA components (R4, P5)
6. Verify all labels use Transloco — no hardcoded strings or `ngx-translate` usage (R10, P6)
7. Check pattern health against P1-P8
8. Return the full output contract: violations table, compliance score, pattern health, missing CVAs, factory audit, remediation plan

---

## Example 2 — Detect i18n violations

**Prompt**: Use `/reactive-forms-cva-governance` to audit i18n compliance in the military-unit form.

**Expected behavior**:
1. Scan all templates under `src/feature/military-unit/form/`
2. Flag any hardcoded user-facing strings (R10)
3. Flag any `TranslateModule` or `| translate` pipe usage — must use `TranslocoDirective` or `| transloco` (R10)
4. Verify label keys follow `{feature}.labels.{field}` namespace pattern
5. Verify read-only placeholders use `'common.labels.no-value'`
6. Return violations table with file, line, and suggested Transloco replacement

---

## Example 3 — Scaffold a new CVA component

**Prompt**: Use `/reactive-forms-cva-governance` to create a new `app-currency-input` CVA component.

**Expected behavior**:
1. Use the `templates/cva-template.md` scaffold
2. Generate files in `src/core/component/form/currency-input/`:
   - `currency-input.component.ts` extending `BaseValueAccessorComponent<number>`
   - `currency-input.component.html` with Transloco label, error marker, read/edit modes
   - `currency-input.component.spec.ts` with CVA contract tests using `getTranslocoModule()`
3. Register `NG_VALUE_ACCESSOR` provider with `forwardRef`
4. Template uses `TranslocoDirective` (not `TranslateModule`)

---

## Example 4 — Scaffold a new form factory

**Prompt**: Use `/reactive-forms-cva-governance` to create a form factory for `Invoice`.

**Expected behavior**:
1. Use the `templates/form-builder-template.md` scaffold
2. Generate `invoice-form.lib.ts` with `forInvoice(invoice?: Invoice)` factory
3. Return a typed `FormGroup` with `FormControl` instances and inline validators
4. No `FormBuilder.group()` — uses `new FormGroup` / `new FormControl` directly

---

## Example 5 — Scaffold a complete feature form

**Prompt**: Use `/reactive-forms-cva-governance` to scaffold a complete form for `Delivery`.

**Expected behavior**:
1. Use the `templates/feature-form-template.md` scaffold
2. Create full directory structure under `src/feature/delivery/`:
   - `form/delivery-form.component.ts` extending `BaseFormComponent<Delivery>`
   - `form/head-data/delivery-form-head-component-group.component.ts` extending `BaseHeadDataFormComponentGroupComponent<Delivery>`
   - `form/delivery-form.lib.ts` with `forDelivery()` factory
   - Templates using Transloco, CVA components, and `app-form-actions`
3. Follow the consistent feature structure pattern (P2)
4. Wire form lifecycle via base classes (R11, P7)
5. Use DataStateService signals for state (P8)

---

## Example 6 — Check pattern health on a diff

**Prompt**: Use `/reactive-forms-cva-governance` on this diff.

**Expected behavior**:
1. Analyze the diff for any changes that degrade recognized patterns (P1-P8)
2. Flag if a raw `<input>` was added to a feature template (degrades P1)
3. Flag if `FormBuilder.group()` was used instead of a factory function (degrades P3)
4. Flag if `TranslateModule` was imported instead of Transloco (degrades P6)
5. Flag if a form bypasses `BaseHeadDataFormComponentGroupComponent` (degrades P7)
6. Return pattern health section showing which patterns are upheld vs degraded
