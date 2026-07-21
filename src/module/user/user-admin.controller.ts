import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  ApiResponsePayload,
  CurrentAuth,
  Roles,
  RolesGuard,
  type AccessTokenPayload,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserAdminService } from './user-admin.service';
import type { AdminUserResponse } from './user-admin.service';

@Controller('v1/admin/users')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class UserAdminController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createUser(
    @Body() body: CreateUserDto,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .createUser(body)
      .then((user) => ApiResponse.created(user, 'Tao user thanh cong.'));
  }

  @Get()
  listUsers(
    @Query() query: ListUsersQueryDto,
  ): Promise<ApiResponsePayload<AdminUserResponse[]>> {
    return this.userAdminService
      .listUsers(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach user thanh cong.',
          result.meta,
        ),
      );
  }

  @Patch(':id')
  updateUser(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .updateUser(id, body)
      .then((user) => ApiResponse.ok(user, 'Cap nhat user thanh cong.'));
  }

  @Patch(':id/lock')
  lockUser(
    @Param('id') id: string,
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .lockUser(id, auth.user_id)
      .then((user) => ApiResponse.ok(user, 'Khoa user thanh cong.'));
  }

  @Patch(':id/unlock')
  unlockUser(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .unlockUser(id)
      .then((user) => ApiResponse.ok(user, 'Mo khoa user thanh cong.'));
  }
}
