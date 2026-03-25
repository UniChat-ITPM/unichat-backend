import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Called by auth-service after OTP verification
   * to look up an existing user by phone number.
   */
  @Get('find-by-phone')
  async findByPhone(@Query('phoneNumber') phoneNumber: string) {
    const user = await this.userService.findByPhoneNumber(phoneNumber);
    if (!user) {
      return { found: false, user: null };
    }
    return { found: true, user };
  }

  /**
   * Called by auth-service when user does not exist yet.
   * Creates a new user with phoneVerified = true.
   */
  @Post('create')
  async createUser(@Body() body: { phoneNumber: string }) {
    const user = await this.userService.createUser(body.phoneNumber);
    return { success: true, user };
  }
}
