import { describe, it, expect } from 'vitest';
import { PACK_ID } from './index.js';

describe('{{DOMAIN}}-pack', () => {
  it('declares its pack id', () => {
    expect(PACK_ID).toBe('{{DOMAIN}}');
  });
});
