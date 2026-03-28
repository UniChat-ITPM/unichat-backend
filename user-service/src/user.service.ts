import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserStatus } from '@prisma/client';
import {
  CloudinaryService,
  CloudinaryUploadError,
  ImageValidationError,
} from './cloudinary.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MatchContactsDto } from './dto/match-contacts.dto';

const USER_SELECT = {
  id: true,
  phoneNumber: true,
  accountStatus: true,
  displayName: true,
  username: true,
  email: true,
  avatarUrl: true,
  profileCompleted: true,
  status: true,
} as const;

@Injectable()
export class UserService implements OnModuleDestroy {
  private readonly logger = new Logger(UserService.name);
  private readonly prisma: PrismaClient;

  constructor(private readonly cloudinaryService: CloudinaryService) {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required to initialize Prisma');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });
  }

  async findByPhoneNumber(phoneNumber: string) {
    return this.prisma.user.findUnique({
      where: { phoneNumber },
      select: USER_SELECT,
    });
  }

  async createUser(phoneNumber: string) {
    const user = await this.prisma.user.create({
      data: {
        phoneNumber,
        phoneVerified: true,
        displayName: phoneNumber,
        status: UserStatus.ACTIVE,
      },
      select: USER_SELECT,
    });

    this.logger.log(`Created new user for phone ${phoneNumber}`);
    return user;
  }

  async completeProfile(dto: CompleteProfileDto): Promise<{
    success: true;
    isNewUser: boolean;
    user: Record<string, unknown>;
  }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber: dto.phoneNumber },
      select: USER_SELECT,
    });

    if (existingUser?.profileCompleted) {
      return { success: true, isNewUser: false, user: existingUser };
    }

    await this.checkUniqueness({
      username: dto.username,
      email: dto.email,
      currentUserId: existingUser?.id,
    });

    let avatarUrl: string | null = null;
    if (dto.profilePhoto) {
      avatarUrl = await this.uploadPhoto(dto.profilePhoto, existingUser?.id ?? 'new');
    }

    if (existingUser) {
      const updated = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          username: dto.username,
          displayName: dto.username,
          email: dto.email,
          ...(avatarUrl ? { avatarUrl } : {}),
          profileCompleted: true,
        },
        select: USER_SELECT,
      });
      this.logger.log(`Profile completed for user ${updated.id}`);
      return { success: true, isNewUser: false, user: updated };
    }

    const newUser = await this.prisma.user.create({
      data: {
        phoneNumber: dto.phoneNumber,
        phoneVerified: true,
        profileCompleted: true,
        username: dto.username,
        displayName: dto.username,
        email: dto.email,
        avatarUrl,
        status: UserStatus.ACTIVE,
      },
      select: USER_SELECT,
    });
    this.logger.log(`New user created with completed profile: ${newUser.id}`);
    return { success: true, isNewUser: true, user: newUser };
  }

  async updateUserById(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<{ success: true; user: Record<string, unknown> }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    await this.checkUniqueness({
      username: dto.username,
      email: dto.email,
      currentUserId: existingUser.id,
    });

    let avatarUrl: string | null = null;
    if (dto.profilePhoto) {
      avatarUrl = await this.uploadPhoto(dto.profilePhoto, existingUser.id);
    }

    const data: {
      displayName?: string;
      username?: string;
      email?: string;
      avatarUrl?: string;
    } = {};

    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email;
    if (avatarUrl) data.avatarUrl = avatarUrl;

    if (Object.keys(data).length === 0) {
      return { success: true, user: existingUser };
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: existingUser.id },
      data,
      select: USER_SELECT,
    });

    this.logger.log(`User profile updated: ${updatedUser.id}`);
    return { success: true, user: updatedUser };
  }

  async matchContacts(
    requesterId: string,
    dto: MatchContactsDto,
  ): Promise<{
    matches: Array<{
      phoneNumber: string;
      userId: string;
      displayName: string;
      username?: string;
      profilePhoto?: string;
    }>;
  }> {
    const seen = new Set<string>();
    const orderedUnique: string[] = [];
    for (const p of dto.phoneNumbers) {
      if (!seen.has(p)) {
        seen.add(p);
        orderedUnique.push(p);
      }
    }

    if (orderedUnique.length === 0) {
      return { matches: [] };
    }

    const users = await this.prisma.user.findMany({
      where: {
        phoneNumber: { in: orderedUnique },
        status: UserStatus.ACTIVE,
        deletedAt: null,
        accountStatus: true,
        profileCompleted: true,
      },
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        privacySetting: { select: { allowProfilePhoto: true } },
      },
    });

    const matchedIds = users.map((u) => u.id);
    const blockedIds = new Set<string>();

    if (matchedIds.length > 0) {
      const blocks = await this.prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerUserId: requesterId, blockedUserId: { in: matchedIds } },
            { blockedUserId: requesterId, blockerUserId: { in: matchedIds } },
          ],
        },
        select: { blockerUserId: true, blockedUserId: true },
      });

      for (const b of blocks) {
        blockedIds.add(
          b.blockerUserId === requesterId ? b.blockedUserId : b.blockerUserId,
        );
      }
    }

    const byPhone = new Map(users.map((u) => [u.phoneNumber, u]));
    const excludeSelf = dto.excludeSelf === true;
    const matches: Array<{
      phoneNumber: string;
      userId: string;
      displayName: string;
      username?: string;
      profilePhoto?: string;
    }> = [];

    for (const phone of orderedUnique) {
      const u = byPhone.get(phone);
      if (!u) {
        continue;
      }
      if (blockedIds.has(u.id)) {
        continue;
      }
      if (excludeSelf && u.id === requesterId) {
        continue;
      }

      const allowPhoto = u.privacySetting?.allowProfilePhoto !== false;
      const entry: (typeof matches)[number] = {
        phoneNumber: phone,
        userId: u.id,
        displayName: u.displayName,
      };
      if (u.username) {
        entry.username = u.username;
      }
      if (allowPhoto && u.avatarUrl) {
        entry.profilePhoto = u.avatarUrl;
      }
      matches.push(entry);
    }

    this.logger.log(
      `Contact match requester=${requesterId} batch=${orderedUnique.length} matches=${matches.length}`,
    );

    return { matches };
  }

  async deactivateUserById(
    userId: string,
  ): Promise<{ success: true; user: Record<string, unknown> }> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    if (existingUser.accountStatus === false) {
      return { success: true, user: existingUser };
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: existingUser.id },
      data: { accountStatus: false },
      select: USER_SELECT,
    });

    this.logger.log(`User account deactivated: ${updatedUser.id}`);
    return { success: true, user: updatedUser };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private async checkUniqueness(input: {
    username?: string;
    email?: string;
    currentUserId?: string;
  }) {
    if (input.username !== undefined) {
      const existingByUsername = await this.prisma.user.findUnique({
        where: { username: input.username },
        select: { id: true },
      });
      if (existingByUsername && existingByUsername.id !== input.currentUserId) {
        throw new ConflictException('Username is already taken');
      }
    }

    if (input.email !== undefined) {
      const existingByEmail = await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existingByEmail && existingByEmail.id !== input.currentUserId) {
        throw new ConflictException('Email is already in use');
      }
    }
  }

  private async uploadPhoto(
    base64: string,
    userId: string,
  ): Promise<string> {
    try {
      const result = await this.cloudinaryService.uploadProfilePhoto(
        base64,
        userId,
      );
      return result.secureUrl;
    } catch (error) {
      if (
        error instanceof ImageValidationError ||
        error instanceof CloudinaryUploadError
      ) {
        throw error;
      }
      throw new CloudinaryUploadError(
        'Unexpected error during photo upload',
      );
    }
  }
}
