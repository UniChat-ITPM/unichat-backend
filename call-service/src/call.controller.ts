import { Controller, Get } from '@nestjs/common';

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function parseIceServersFromEnv(): unknown[] | null {
  const raw = process.env['ICE_SERVERS_JSON']?.trim();
  if (!raw) {
    return null;
  }
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

@Controller('calls')
export class CallController {
  /** Public ICE server list for WebRTC (optional TURN via ICE_SERVERS_JSON). */
  @Get('ice-config')
  iceConfig() {
    const fromEnv = parseIceServersFromEnv();
    return {
      iceServers: fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STUN,
    };
  }

  @Get('health')
  health() {
    return { ok: true, service: 'call-service' };
  }
}
