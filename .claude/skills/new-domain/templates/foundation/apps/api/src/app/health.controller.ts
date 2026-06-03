import { Controller, Get } from '@nestjs/common';
import { PACK_ID } from '@de-braighter/{{DOMAIN}}-pack';

@Controller('health')
export class HealthController {
  @Get()
  health(): { status: 'ok'; pack: string } {
    return { status: 'ok', pack: PACK_ID };
  }
}
