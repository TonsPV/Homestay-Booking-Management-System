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
  Actors,
  ActorsGuard,
  ApiResponse,
  type ApiResponsePayload,
  type AccessTokenPayload,
  CurrentAuth,
  ReqContext,
  type RequestContext,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import {
  type OnlinePaymentResponse,
  PaymentService,
  type PaymentResponse,
} from './payment.service';

@Controller('v1/bookings/:bookingId/payments')
@UseGuards(AccessTokenGuard, ActorsGuard)
@Actors('customer')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
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
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('bookingId') bookingId: string,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<ApiResponsePayload<PaymentResponse[]>> {
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
