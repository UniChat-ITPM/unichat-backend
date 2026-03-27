import { ConflictException } from '@nestjs/common';
import { UserService } from './user.service';
import { CloudinaryService } from './cloudinary.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockPrisma),
  UserStatus: { ACTIVE: 'ACTIVE' },
}));

describe('UserService', () => {
  let service: UserService;
  let cloudinarySvc: jest.Mocked<CloudinaryService>;

  beforeEach(() => {
    process.env['DATABASE_URL'] = 'postgresql://test';
    process.env['CLOUDINARY_CLOUD_NAME'] = 'c';
    process.env['CLOUDINARY_API_KEY'] = 'k';
    process.env['CLOUDINARY_API_SECRET'] = 's';

    cloudinarySvc = {
      validateBase64Image: jest.fn(),
      uploadProfilePhoto: jest.fn(),
    } as unknown as jest.Mocked<CloudinaryService>;

    service = new UserService(cloudinarySvc);
    jest.clearAllMocks();
  });

  describe('completeProfile', () => {
    const dto = {
      phoneNumber: '+94771234567',
      username: 'john_doe',
      email: 'john@example.com',
    };

    it('should return existing user when profile is already completed', async () => {
      const existingUser = {
        id: 'u1',
        phoneNumber: '+94771234567',
        displayName: 'john_doe',
        username: 'john_doe',
        email: 'john@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);

      const result = await service.completeProfile(dto);

      expect(result.success).toBe(true);
      expect(result.isNewUser).toBe(false);
      expect(result.user).toEqual(existingUser);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should update incomplete user and mark profile completed', async () => {
      const incompleteUser = {
        id: 'u2',
        phoneNumber: '+94771234567',
        displayName: '+94771234567',
        username: null,
        email: null,
        avatarUrl: null,
        profileCompleted: false,
        status: 'ACTIVE',
      };
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(incompleteUser)  // initial lookup
        .mockResolvedValueOnce(null)            // username uniqueness
        .mockResolvedValueOnce(null);           // email uniqueness

      const updatedUser = {
        ...incompleteUser,
        username: 'john_doe',
        displayName: 'john_doe',
        email: 'john@example.com',
        profileCompleted: true,
      };
      mockPrisma.user.update.mockResolvedValueOnce(updatedUser);

      const result = await service.completeProfile(dto);

      expect(result.success).toBe(true);
      expect(result.isNewUser).toBe(false);
      expect(result.user).toEqual(updatedUser);
    });

    it('should create new user if phone not found', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)  // phone lookup
        .mockResolvedValueOnce(null)  // username uniqueness
        .mockResolvedValueOnce(null); // email uniqueness

      const newUser = {
        id: 'u3',
        phoneNumber: '+94771234567',
        displayName: 'john_doe',
        username: 'john_doe',
        email: 'john@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };
      mockPrisma.user.create.mockResolvedValueOnce(newUser);

      const result = await service.completeProfile(dto);

      expect(result.success).toBe(true);
      expect(result.isNewUser).toBe(true);
      expect(result.user).toEqual(newUser);
    });

    it('should throw ConflictException for duplicate username', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)                // phone lookup
        .mockResolvedValueOnce({ id: 'other-user' }); // username taken

      await expect(service.completeProfile(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException for duplicate email', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)                 // phone lookup
        .mockResolvedValueOnce(null)                 // username free
        .mockResolvedValueOnce({ id: 'other-user' }); // email taken

      await expect(service.completeProfile(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should upload photo and store URL when profilePhoto provided', async () => {
      const dtoWithPhoto = {
        ...dto,
        profilePhoto: 'data:image/png;base64,iVBOR...',
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      cloudinarySvc.uploadProfilePhoto.mockResolvedValueOnce({
        secureUrl: 'https://res.cloudinary.com/test/img.png',
        publicId: 'p1',
        width: 512,
        height: 512,
        format: 'png',
        bytes: 999,
      });

      const newUser = {
        id: 'u4',
        phoneNumber: '+94771234567',
        displayName: 'john_doe',
        username: 'john_doe',
        email: 'john@example.com',
        avatarUrl: 'https://res.cloudinary.com/test/img.png',
        profileCompleted: true,
        status: 'ACTIVE',
      };
      mockPrisma.user.create.mockResolvedValueOnce(newUser);

      const result = await service.completeProfile(dtoWithPhoto);

      expect(cloudinarySvc.uploadProfilePhoto).toHaveBeenCalledWith(
        dtoWithPhoto.profilePhoto,
        'new',
      );
      expect(result.user).toEqual(newUser);
    });
  });
});
