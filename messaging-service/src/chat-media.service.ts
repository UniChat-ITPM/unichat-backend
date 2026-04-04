import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, MediaType, UploadStatus } from '@prisma/client';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

const MAX_BYTES = 25 * 1024 * 1024;

@Injectable()
export class ChatMediaService {
  private readonly logger = new Logger(ChatMediaService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    this.prisma = new PrismaClient({ adapter });

    const cloudName = process.env['CLOUDINARY_CLOUD_NAME'];
    const apiKey = process.env['CLOUDINARY_API_KEY'];
    const apiSecret = process.env['CLOUDINARY_API_SECRET'];
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  private inferMediaType(mime: string): MediaType {
    const m = mime.toLowerCase();
    if (m.startsWith('image/')) {
      return MediaType.IMAGE;
    }
    if (m.startsWith('video/')) {
      return MediaType.VIDEO;
    }
    if (m.startsWith('audio/')) {
      return MediaType.AUDIO;
    }
    return MediaType.DOCUMENT;
  }

  private resourceTypeForUpload(mediaType: MediaType): 'image' | 'video' | 'auto' {
    if (mediaType === MediaType.IMAGE) {
      return 'image';
    }
    if (mediaType === MediaType.VIDEO || mediaType === MediaType.AUDIO) {
      return 'video';
    }
    return 'auto';
  }

  async uploadForUser(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ mediaAssetId: string; secureUrl: string; mediaType: MediaType }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is empty');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('File too large (max 25 MB)');
    }

    const mime = file.mimetype || 'application/octet-stream';
    const mediaType = this.inferMediaType(mime);
    const folder =
      process.env['CLOUDINARY_CHAT_FOLDER'] ?? 'unichat/chat';
    const resourceType = this.resourceTypeForUpload(mediaType);

    const uploaded: UploadApiResponse = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
        },
        (err, result) => {
          if (err || !result) {
            reject(err ?? new Error('Cloudinary upload failed'));
          } else {
            resolve(result);
          }
        },
      );
      stream.end(file.buffer);
    });

    const ext =
      file.originalname?.includes('.') === true
        ? file.originalname.split('.').pop()?.slice(0, 20)
        : null;

    let durationSeconds: number | null = null;
    if (typeof uploaded.duration === 'number' && Number.isFinite(uploaded.duration)) {
      durationSeconds = Math.max(0, Math.round(uploaded.duration));
    }

    try {
      const asset = await this.prisma.mediaAsset.create({
        data: {
          uploadedByUserId: userId,
          mediaType,
          originalFileName: file.originalname?.slice(0, 250) || 'upload',
          mimeType: mime.slice(0, 120),
          fileExtension: ext ?? null,
          fileSizeBytes: BigInt(file.size),
          width: uploaded.width ?? null,
          height: uploaded.height ?? null,
          durationSeconds,
          storageProvider: 'CLOUDINARY',
          storageKey: uploaded.public_id.slice(0, 255),
          secureUrl: uploaded.secure_url,
          uploadStatus: UploadStatus.COMPLETED,
        },
      });

      return {
        mediaAssetId: asset.id,
        secureUrl: asset.secureUrl,
        mediaType: asset.mediaType,
      };
    } catch (e) {
      this.logger.error(`mediaAsset create failed: ${e}`);
      throw new InternalServerErrorException('Could not store media metadata');
    }
  }
}
