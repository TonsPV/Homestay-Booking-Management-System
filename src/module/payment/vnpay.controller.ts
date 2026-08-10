import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
  ReqContext,
  type RequestContext,
} from '../../common/http';
import {
  ApiFoundEnvelope,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { VnPayIpnDto, VnPayReturnDto } from './dto/payment-response.dto';
import { PaymentService, type VnPayReturnResponse } from './payment.service';

@Controller('v1/payments/vnpay')
export class VnPayController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('ipn')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Raw VNPay IPN acknowledgement (not wrapped).',
    type: VnPayIpnDto,
  })
  @ApiQuery({ name: 'vnp_TmnCode', required: true, type: String })
  @ApiQuery({ name: 'vnp_TxnRef', required: true, type: String })
  @ApiQuery({ name: 'vnp_Amount', required: true, type: String })
  @ApiQuery({ name: 'vnp_ResponseCode', required: true, type: String })
  @ApiQuery({ name: 'vnp_TransactionStatus', required: true, type: String })
  @ApiQuery({ name: 'vnp_TransactionNo', required: true, type: String })
  @ApiQuery({
    name: 'vnp_PayDate',
    required: false,
    type: String,
    description: 'Required for a successful transaction (yyyyMMddHHmmss).',
  })
  @ApiQuery({ name: 'vnp_SecureHash', required: true, type: String })
  async ipn(
    @Query() query: Record<string, unknown>,
    @ReqContext() context: RequestContext,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.paymentService.handleVnPayIpn(
      query,
      context.requestId,
    );

    response.status(HttpStatus.OK).json(result);
  }

  @Get('return')
  @ApiOkEnvelope(VnPayReturnDto)
  @ApiFoundEnvelope(VnPayReturnDto, {
    description:
      'Redirect response with the verification envelope when VNPAY_FRONTEND_RETURN_URL is configured.',
  })
  @ApiQuery({ name: 'vnp_TmnCode', required: true, type: String })
  @ApiQuery({ name: 'vnp_TxnRef', required: true, type: String })
  @ApiQuery({ name: 'vnp_Amount', required: true, type: String })
  @ApiQuery({ name: 'vnp_ResponseCode', required: true, type: String })
  @ApiQuery({ name: 'vnp_TransactionStatus', required: true, type: String })
  @ApiQuery({ name: 'vnp_TransactionNo', required: true, type: String })
  @ApiQuery({
    name: 'vnp_PayDate',
    required: false,
    type: String,
    description: 'Required for a successful transaction (yyyyMMddHHmmss).',
  })
  @ApiQuery({ name: 'vnp_SecureHash', required: true, type: String })
  async getReturn(
    @Query() query: Record<string, unknown>,
    @ReqContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponsePayload<VnPayReturnResponse>> {
    const result = await this.paymentService.handleVnPayReturn(
      query,
      context.requestId,
    );
    const frontendReturnUrl = this.configService.get<string>(
      'VNPAY_FRONTEND_RETURN_URL',
    );

    if (frontendReturnUrl !== undefined && frontendReturnUrl.length > 0) {
      response.status(HttpStatus.FOUND);
      response.location(
        createVnPayFrontendReturnUrl(frontendReturnUrl, result),
      );
    }

    return ApiResponse.ok(result, 'Xac minh ket qua VNPay thanh cong.');
  }
}

export function createVnPayFrontendReturnUrl(
  frontendReturnUrl: string,
  result: VnPayReturnResponse,
): string {
  const redirectUrl = new URL(frontendReturnUrl);

  redirectUrl.searchParams.set('validSignature', String(result.validSignature));
  appendSearchParameter(redirectUrl, 'paymentId', result.paymentId);
  appendSearchParameter(redirectUrl, 'bookingId', result.bookingId);
  appendSearchParameter(redirectUrl, 'paymentStatus', result.paymentStatus);
  appendSearchParameter(redirectUrl, 'responseCode', result.responseCode);
  appendSearchParameter(
    redirectUrl,
    'transactionStatus',
    result.transactionStatus,
  );

  return redirectUrl.toString();
}

function appendSearchParameter(
  url: URL,
  key: string,
  value: string | null,
): void {
  if (value !== null) {
    url.searchParams.set(key, value);
  }
}
