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

  describe('updateUserById', () => {
    it('should update user fields by id', async () => {
      const existingUser = {
        id: 'u10',
        phoneNumber: '+94770000000',
        displayName: 'old_name',
        username: 'old_name',
        email: 'old@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const updatedUser = {
        ...existingUser,
        displayName: 'new_name',
        username: 'new_name',
        email: 'new@example.com',
      };
      mockPrisma.user.update.mockResolvedValueOnce(updatedUser);

      const result = await service.updateUserById('u10', {
        displayName: 'new_name',
        username: 'new_name',
        email: 'new@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.user).toEqual(updatedUser);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('should return existing user when no update fields provided', async () => {
      const existingUser = {
        id: 'u11',
        phoneNumber: '+94771111111',
        displayName: 'same',
        username: 'same',
        email: 'same@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);

      const result = await service.updateUserById('u11', {});

      expect(result.success).toBe(true);
      expect(result.user).toEqual(existingUser);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw conflict when username is already taken', async () => {
      const existingUser = {
        id: 'u12',
        phoneNumber: '+94772222222',
        displayName: 'user12',
        username: 'user12',
        email: 'user12@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce({ id: 'u-other' });

      await expect(
        service.updateUserById('u12', { username: 'taken_name' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deactivateUserById', () => {
    it('should set accountStatus=false for active user', async () => {
      const existingUser = {
        id: 'u20',
        phoneNumber: '+94773333333',
        accountStatus: true,
        displayName: 'user20',
        username: 'user20',
        email: 'user20@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };

      const deactivatedUser = {
        ...existingUser,
        accountStatus: false,
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);
      mockPrisma.user.update.mockResolvedValueOnce(deactivatedUser);

      const result = await service.deactivateUserById('u20');

      expect(result.success).toBe(true);
      expect(result.user).toEqual(deactivatedUser);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u20' },
          data: { accountStatus: false },
        }),
      );
    });

    it('should return existing user when already deactivated', async () => {
      const existingUser = {
        id: 'u21',
        phoneNumber: '+94774444444',
        accountStatus: false,
        displayName: 'user21',
        username: 'user21',
        email: 'user21@example.com',
        avatarUrl: null,
        profileCompleted: true,
        status: 'ACTIVE',
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);

      const result = await service.deactivateUserById('u21');

      expect(result.success).toBe(true);
      expect(result.user).toEqual(existingUser);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
