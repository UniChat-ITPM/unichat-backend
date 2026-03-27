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
