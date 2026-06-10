// Canonical a11y battery (player-surfaces arc patterns) — copy next to each page
// component as `a11y.spec.ts` and adapt the imports/selectors. Kills the
// inaccessible-by-default failure mode. Structural checks only — color contrast
// and reduced-motion need a real browser pass (qa-engineer dimension 2).
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('a11y battery: AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  it('every label points at an existing control (label/for)', () => {
    for (const label of Array.from(root.querySelectorAll('label'))) {
      const forId = label.getAttribute('for');
      expect(forId)
        .withContext(`<label> "${label.textContent?.trim()}" needs a for attribute`)
        .toBeTruthy();
      expect(root.querySelector(`#${CSS.escape(forId ?? '')}`))
        .withContext(`label for="${forId}" has no matching control`)
        .toBeTruthy();
    }
  });

  it('anything acting as a button IS a button or link', () => {
    for (const el of Array.from(root.querySelectorAll('[role="button"]'))) {
      expect(['BUTTON', 'A'].includes(el.tagName))
        .withContext(`role="button" on <${el.tagName.toLowerCase()}> — use <button type="button">`)
        .toBeTrue();
    }
  });

  it('icon-only buttons carry an accessible name', () => {
    for (const btn of Array.from(root.querySelectorAll('button'))) {
      const hasText = (btn.textContent ?? '').trim().length > 0;
      const hasLabel = btn.hasAttribute('aria-label') || btn.hasAttribute('aria-labelledby');
      expect(hasText || hasLabel).withContext('icon-only <button> needs aria-label').toBeTrue();
    }
  });

  it('nothing autofocuses', () => {
    expect(root.querySelector('[autofocus]')).toBeNull();
  });

  it('interactive targets meet the 24px minimum (SC 2.5.8)', () => {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, a[href]'))) {
      const { height, width } = el.getBoundingClientRect();
      if (height === 0 && width === 0) continue; // not rendered in this fixture
      expect(height)
        .withContext(`<${el.tagName.toLowerCase()}> height ${height}px < 24px`)
        .toBeGreaterThanOrEqual(24);
      expect(width)
        .withContext(`<${el.tagName.toLowerCase()}> width ${width}px < 24px`)
        .toBeGreaterThanOrEqual(24);
    }
  });
});
