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
  ReqContext,
  type RequestContext,
} from '../../common/http';
import { UpdateAccountStatusDto } from '../../common/account/update-account-status.dto';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiCreatedEnvelope,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUserDto } from '../auth/dto/auth-response.dto';
import { AuditActorType } from '../audit/schema/audit-log.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserAdminService } from './user-admin.service';
import type { AdminUserResponse } from './user-admin.service';

@Controller('v1/users')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@ApiCommonAuthErrors()
export class UserAdminController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(AuthUserDto)
  @ApiCommonMutationErrors()
  createUser(
    @Body() body: CreateUserDto,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .createUser(body)
      .then((user) => ApiResponse.created(user, 'Tao user thanh cong.'));
  }

  @Get()
  @ApiOkEnvelope(AuthUserDto, { isArray: true, paginated: true })
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
  @ApiOkEnvelope(AuthUserDto)
  @ApiCommonMutationErrors()
  updateUser(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .updateUser(id, body, auth.user_id)
      .then((user) => ApiResponse.ok(user, 'Cap nhat user thanh cong.'));
  }

  @Patch(':id/status')
  @ApiOkEnvelope(AuthUserDto)
  @ApiCommonMutationErrors()
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateAccountStatusDto,
    @CurrentAuth() auth: AccessTokenPayload,
    @ReqContext() context: RequestContext,
  ): Promise<ApiResponsePayload<AdminUserResponse>> {
    return this.userAdminService
      .updateStatus(id, body.status, auth.user_id, {
        actorType: AuditActorType.USER,
        actorId: auth.user_id ?? null,
        requestId: context.requestId,
      })
      .then((user) =>
        ApiResponse.ok(user, 'Cap nhat trang thai user thanh cong.'),
      );
  }
}
