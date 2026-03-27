import {
  Body,
  Controller,
  HttpCode,
  Param,
  Put,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiService } from './api.service';
import { UpdateUserGatewayDto } from './dto/update-user-gateway.dto';

@Controller('user')
export class UserApiController {
  constructor(private readonly apiService: ApiService) {}

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
