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
import { Actors } from '../auth/decorators/actors.decorator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { ActorsGuard } from '../auth/guards/actors.guard';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import {
  CustomerPaymentDto,
  OnlinePaymentDto,
} from './dto/payment-response.dto';
import {
  type CustomerPaymentResponse,
  type OnlinePaymentResponse,
  PaymentService,
} from './payment.service';

@Controller('v1/bookings/:bookingId/payments')
@UseGuards(AccessTokenGuard, ActorsGuard)
@Actors('customer')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(OnlinePaymentDto)
  @ApiCommonMutationErrors()
  @ApiExternalServiceUnavailableError()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key for this payment creation request.',
  })
  createVnPayPayment(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('bookingId') bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ReqContext() context: RequestContext,
    @Body() body: CreateVnpayPaymentDto,
  ): Promise<ApiResponsePayload<OnlinePaymentResponse>> {
    return this.paymentService
      .createVnPayPayment(
        auth.customer_id,
        bookingId,
        idempotencyKey,
        context.ip,
        body,
      )
      .then((payment) =>
        ApiResponse.created(payment, 'Tao giao dich VNPay thanh cong.'),
      );
  }

  @Get()
  @ApiOkEnvelope(CustomerPaymentDto, { isArray: true, paginated: true })
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('bookingId') bookingId: string,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<ApiResponsePayload<CustomerPaymentResponse[]>> {
    return this.paymentService
      .listForCustomer(auth.customer_id, bookingId, query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay lich su thanh toan thanh cong.',
          result.meta,
        ),
      );
  }
}
