import {
  CloudinaryService,
  CloudinaryUploadError,
  ImageValidationError,
} from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload: jest.fn(),
    },
  },
}));

import { v2 as cloudinary } from 'cloudinary';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('CloudinaryService', () => {
  let service: CloudinaryService;

  beforeEach(() => {
    process.env['CLOUDINARY_CLOUD_NAME'] = 'test-cloud';
    process.env['CLOUDINARY_API_KEY'] = 'test-key';
    process.env['CLOUDINARY_API_SECRET'] = 'test-secret';
    service = new CloudinaryService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateBase64Image', () => {
    it('should accept a valid PNG data-URI', () => {
      const dataUri = `data:image/png;base64,${TINY_PNG_BASE64}`;
      const result = service.validateBase64Image(dataUri);
      expect(result.mimeType).toBe('image/png');
      expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it('should accept raw base64 PNG and sniff the mime type', () => {
      const result = service.validateBase64Image(TINY_PNG_BASE64);
      expect(result.mimeType).toBe('image/png');
    });

    it('should reject an unsupported mime type', () => {
      const bmpDataUri = `data:image/bmp;base64,${TINY_PNG_BASE64}`;
      expect(() => service.validateBase64Image(bmpDataUri)).toThrow(
        ImageValidationError,
      );
    });

    it('should reject files exceeding the size limit', () => {
      const hugeBase64 = 'iVBOR' + 'A'.repeat(8 * 1024 * 1024);
      expect(() => service.validateBase64Image(hugeBase64)).toThrow(
        ImageValidationError,
      );
    });

    it('should reject corrupt/tiny data', () => {
      expect(() => service.validateBase64Image('iVBORabc')).toThrow(
        ImageValidationError,
      );
    });
  });

  describe('uploadProfilePhoto', () => {
    it('should return upload result on success', async () => {
      (cloudinary.uploader.upload as jest.Mock).mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/test/image.png',
        public_id: 'unichat/profiles/user_abc_123',
        width: 512,
        height: 512,
        format: 'png',
        bytes: 1234,
      });

      const result = await service.uploadProfilePhoto(
        `data:image/png;base64,${TINY_PNG_BASE64}`,
        'abc',
      );

      expect(result.secureUrl).toBe(
        'https://res.cloudinary.com/test/image.png',
      );
      expect(result.publicId).toContain('user_abc');
      expect(cloudinary.uploader.upload).toHaveBeenCalledTimes(1);
    });

    it('should throw CloudinaryUploadError when Cloudinary fails', async () => {
      (cloudinary.uploader.upload as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        service.uploadProfilePhoto(
          `data:image/png;base64,${TINY_PNG_BASE64}`,
          'abc',
        ),
      ).rejects.toThrow(CloudinaryUploadError);
    });

    it('should reject invalid image data before calling Cloudinary', async () => {
      await expect(
        service.uploadProfilePhoto('data:image/bmp;base64,AAAA', 'abc'),
      ).rejects.toThrow(ImageValidationError);

      expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
    });
  });
});
