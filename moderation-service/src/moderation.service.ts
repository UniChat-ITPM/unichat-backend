import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, AbuseEventType } from '@prisma/client';
import { ModerationConfig } from './config/moderation.config';
import { OtpCheckDto } from './dto/otp-check.dto';
import { OtpRecordAction, OtpRecordDto } from './dto/otp-record.dto';
import { SpamCheckDto } from './dto/spam-check.dto';
import { LoginCheckDto } from './dto/login-check.dto';
import { BlockUserDto } from './dto/block-user.dto';

@Injectable()
export class ModerationService implements OnModuleDestroy {
  private readonly logger = new Logger(ModerationService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // --- OTP Abuse Prevention ---

  async checkOtpLimits(dto: OtpCheckDto): Promise<{ allowed: boolean; reason: string | null }> {
    const since = new Date(Date.now() - ModerationConfig.otp.timeWindowMs);

    // Check by Phone Number
    const phoneAttempts = await this.prisma.otpRequest.count({
      where: {
        phoneNumber: dto.phoneNumber,
        createdAt: { gte: since },
      },
    });

    if (phoneAttempts >= ModerationConfig.otp.maxAttemptsPerPhone) {
      this.logger.warn(`OTP Check Failed: Phone ${dto.phoneNumber} exceeded limits.`);
      return { allowed: false, reason: 'Too many requests for this phone number.' };
    }

    // Since DeviceSession holds IPs, checking pure OTP by IP without relation to session can be complex.
    // As a simplification or if we assume we just check general abuse events for this IP:
    return { allowed: true, reason: null };
  }

  async recordOtpAction(dto: OtpRecordDto) {
    if (dto.action === OtpRecordAction.ABUSE) {
      await this.prisma.abuseEvent.create({
        data: {
          type: AbuseEventType.OTP_ABUSE,
          title: 'OTP System Abuse',
          description: dto.reason || 'Suspicious OTP behavior detected',
          userId: dto.userId || null, 
          // We don't have IP column on abuse event without json metadata, but we can store it in metadata
          metadata: { phoneNumber: dto.phoneNumber },
        },
      });
      this.logger.warn(`Recorded OTP Abuse for ${dto.phoneNumber}`);
    }
    return { success: true };
  }

  // --- Spam Detection ---

  async checkSpam(dto: SpamCheckDto): Promise<{ isSpam: boolean; score: number; flaggedTerms: string[] }> {
    let score = 0;
    const flaggedTerms: string[] = [];
    const contentLower = dto.content.toLowerCase();

    for (const keyword of ModerationConfig.spam.blockedKeywords) {
      if (contentLower.includes(keyword.toLowerCase())) {
        score += 50; 
        flaggedTerms.push(keyword);
      }
    }

    const isSpam = score >= ModerationConfig.spam.thresholdScore;
    if (isSpam) {
      this.logger.warn(`Spam detected: Score ${score}`);
    }
    return { isSpam, score, flaggedTerms };
  }

  // --- Suspicious Login Detection ---

  async checkLogin(dto: LoginCheckDto) {
    if ((dto.failedAttempts || 0) >= ModerationConfig.login.maxFailedAttempts) {
      this.logger.warn(`Suspicious Login for user ${dto.userId}: Too many failed attempts`);
      await this.prisma.abuseEvent.create({
        data: {
          userId: dto.userId,
          type: AbuseEventType.LOGIN_ABUSE,
          title: 'Login attempt limit exceeded',
          description: 'Too many failed login attempts recorded',
          metadata: { ipAddress: dto.ipAddress, deviceId: dto.deviceId },
        },
      });
      return { allowed: false, reason: 'Too many failed login attempts' };
    }

    // In a real scenario, we might query DeviceSession to verify new IP/Location
    // Not implementing advanced geo-IP checks here due to lack of geo DB.
    
    return { allowed: true, reason: null };
  }

  // --- User-level Block / Unblock ---

  async blockUser(requesterId: string, targetUserId: string, dto: BlockUserDto) {
    if (requesterId === targetUserId) {
      throw new BadRequestException('You cannot block yourself');
    }

    // Ensure target exists
    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) throw new NotFoundException('User to block not found');

    const existingBlock = await this.prisma.userBlock.findUnique({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: requesterId,
          blockedUserId: targetUserId,
        },
      },
    });

    if (existingBlock) {
      throw new ConflictException('User is already blocked');
    }

    await this.prisma.userBlock.create({
      data: {
        blockerUserId: requesterId,
        blockedUserId: targetUserId,
        reason: dto.reason,
      },
    });

    this.logger.log(`User ${requesterId} blocked custom user ${targetUserId}`);
    return { success: true, message: 'User successfully blocked' };
  }

  async unblockUser(requesterId: string, targetUserId: string) {
    const existingBlock = await this.prisma.userBlock.findUnique({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: requesterId,
          blockedUserId: targetUserId,
        },
      },
    });

    if (!existingBlock) {
      throw new NotFoundException('Block record not found');
    }

    await this.prisma.userBlock.delete({
      where: { id: existingBlock.id },
    });

    this.logger.log(`User ${requesterId} unblocked custom user ${targetUserId}`);
    return { success: true, message: 'User successfully unblocked' };
  }

  async getBlockedUsers(requesterId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockerUserId: requesterId },
      include: {
        blockedUser: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return blocks.map(b => ({
      userId: b.blockedUser.id,
      displayName: b.blockedUser.displayName,
      username: b.blockedUser.username,
      avatarUrl: b.blockedUser.avatarUrl,
      blockedAt: b.createdAt,
    }));
  }

  async getBlockStatus(requesterId: string, targetUserId: string) {
    const [blockedByMe, blockedMe] = await Promise.all([
      this.prisma.userBlock.findUnique({
        where: { blockerUserId_blockedUserId: { blockerUserId: requesterId, blockedUserId: targetUserId } },
      }),
      this.prisma.userBlock.findUnique({
        where: { blockerUserId_blockedUserId: { blockerUserId: targetUserId, blockedUserId: requesterId } },
      }),
    ]);

    return {
      amIBlockedByThem: !!blockedMe,
      haveIBlockedThem: !!blockedByMe,
    };
  }
}
