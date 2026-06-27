import { describe, it, expect } from 'vitest';
import { SPINE_READY } from './index.js';

describe('{{DOMAIN}}-spine', () => {
  it('is wired', () => {
    expect(SPINE_READY).toBe(true);
  });
});
