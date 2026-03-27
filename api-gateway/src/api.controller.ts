import {
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiService } from './api.service';
import { CompleteProfileGatewayDto } from './dto/complete-profile-gateway.dto';

@Controller('auth')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Post('otp/request')
  requestOtp(@Body() body: { phoneNumber: string }) {
    return this.apiService.forwardOtpRequest(body);
  }

  @Post('otp/verify')
  verifyOtp(@Body() body: { phoneNumber: string; otpCode: string }) {
    return this.apiService.forwardOtpVerify(body);
  }

  @Post('register/complete')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('profilePhoto', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
        ];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new Error(
              `Unsupported image type "${file.mimetype}". Allowed: ${allowed.join(', ')}`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  completeRegistration(
    @Body() dto: CompleteProfileGatewayDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let profilePhotoBase64: string | undefined;

    if (file) {
      profilePhotoBase64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    } else if (dto.profilePhoto) {
      profilePhotoBase64 = dto.profilePhoto;
    }

    return this.apiService.forwardCompleteProfile({
      phoneNumber: dto.phoneNumber,
      username: dto.username,
      email: dto.email,
      profilePhoto: profilePhotoBase64,
    });
  }
}
