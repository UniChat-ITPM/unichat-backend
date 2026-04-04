import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiService } from './api.service';
import { MatchContactsGatewayDto } from './dto/match-contacts-gateway.dto';
import { JwtBearerUserService } from './jwt-bearer-user.service';
import { ContactMatchRateLimiterService } from './contact-match-rate-limiter.service';

function resolveClientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  const first = raw?.split(',')[0]?.trim();
  return first || req.ip || req.socket.remoteAddress || 'unknown';
}

@Controller('users')
export class UsersMatchContactsController {
  constructor(
    private readonly apiService: ApiService,
    private readonly jwtBearerUser: JwtBearerUserService,
    private readonly contactMatchRateLimiter: ContactMatchRateLimiterService,
  ) {}

  @Post('match-contacts')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async matchContacts(
    @Req() req: Request,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: MatchContactsGatewayDto,
  ) {
    const userId = this.jwtBearerUser.verifyBearerUserId(authorization);
    this.contactMatchRateLimiter.assertWithinLimit(userId, resolveClientIp(req));
    return this.apiService.forwardMatchContacts(userId, dto);
  }
}
