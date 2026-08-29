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
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
  ReqContext,
  type RequestContext,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiCreatedEnvelope,
  ApiExternalServiceUnavailableError,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import {
  PaymentDto,
  PaymentManagementMetaDto,
} from './dto/payment-response.dto';
import { PaymentService, type PaymentResponse } from './payment.service';
import { PaymentStatus } from './domain/payment-state';
import { PaymentMethod } from './domain/payment-state';

@Controller('v1/management')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiBearerAuth()
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key for this manual payment request.',
  })
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ReqContext() context: RequestContext,
    @Body() body: CreateManualPaymentDto,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .recordManualPayment(
        auth.user_id,
        bookingId,
        idempotencyKey,
        body,
        context.requestId,
      )
      .then((payment) =>
        ApiResponse.created(payment, 'Ghi nhan thanh toan thanh cong.'),
      );
  }

  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOkEnvelope(PaymentDto)
  @ApiCommonMutationErrors()
  @ApiExternalServiceUnavailableError()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Required for VNPay refunds; manual refunds are lock-idempotent.',
  })
  refund(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ReqContext() context: RequestContext,
    @Body() body: RefundPaymentDto,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .refund(
        auth.user_id,
        id,
        idempotencyKey,
        context.ip,
        body,
        context.requestId,
      )
      .then((payment) =>
        ApiResponse.ok(
          payment,
          payment.status === PaymentStatus.REFUND_PENDING
            ? 'Yeu cau refund da duoc ghi nhan. VNPay van dang xu ly.'
            : 'Hoan tien thanh cong.',
        ),
      );
  }

  @Post('payments/:id/resolve-duplicate-charge')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOkEnvelope(PaymentDto)
  @ApiCommonMutationErrors()
  @ApiExternalServiceUnavailableError()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key for this duplicate VNPay charge resolution.',
  })
  resolveDuplicateCharge(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ReqContext() context: RequestContext,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .resolveDuplicateCharge(
        auth.user_id,
        id,
        idempotencyKey,
        context.ip,
        context.requestId,
      )
      .then((payment) =>
        ApiResponse.ok(
          payment,
          payment.status === PaymentStatus.REFUND_PENDING
            ? 'Yeu cau refund giao dich trung da duoc ghi nhan. VNPay van dang xu ly.'
            : 'Hoan tien giao dich trung thanh cong.',
        ),
      );
  }

  @Post('payments/:id/reconcile-refund')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOkEnvelope(PaymentDto)
  @ApiCommonMutationErrors()
  @ApiExternalServiceUnavailableError()
  reconcileRefund(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @ReqContext() context: RequestContext,
  ): Promise<ApiResponsePayload<PaymentResponse>> {
    return this.paymentService
      .reconcileVnPayRefund(auth.user_id, id, context.ip, context.requestId)
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
