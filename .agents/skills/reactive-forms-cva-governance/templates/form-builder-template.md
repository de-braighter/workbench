# Form Factory Template

Use this template when creating a new form builder factory function.
Place the generated file next to the form component that uses it.

## Factory Function (`{entity-kebab}-form.lib.ts`)

```typescript
import {FormControl, FormGroup, Validators} from '@angular/forms';
import {{EntityName}} from '{path-to-model}';

/**
 * Factory function that builds a typed FormGroup for {EntityName}.
 * @param item Optional entity instance for pre-population (edit/read mode).
 *             When undefined, creates an empty form (create mode).
 * @returns FormGroup with typed controls matching the {EntityName} model.
 */
export const for{EntityName} = (item?: {EntityName}): FormGroup => {
    return new FormGroup({
        id: new FormControl(item?.id),
        // Required fields — add Validators.required
        // name: new FormControl(item?.name, [Validators.required]),

        // Optional fields — no validators
        // description: new FormControl(item?.description),

        // Numeric fields
        // quantity: new FormControl(item?.quantity, [Validators.required, Validators.min(0)]),

        // Boolean fields
        // active: new FormControl(item?.active ?? true),

        // Nested object fields — use a nested FormGroup
        // address: new FormGroup({
        //     street: new FormControl(item?.address?.street),
        //     zip: new FormControl(item?.address?.zip),
        //     city: new FormControl(item?.address?.city),
        // }),

        // Collection fields — use FormArray
        // items: new FormArray(
        //     (item?.items ?? []).map(i => new FormGroup({
        //         label: new FormControl(i.label, [Validators.required]),
        //         value: new FormControl(i.value),
        //     }))
        // ),
    });
};
```

## Search Factory Function (`{entity-kebab}-search-form.lib.ts`)

```typescript
import {FormControl, FormGroup} from '@angular/forms';

/**
 * Factory function that builds a search FormGroup for {EntityName}.
 * Search forms never require validators — all fields are optional filters.
 */
export const for{EntityName}Search = (): FormGroup => {
    return new FormGroup({
        searchTerm: new FormControl(null),
        // Add domain-specific search filters:
        // status: new FormControl(null),
        // dateFrom: new FormControl(null),
        // dateTo: new FormControl(null),
    });
};
```

## Usage in HeadData Component

```typescript
// In the component that extends BaseHeadDataFormComponentGroupComponent:
export class {EntityName}FormHeadComponentGroupComponent
    extends BaseHeadDataFormComponentGroupComponent<{EntityName}> {

    // Wire the factory function as the form builder
    protected override formGroupBuilder = for{EntityName};
    protected override basePath = '{feature-route-path}';

    constructor() {
        super();
        this.type = {EntityName};
    }
}
```

## Rules

- **Naming**: `for{EntityName}` for entity forms, `for{EntityName}Search` for search forms
- **Location**: Co-located `.lib.ts` file next to the form component
- **No FormBuilder**: Use `new FormGroup` / `new FormControl` directly (not `fb.group()`)
- **Validators inline**: Apply validators in the `FormControl` constructor, never in the template
- **Optional entity**: Factory always accepts `(item?: T)` for create vs edit mode
- **Default values**: Use nullish coalescing `item?.field ?? defaultValue` for defaults
- **Typed controls**: Each `FormControl` generic type should match the model property type
