import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserStatus } from '@prisma/client';

@Injectable()
export class UserService implements OnModuleDestroy {
  private readonly logger = new Logger(UserService.name);
  private readonly prisma: PrismaClient;

  constructor() {
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
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
        username: true,
        status: true,
      },
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
      select: {
        id: true,
        phoneNumber: true,
        displayName: true,
        username: true,
        status: true,
      },
    });

    this.logger.log(`Created new user for phone ${phoneNumber}`);
    return user;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
