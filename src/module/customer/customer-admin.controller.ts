import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

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
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { AuditActorType } from '../audit/domain/audit-log';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomerAdminService } from './customer-admin.service';
import type { AdminCustomerResponse } from './customer-admin.service';
import { AdminCustomerDto } from './dto/admin-customer-response.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@Controller('v1/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class CustomerAdminController {
  constructor(private readonly adminService: CustomerAdminService) {}

  @Get()
  @ApiOkEnvelope(AdminCustomerDto, { isArray: true, paginated: true })
  listCustomers(
    @Query() query: ListCustomersQueryDto,
  ): Promise<ApiResponsePayload<AdminCustomerResponse[]>> {
    return this.adminService
      .listCustomers(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach customer thanh cong.',
          result.meta,
        ),
      );
  }

  @Patch(':id/status')
  @ApiOkEnvelope(AdminCustomerDto)
  @ApiCommonMutationErrors()
  updateStatus(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @ReqContext() context: RequestContext,
    @Body() body: UpdateAccountStatusDto,
  ): Promise<ApiResponsePayload<AdminCustomerResponse>> {
    return this.adminService
      .updateStatus(id, body.status, {
        actorType: AuditActorType.USER,
        actorId: auth.user_id ?? null,
        requestId: context.requestId,
      })
      .then((customer) =>
        ApiResponse.ok(customer, 'Cap nhat trang thai customer thanh cong.'),
      );
  }
}
