import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { MatchContactsDto } from './dto/match-contacts.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  CloudinaryUploadError,
  ImageValidationError,
} from './cloudinary.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  private getTrustedRequesterId(rawHeader: string | undefined): string {
    const v = rawHeader?.trim();
    if (!v) {
      throw new UnauthorizedException('Missing x-user-id header');
    }
    if (!UUID_RE.test(v)) {
      throw new BadRequestException(
        'Invalid x-user-id format; expected a UUID',
      );
    }
    return v;
  }

  @Post('contacts/match')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async matchContacts(
    @Headers('x-user-id') xUserId: string | undefined,
    @Body() dto: MatchContactsDto,
  ) {
    const requesterId = this.getTrustedRequesterId(xUserId);
    return this.userService.matchContacts(requesterId, dto);
  }

  @Get('find-by-phone')
  async findByPhone(@Query('phoneNumber') phoneNumber: string) {
    const user = await this.userService.findByPhoneNumber(phoneNumber);
    if (!user) {
      return { found: false, user: null };
    }
    return { found: true, user };
  }

  @Post('create')
  async createUser(@Body() body: { phoneNumber: string }) {
    const user = await this.userService.createUser(body.phoneNumber);
    return { success: true, user };
  }

  @Post('profile/complete')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async completeProfile(@Body() dto: CompleteProfileDto) {
    try {
      return await this.userService.completeProfile(dto);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof ImageValidationError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof CloudinaryUploadError) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while completing profile',
      );
    }
  }

  @Put(':id')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    try {
      return await this.userService.updateUserById(id, dto);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof ImageValidationError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof CloudinaryUploadError) {
        throw new InternalServerErrorException(error.message);
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while updating user details',
      );
    }
  }

  @Put(':id/deactivate')
  @HttpCode(200)
  async deactivateUser(@Param('id') id: string) {
    try {
      return await this.userService.deactivateUserById(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while deactivating account',
      );
    }
  }
}
