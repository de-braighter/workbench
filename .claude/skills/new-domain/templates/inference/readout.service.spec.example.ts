// EXAMPLE spec for the readout seam — copy next to readout.service.ts (strip `.example`).
// The verifier wave expects this spec on every scaffold: mocked backbone, three paths —
// happy (moment summary), error (r.ok = false), survival ('kind' in s narrowing).
import 'reflect-metadata';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  INFERENCE_BACKBONE,
  type InferenceBackbone,
} from '@de-braighter/substrate-contracts/inference';
import { ReadoutService } from './readout.service.js';

const posterior = vi.fn();
const backbone = { posterior } as unknown as InferenceBackbone;

function momentHandle(summary: Record<string, unknown>) {
  return { ok: true, value: { summary } };
}

describe('ReadoutService', () => {
  let service: ReadoutService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReadoutService,
        { provide: INFERENCE_BACKBONE, useValue: backbone },
      ],
    }).compile();
    service = moduleRef.get(ReadoutService);
  });

  it('passes a moment posterior summary through (happy path)', async () => {
    posterior.mockResolvedValueOnce(
      momentHandle({ mean: 24.5, p10: 20.1, p90: 28.9, sd: 3.4 }),
    );
    const r = await service.readout();
    expect(r.mean).toBe(24.5);
    expect(r.p10).toBe(20.1);
    expect(r.p90).toBe(28.9);
  });

  it('returns the zeroed sentinel when posterior() errors (r.ok = false)', async () => {
    posterior.mockResolvedValueOnce({ ok: false, error: { kind: 'catalog-miss' } });
    const r = await service.readout();
    expect(r).toMatchObject({ mean: 0, p10: 0, p90: 0 });
  });

  it("returns the zeroed sentinel for a survival summary ('kind' narrowing)", async () => {
    posterior.mockResolvedValueOnce(
      momentHandle({ kind: 'survival', medianSurvival: 12 }),
    );
    const r = await service.readout();
    expect(r).toMatchObject({ mean: 0, p10: 0, p90: 0 });
  });
});
