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

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import { PaymentService, type VnPayReturnResponse } from './payment.service';

@Controller('v1/payments/vnpay')
export class VnPayController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('ipn')
  @HttpCode(HttpStatus.OK)
  async ipn(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.paymentService.handleVnPayIpn(query);

    response.status(HttpStatus.OK).json(result);
  }

  @Get('return')
  async getReturn(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiResponsePayload<VnPayReturnResponse>> {
    const result = await this.paymentService.handleVnPayReturn(query);
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
