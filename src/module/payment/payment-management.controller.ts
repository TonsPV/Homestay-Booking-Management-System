import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  type ApiResponsePayload,
  type AccessTokenPayload,
  CurrentAuth,
  ReqContext,
  type RequestContext,
  Roles,
  RolesGuard,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiCreatedEnvelope,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import {
  PaymentDto,
  PaymentManagementMetaDto,
} from './dto/payment-response.dto';
import { PaymentService, type PaymentResponse } from './payment.service';
import { PaymentStatus } from './schema/payment.entity';
import { PaymentMethod } from './schema/payment.entity';

@Controller('v1/management')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiCommonAuthErrors()
export class PaymentManagementController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('payments')
  @ApiOkEnvelope(PaymentDto, {
    isArray: true,
    metaModel: PaymentManagementMetaDto,
    paginated: true,
  })
  listAll(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<ApiResponsePayload<PaymentResponse[]>> {
    return this.paymentService
      .listAllManagement(
        query,
        auth.role === 'STAFF'
          ? [PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER]
          : undefined,
      )
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach payment quan ly thanh cong.',
          result.meta,
        ),
      );
  }

  @Get('bookings/:bookingId/payments')
  @ApiOkEnvelope(PaymentDto, { isArray: true, paginated: true })
  list(
    @Param('bookingId') bookingId: string,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<ApiResponsePayload<PaymentResponse[]>> {
    return this.paymentService
      .listManagement(bookingId, query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay lich su thanh toan quan ly thanh cong.',
          result.meta,
        ),
      );
  }

  @Post('bookings/:bookingId/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(PaymentDto)
  @ApiCommonMutationErrors()
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateManualPaymentDto,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .recordManualPayment(auth.user_id, bookingId, idempotencyKey, body)
      .then((payment) =>
        ApiResponse.created(payment, 'Ghi nhan thanh toan thanh cong.'),
      );
  }

  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOkEnvelope(PaymentDto)
  @ApiCommonMutationErrors()
  refund(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ReqContext() context: RequestContext,
    @Body() body: RefundPaymentDto,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .refund(auth.user_id, id, idempotencyKey, context.ip, body)
      .then((payment) =>
        ApiResponse.ok(
          payment,
          payment.status === PaymentStatus.REFUND_PENDING
            ? 'Yeu cau refund da duoc ghi nhan. VNPay van dang xu ly.'
            : 'Hoan tien thanh cong.',
        ),
      );
  }

  @Post('payments/:id/reconcile-refund')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOkEnvelope(PaymentDto)
  @ApiCommonMutationErrors()
  reconcileRefund(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @ReqContext() context: RequestContext,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .reconcileVnPayRefund(auth.user_id, id, context.ip)
      .then((payment) =>
        ApiResponse.ok(
          payment,
          payment.status === PaymentStatus.REFUNDED
            ? 'Doi soat xac nhan refund VNPay da hoan tat.'
            : 'Doi soat thanh cong. VNPay van dang xu ly refund.',
        ),
      );
  }
}
