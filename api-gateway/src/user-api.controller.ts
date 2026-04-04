import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiService } from './api.service';
import { UpdateUserGatewayDto } from './dto/update-user-gateway.dto';

@Controller('user')
export class UserApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get('find-by-phone')
  findByPhone(@Query('phoneNumber') phoneNumber: string) {
    return this.apiService.forwardFindUserByPhone(phoneNumber);
  }

  @Post('create')
  @HttpCode(200)
  createUser(@Body() body: { phoneNumber: string }) {
    return this.apiService.forwardCreateUser(body);
  }

  @Put(':id')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserGatewayDto) {
    return this.apiService.forwardUpdateUser(id, dto);
  }

  @Put(':id/deactivate')
  @HttpCode(200)
  deactivateUser(@Param('id') id: string) {
    return this.apiService.forwardDeactivateUser(id);
  }
}
