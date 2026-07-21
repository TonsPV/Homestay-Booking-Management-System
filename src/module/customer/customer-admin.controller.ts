import {
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
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CustomerAdminService } from './customer-admin.service';
import type { AdminCustomerResponse } from './customer-admin.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';

@Controller('v1/admin/customers')
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

  @Patch(':id/lock')
  lockCustomer(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminCustomerResponse>> {
    return this.customerAdminService
      .lockCustomer(id)
      .then((customer) =>
        ApiResponse.ok(customer, 'Khoa customer thanh cong.'),
      );
  }

  @Patch(':id/unlock')
  unlockCustomer(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminCustomerResponse>> {
    return this.customerAdminService
      .unlockCustomer(id)
      .then((customer) =>
        ApiResponse.ok(customer, 'Mo khoa customer thanh cong.'),
      );
  }
}
