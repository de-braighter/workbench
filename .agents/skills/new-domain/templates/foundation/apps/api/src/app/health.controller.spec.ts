import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('GET /health returns status ok', () => {
    expect(controller.health()).toEqual({ status: 'ok', pack: '{{DOMAIN}}' });
  });
});
