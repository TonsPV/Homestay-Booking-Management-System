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
  Roles,
  RolesGuard,
  UpdateAccountStatusDto,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CustomerAdminService } from './customer-admin.service';
import type { AdminCustomerResponse } from './customer-admin.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@Controller('v1/customers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class CustomerAdminController {
  constructor(private readonly customerAdminService: CustomerAdminService) {}

  @Get()
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
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateAccountStatusDto,
  ): Promise<ApiResponsePayload<AdminCustomerResponse>> {
    return this.customerAdminService
      .updateStatus(id, body.status)
      .then((customer) =>
        ApiResponse.ok(customer, 'Cap nhat trang thai customer thanh cong.'),
      );
  }
}
