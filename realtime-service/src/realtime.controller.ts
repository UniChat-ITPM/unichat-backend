import { Controller, Get } from '@nestjs/common';

@Controller('realtime')
export class RealtimeController {
  @Get('health')
  health() {
    return { ok: true };
  }
}
