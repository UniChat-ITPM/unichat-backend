import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { OtpCheckDto } from './dto/otp-check.dto';
import { OtpRecordDto } from './dto/otp-record.dto';
import { SpamCheckDto } from './dto/spam-check.dto';
import { LoginCheckDto } from './dto/login-check.dto';
import { BlockUserDto } from './dto/block-user.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  private getTrustedRequesterId(rawHeader: string | undefined): string {
    const v = rawHeader?.trim();
    if (!v) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    if (!UUID_RE.test(v)) {
      throw new BadRequestException('Invalid x-user-id format; expected a UUID');
    }
    return v;
  }

  @Post('otp/check')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async checkOtp(@Body() dto: OtpCheckDto) {
    return this.moderationService.checkOtpLimits(dto);
  }

  @Post('otp/record')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async recordOtp(@Body() dto: OtpRecordDto) {
    return this.moderationService.recordOtpAction(dto);
  }

  @Post('spam/check')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async checkSpam(@Body() dto: SpamCheckDto) {
    return this.moderationService.checkSpam(dto);
  }

  @Post('login/check')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async checkLogin(@Body() dto: LoginCheckDto) {
    return this.moderationService.checkLogin(dto);
  }

  @Post('users/:userId/block')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async blockUser(
    @Headers('x-user-id') xUserId: string | undefined,
    @Param('userId') targetUserId: string,
    @Body() dto: BlockUserDto,
  ) {
    const requesterId = this.getTrustedRequesterId(xUserId);
    return this.moderationService.blockUser(requesterId, targetUserId, dto);
  }

  @Post('users/:userId/unblock')
  @HttpCode(200)
  async unblockUser(
    @Headers('x-user-id') xUserId: string | undefined,
    @Param('userId') targetUserId: string,
  ) {
    const requesterId = this.getTrustedRequesterId(xUserId);
    return this.moderationService.unblockUser(requesterId, targetUserId);
  }

  @Get('users/blocked')
  async getBlockedUsers(@Headers('x-user-id') xUserId: string | undefined) {
    const requesterId = this.getTrustedRequesterId(xUserId);
    return this.moderationService.getBlockedUsers(requesterId);
  }

  @Get('users/:userId/block-status')
  async getBlockStatus(
    @Headers('x-user-id') xUserId: string | undefined,
    @Param('userId') targetUserId: string,
  ) {
    const requesterId = this.getTrustedRequesterId(xUserId);
    return this.moderationService.getBlockStatus(requesterId, targetUserId);
  }
}
