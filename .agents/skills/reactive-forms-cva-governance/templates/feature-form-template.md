# Feature Form Page Template

Use this template when scaffolding a complete feature form (container page + head-data section).
This enforces the consistent feature structure pattern (P2).

## Directory Structure

```
src/feature/{entity-kebab}/
├── form/
│   ├── {entity-kebab}-form.component.ts          ← Page container (extends BaseFormComponent)
│   ├── {entity-kebab}-form.component.html
│   ├── head-data/
│   │   ├── {entity-kebab}-form-head-component-group.component.ts   ← Form section (extends BaseHeadData)
│   │   └── {entity-kebab}-form-head-component-group.component.html
│   └── {entity-kebab}-form.lib.ts                ← Form factory function
├── search/
│   ├── {entity-kebab}-search.component.ts         ← Extends BaseSearchComponent
│   ├── {entity-kebab}-search.component.html
│   └── {entity-kebab}-search-form.lib.ts          ← Search form factory
├── actions-menu/
│   ├── {entity-kebab}-actions-menu.component.ts   ← Extends BaseActionsMenuComponent
│   └── {entity-kebab}-actions-menu.component.html
└── shared/component/                              ← Feature-specific selects, typeaheads
```

## Page Container (`{entity-kebab}-form.component.ts`)

```typescript
import {Component} from '@angular/core';
import {TranslocoDirective} from '@jsverse/transloco';
import {BaseFormComponent} from '../../../../core/component/form/base-form.component';
import {{EntityName}} from '../../../../core/model/domain/{entity-kebab}.model';
import {{EntityName}FormHeadComponentGroupComponent} from './head-data/{entity-kebab}-form-head-component-group.component';
import {{EntityName}ActionsMenuComponent} from '../actions-menu/{entity-kebab}-actions-menu.component';

@Component({
    selector: 'app-{entity-kebab}-form',
    standalone: true,
    imports: [
        TranslocoDirective,
        {EntityName}FormHeadComponentGroupComponent,
        {EntityName}ActionsMenuComponent,
    ],
    templateUrl: './{entity-kebab}-form.component.html',
})
export class {EntityName}FormComponent extends BaseFormComponent<{EntityName}> {
    constructor() {
        super();
        this.type = {EntityName};
    }
}
```

## Page Container Template (`{entity-kebab}-form.component.html`)

```html
<ng-container *transloco="let t">
    <div class="container-fluid">
        <div class="row">
            <div class="col-12">
                <h2>{{ t(titleKey) }}</h2>
            </div>
        </div>

        <app-{entity-kebab}-actions-menu
            [viewMode]="viewMode">
        </app-{entity-kebab}-actions-menu>

        <app-{entity-kebab}-form-head-component-group
            [viewMode]="viewMode"
            (createSuccess)="onCreateSuccess($event)">
        </app-{entity-kebab}-form-head-component-group>
    </div>
</ng-container>
```

## Head Data Component (`{entity-kebab}-form-head-component-group.component.ts`)

```typescript
import {Component} from '@angular/core';
import {ReactiveFormsModule} from '@angular/forms';
import {TranslocoDirective} from '@jsverse/transloco';
import {BaseHeadDataFormComponentGroupComponent} from '../../../../../core/component/head-data-form-component-group/base-head-data-form-component-group.component';
import {{EntityName}} from '../../../../../core/model/domain/{entity-kebab}.model';
import {for{EntityName}} from '../{entity-kebab}-form.lib';
// Import CVA components used in the form:
import {TextInputComponent} from '../../../../../core/component/form/text-input/text-input.component';
import {NumberInputComponent} from '../../../../../core/component/form/number-input/number-input.component';
import {DateInputComponent} from '../../../../../core/component/form/date-input/date-input.component';
import {SelectComponent} from '../../../../../core/component/form/select/select.component';
import {FormActionsComponent} from '../../../../../core/component/form/form-actions/form-actions.component';

@Component({
    selector: 'app-{entity-kebab}-form-head-component-group',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        TranslocoDirective,
        TextInputComponent,
        NumberInputComponent,
        DateInputComponent,
        SelectComponent,
        FormActionsComponent,
    ],
    templateUrl: './{entity-kebab}-form-head-component-group.component.html',
})
export class {EntityName}FormHeadComponentGroupComponent
    extends BaseHeadDataFormComponentGroupComponent<{EntityName}> {

    protected override formGroupBuilder = for{EntityName};
    protected override basePath = '{feature-route-path}';

    constructor() {
        super();
        this.type = {EntityName};
    }
}
```

## Head Data Template (`{entity-kebab}-form-head-component-group.component.html`)

```html
<div class="pt-1">
    @if (form) {
        <form [formGroup]="form">
            <ng-container *transloco="let t">
                <div class="row no-gutters">
                    <!-- Row 1: Primary fields -->
                    <app-text-input
                        class="col-4"
                        [required]="true"
                        formControlName="name"
                        [labelKey]="'{entity-kebab}.labels.name'"
                        [viewMode]="viewMode">
                    </app-text-input>

                    <!-- Add more CVA components as needed -->
                </div>

                <!-- Form actions -->
                <app-form-actions
                    class="mt-1 col-12"
                    [dirty]="form.dirty"
                    [valid]="form.valid"
                    [viewMode]="viewMode"
                    (persist)="persist()"
                    (reset)="reset()">
                </app-form-actions>
            </ng-container>
        </form>
    }
</div>
```

## Checklist

Before considering the feature form complete, verify:

- [ ] Page container extends `BaseFormComponent<T>` (P7)
- [ ] Head-data extends `BaseHeadDataFormComponentGroupComponent<T>` (P7)
- [ ] Form built via `for{EntityName}` factory from `.lib.ts` file (P3)
- [ ] All inputs are CVA components from `src/core/component/form/` (P1, R2)
- [ ] `viewMode` passed to all CVA children (P4, R6)
- [ ] All labels use Transloco keys — no hardcoded strings (P6, R10)
- [ ] `<app-form-actions>` used for persist/reset (R7)
- [ ] `<app-invalid-marker>` present on all CVA components (P5)
- [ ] State read from `DataStateService` signals (P8, R11)
- [ ] Feature directory follows standard structure (P2)
- [ ] All components are `standalone: true`
