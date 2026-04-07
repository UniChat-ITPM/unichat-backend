import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB (group image uploads via base64 JSON)

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly folder: string;

  constructor() {
    const cloudName = process.env['CLOUDINARY_CLOUD_NAME'];
    const apiKey = process.env['CLOUDINARY_API_KEY'];
    const apiSecret = process.env['CLOUDINARY_API_SECRET'];

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.warn(
        'Cloudinary credentials missing – group photo uploads will fail at runtime',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    this.folder = process.env['CLOUDINARY_GROUPS_FOLDER'] ?? 'unichat/groups';
  }

  /**
   * Validates a base64 image string and returns the mime type and raw buffer.
   * Accepts both data-URI (`data:image/png;base64,...`) and raw base64 strings.
   */
  validateBase64Image(base64: string): {
    mimeType: string;
    buffer: Buffer;
    sizeBytes: number;
  } {
    let mimeType: string;
    let rawBase64: string;

    const dataUriMatch = base64.match(
      /^data:(image\/\w+);base64,(.+)$/,
    );
    if (dataUriMatch) {
      mimeType = dataUriMatch[1];
      rawBase64 = dataUriMatch[2];
    } else {
      rawBase64 = base64;
      mimeType = this.sniffMimeType(rawBase64);
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new ImageValidationError(
        `Unsupported image type "${mimeType}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ImageValidationError(
        `Image exceeds maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
      );
    }

    if (buffer.length < 8) {
      throw new ImageValidationError('Image data is too small or corrupt');
    }

    return { mimeType, buffer, sizeBytes: buffer.length };
  }

  async uploadGroupPhoto(
    base64: string,
    conversationId: string,
  ): Promise<CloudinaryUploadResult> {
    const { mimeType } = this.validateBase64Image(base64);

    const dataUri = base64.startsWith('data:')
      ? base64
      : `data:${mimeType};base64,${base64}`;

    let result: UploadApiResponse;
    try {
      result = await cloudinary.uploader.upload(dataUri, {
        folder: this.folder,
        public_id: `group_${conversationId}_${Date.now()}`,
        overwrite: true,
        resource_type: 'image',
        transformation: [
          { width: 512, height: 512, crop: 'fill' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Cloudinary upload failed: ${reason}`);
      throw new CloudinaryUploadError(
        `Failed to upload group photo: ${reason}`,
      );
    }

    return {
      secureUrl: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  }

  private sniffMimeType(rawBase64: string): string {
    const header = rawBase64.substring(0, 16);
    if (header.startsWith('/9j/')) return 'image/jpeg';
    if (header.startsWith('iVBOR')) return 'image/png';
    if (header.startsWith('UklGR')) return 'image/webp';
    if (header.startsWith('R0lGO')) return 'image/gif';
    return 'application/octet-stream';
  }
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

export class CloudinaryUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudinaryUploadError';
  }
}
