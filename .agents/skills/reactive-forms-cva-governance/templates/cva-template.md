# CVA Component Scaffold Template

Use this template when creating a new ControlValueAccessor component.
Place the generated files in `src/core/component/form/{kebab-name}/`.

## TypeScript (`{kebab-name}.component.ts`)

```typescript
import {Component, forwardRef, Input} from '@angular/core';
import {ControlContainer, NG_VALUE_ACCESSOR, ReactiveFormsModule} from '@angular/forms';
import {TranslocoDirective} from '@jsverse/transloco';
import {BaseValueAccessorComponent} from '../base-value-accessor.component';
import {InvalidMarkerComponent} from '../invalid-marker/invalid-marker.component';
import {ViewMode} from '../../../model/application/view-mode.model';

@Component({
    selector: 'app-{kebab-name}',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        TranslocoDirective,
        InvalidMarkerComponent,
    ],
    templateUrl: './{kebab-name}.component.html',
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => {PascalName}Component),
            multi: true,
        },
    ],
    viewProviders: [
        {
            provide: ControlContainer,
            useFactory: (container: ControlContainer) => container,
            deps: [[ControlContainer]],
        },
    ],
})
export class {PascalName}Component extends BaseValueAccessorComponent<{ValueType}> {
    // Add component-specific @Input() properties here
    // Example: @Input() placeholder = '';

    readonly viewModes = ViewMode;
}
```

## HTML Template (`{kebab-name}.component.html`)

### Option A — Transloco structural directive (preferred for multiple keys)

```html
<ng-container *transloco="let t">
    @if (labelKey) {
        <label class="form-label" [for]="formControlName">
            {{ t(labelKey) }}{{ required ? '*' : '' }}
        </label>
    }

    @if (viewMode !== viewModes.READ) {
        <app-invalid-marker [errors]="errors"></app-invalid-marker>
        <input
            class="form-control"
            type="text"
            [id]="formControlName"
            [formControlName]="formControlName"
            (blur)="onTouch()"
        />
    } @else {
        <div class="form-control-plaintext" [class.text-muted]="!val">
            @if (val) {
                {{ val }}
            } @else {
                {{ t('common.labels.no-value') }}
            }
        </div>
    }
</ng-container>
```

### Option B — Transloco pipe (simpler for few keys)

```html
@if (labelKey) {
    <label class="form-label" [for]="formControlName">
        {{ labelKey | transloco }}{{ required ? '*' : '' }}
    </label>
}

@if (viewMode !== viewModes.READ) {
    <app-invalid-marker [errors]="errors"></app-invalid-marker>
    <input
        class="form-control"
        type="text"
        [id]="formControlName"
        [formControlName]="formControlName"
        (blur)="onTouch()"
    />
} @else {
    <div class="form-control-plaintext" [class.text-muted]="!val">
        @if (val) {
            {{ val }}
        } @else {
            {{ 'common.labels.no-value' | transloco }}
        }
    </div>
}
```

## Unit Test (`{kebab-name}.component.spec.ts`)

```typescript
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {getTranslocoModule} from '../../../../test/transloco-testing.module';
import {{PascalName}Component} from './{kebab-name}.component';

describe('{PascalName}Component', () => {
    let component: {PascalName}Component;
    let fixture: ComponentFixture<{PascalName}Component>;

    const form = new FormGroup({
        testField: new FormControl(''),
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                {PascalName}Component,
                ReactiveFormsModule,
                getTranslocoModule(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent({PascalName}Component);
        component = fixture.componentInstance;
        component.formControlName = 'testField';
        component.labelKey = 'test.label';
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should implement writeValue', () => {
        component.writeValue('test-value' as any);
        expect(component.val).toBe('test-value');
    });

    it('should call onChange when value is set', () => {
        const spy = jasmine.createSpy('onChange');
        component.registerOnChange(spy);
        component.value = 'new-value' as any;
        expect(spy).toHaveBeenCalledWith('new-value');
    });

    it('should call onTouch when registerOnTouched is called', () => {
        const spy = jasmine.createSpy('onTouch');
        component.registerOnTouched(spy);
        component.onTouch();
        expect(spy).toHaveBeenCalled();
    });

    it('should show read-only display in READ mode', () => {
        component.viewMode = ViewMode.READ;
        component.writeValue('display-value' as any);
        fixture.detectChanges();
        const el = fixture.nativeElement.querySelector('.form-control-plaintext');
        expect(el?.textContent).toContain('display-value');
    });
});
```

## Checklist

Before considering the CVA component complete, verify:

- [ ] Extends `BaseValueAccessorComponent<T>` with correct generic type
- [ ] `NG_VALUE_ACCESSOR` provider registered with `forwardRef`
- [ ] Component is `standalone: true`
- [ ] Uses `TranslocoDirective` or `TranslocoPipe` (NOT `TranslateModule`)
- [ ] `@Input() formControlName` inherited from base
- [ ] `@Input() viewMode` inherited from base
- [ ] `@Input() labelKey` inherited from base
- [ ] `@Input() required` inherited from base
- [ ] Template shows translated label with required indicator
- [ ] Template has `@if (viewMode !== viewModes.READ)` for edit mode
- [ ] Template has `@else` block for read-only display with `'common.labels.no-value'` fallback
- [ ] `<app-invalid-marker [errors]="errors">` present in edit mode
- [ ] `(blur)="onTouch()"` bound on the input element
- [ ] Placed in `src/core/component/form/{kebab-name}/`
- [ ] Unit test covers `writeValue`, `registerOnChange`, `registerOnTouched`, read mode display
- [ ] No hardcoded user-facing strings anywhere
