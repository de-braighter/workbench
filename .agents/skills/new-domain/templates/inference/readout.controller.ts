import { Controller, Get } from '@nestjs/common';
import { ReadoutService, type ReadoutResult } from './readout.service.js';

@Controller('readout')
export class ReadoutController {
  constructor(private readonly service: ReadoutService) {}

  @Get()
  readout(): Promise<ReadoutResult> {
    return this.service.readout();
  }
}
