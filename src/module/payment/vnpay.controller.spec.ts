import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { PaymentService, type VnPayReturnResponse } from './payment.service';
import { PaymentStatus } from './schema/payment.entity';
import { VnPayController } from './vnpay.controller';

describe('VnPayController', () => {
  const returnResult: VnPayReturnResponse = {
    validSignature: true,
    paymentId: '13',
    bookingId: '42',
    paymentStatus: PaymentStatus.SUCCESS,
    responseCode: '00',
    transactionStatus: '00',
  };

  function createController(frontendReturnUrl: string | undefined): {
    controller: VnPayController;
    response: Response;
    status: jest.Mock;
    location: jest.Mock;
    getRedirectLocation: () => string | undefined;
  } {
    const paymentService = {
      handleVnPayReturn: jest.fn().mockResolvedValue(returnResult),
    } as unknown as PaymentService;
    const configService = {
      get: jest.fn().mockReturnValue(frontendReturnUrl),
    } as unknown as ConfigService;
    const status = jest.fn();
    let redirectLocation: string | undefined;
    const location = jest.fn((url: string) => {
      redirectLocation = url;
    });
    const responseValue = { status, location };

    status.mockReturnValue(responseValue);

    return {
      controller: new VnPayController(paymentService, configService),
      response: responseValue as unknown as Response,
      status,
      location,
      getRedirectLocation: () => redirectLocation,
    };
  }

  it('keeps returning the API payload when no frontend URL is configured', async () => {
    const { controller, response, status, location } =
      createController(undefined);

    const payload = await controller.getReturn({}, response);

    expect(payload.data).toEqual(returnResult);
    expect(status).not.toHaveBeenCalled();
    expect(location).not.toHaveBeenCalled();
  });

  it('redirects the browser to the configured frontend result page', async () => {
    const { controller, response, status, location, getRedirectLocation } =
      createController('http://localhost:5173/payment-result');

    const payload = await controller.getReturn({}, response);
    const redirectLocation = getRedirectLocation();

    if (redirectLocation === undefined) {
      throw new Error('Frontend redirect URL was not set.');
    }

    const redirectUrl = new URL(redirectLocation);

    expect(payload.data).toEqual(returnResult);
    expect(status).toHaveBeenCalledWith(HttpStatus.FOUND);
    expect(location).toHaveBeenCalledTimes(1);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(
      'http://localhost:5173/payment-result',
    );
    expect(Object.fromEntries(redirectUrl.searchParams)).toEqual({
      validSignature: 'true',
      paymentId: '13',
      bookingId: '42',
      paymentStatus: 'SUCCESS',
      responseCode: '00',
      transactionStatus: '00',
    });
  });
});
