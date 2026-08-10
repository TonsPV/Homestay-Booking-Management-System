import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  ApiResponsePayload,
  type AccessTokenPayload,
  CurrentAuth,
  ReqContext,
  type RequestContext,
  Roles,
  RolesGuard,
  UpdateAccountStatusDto,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AuditActorType } from '../audit/schema/audit-log.entity';
import { CustomerAdminService } from './customer-admin.service';
import type { AdminCustomerResponse } from './customer-admin.service';
import { AdminCustomerDto } from './dto/admin-customer-response.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@Controller('v1/customers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@ApiCommonAuthErrors()
export class CustomerAdminController {
  constructor(private readonly customerAdminService: CustomerAdminService) {}

  @Get()
  @ApiOkEnvelope(AdminCustomerDto, { isArray: true, paginated: true })
  listCustomers(
    @Query() query: ListCustomersQueryDto,
  ): Promise<ApiResponsePayload<AdminCustomerResponse[]>> {
    return this.customerAdminService
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
    return this.customerAdminService
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
