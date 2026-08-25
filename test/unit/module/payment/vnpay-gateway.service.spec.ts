import { ConfigService } from '@nestjs/config';
import { calculateSecureHash, HashAlgorithm, VNPay } from 'vnpay';

import {
  createVnPaySignature,
  formatVnPayDate,
  parseVnPayDate,
  VnPayGatewayService,
} from '../../../../src/module/payment/vnpay-gateway.service';

describe('VnPayGatewayService', () => {
  const values: Record<string, unknown> = {
    VNPAY_ENABLED: true,
    VNPAY_PAYMENT_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    VNPAY_RETURN_URL: 'http://localhost:3001/api/v1/payments/vnpay/return',
    VNPAY_TMN_CODE: 'TEST0001',
    VNPAY_HASH_SECRET: 'test-vnpay-secret-at-least-16-characters',
    VNPAY_REQUEST_TIMEOUT_MS: 10_000,
  };
  const configService = {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];

      if (value === undefined) {
        throw new Error(`Missing ${key}`);
      }

      return value;
    }),
  } as unknown as ConfigService;
  const service = new VnPayGatewayService(configService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a signed VNPay 2.1.0 payment URL in GMT+7', () => {
    const paymentUrl = service.createPaymentUrl({
      amount: '900000.00',
      transactionReference: 'P123',
      orderInfo: 'Thanh toan booking BK123',
      ipAddress: '::ffff:127.0.0.1',
      locale: 'vn',
      bankCode: 'VNBANK',
      createdAt: new Date('2026-07-23T10:00:00.000Z'),
      expiresAt: new Date('2026-07-23T10:15:00.000Z'),
    });
    const url = new URL(paymentUrl);
    const signature = url.searchParams.get('vnp_SecureHash');
    const parameters = Object.fromEntries(url.searchParams.entries());

    delete parameters.vnp_SecureHash;

    expect(url.origin + url.pathname).toBe(values.VNPAY_PAYMENT_URL);
    expect(parameters).toMatchObject({
      vnp_Amount: '90000000',
      vnp_BankCode: 'VNBANK',
      vnp_CreateDate: '20260723170000',
      vnp_ExpireDate: '20260723171500',
      vnp_IpAddr: '127.0.0.1',
      vnp_TmnCode: 'TEST0001',
      vnp_TxnRef: 'P123',
      vnp_Version: '2.1.0',
    });
    expect(paymentUrl.split('&vnp_SecureHash=')[0]).toBe(
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?' +
        'vnp_Amount=90000000&vnp_BankCode=VNBANK&vnp_Command=pay&' +
        'vnp_CreateDate=20260723170000&vnp_CurrCode=VND&' +
        'vnp_ExpireDate=20260723171500&vnp_IpAddr=127.0.0.1&' +
        'vnp_Locale=vn&vnp_OrderInfo=Thanh+toan+booking+BK123&' +
        'vnp_OrderType=other&' +
        'vnp_ReturnUrl=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fv1%2Fpayments%2Fvnpay%2Freturn&' +
        'vnp_TmnCode=TEST0001&vnp_TxnRef=P123&vnp_Version=2.1.0',
    );
    expect(signature).toBe(
      '627f0de18f167b1c2cea4e872aea3453ee14f150ef0efdd79d361b75205b663' +
        '58128232dcd548d6d2e58e3b1eb76aacb2ae65d6f7b665d05c34cfc22b43f6599',
    );
  });

  it('verifies callbacks and rejects tampered callback data', () => {
    const parameters = {
      vnp_Amount: '90000000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TEST0001',
      vnp_TransactionNo: '123456',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: 'P123',
    };
    const signature = createVnPaySignature(
      parameters,
      values.VNPAY_HASH_SECRET as string,
    );

    expect(
      service.verifyCallback({
        ...parameters,
        vnp_SecureHash: signature,
      }).isValid,
    ).toBe(true);
    expect(
      service.verifyCallback({
        ...parameters,
        vnp_Amount: '1',
        vnp_SecureHash: signature,
      }).isValid,
    ).toBe(false);
  });

  it('normalizes the local IPv6 loopback for VNPay', () => {
    const paymentUrl = service.createPaymentUrl({
      amount: '900000.00',
      transactionReference: 'P124',
      orderInfo: 'Thanh toan booking BK124',
      ipAddress: '::1',
      locale: 'vn',
      bankCode: undefined,
      createdAt: new Date('2026-07-23T10:00:00.000Z'),
      expiresAt: new Date('2026-07-23T10:15:00.000Z'),
    });

    expect(new URL(paymentUrl).searchParams.get('vnp_IpAddr')).toBe(
      '127.0.0.1',
    );
  });

  it('formats and parses VNPay dates without changing timezone meaning', () => {
    const value = new Date('2026-07-23T10:15:30.000Z');
    const formatted = formatVnPayDate(value);

    expect(formatted).toBe('20260723171530');
    expect(parseVnPayDate(formatted)?.toISOString()).toBe(
      '2026-07-23T10:15:30.000Z',
    );
    expect(parseVnPayDate('20260230000000')).toBeNull();
  });

  it('sends a full refund with the original transaction metadata', async () => {
    const response = createSignedRefundResponse({
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '987654321012345',
      vnp_TransactionType: '02',
      vnp_Amount: 90000000,
      vnp_ResponseId: 'REFUND-1',
      vnp_TxnRef: 'P123',
      vnp_OrderInfo: 'Hoan tien booking BK123',
    });
    const fetchSpy = mockRefundFetch(response);

    await expect(
      service.refundFull({
        amount: '900000.00',
        transactionReference: 'P123',
        transactionId: '123456789012345',
        transactionDate: '20260723170000',
        requestId: 'R12345678',
        orderInfo: 'Hoan tien booking BK123',
        ipAddress: '::1',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
        createdBy: 'user-1',
      }),
    ).resolves.toMatchObject({
      isVerified: true,
      isSuccess: true,
      responseCode: '00',
      transactionStatus: '00',
      transactionId: '987654321012345',
      transactionType: '02',
      amount: '90000000',
      responseId: 'REFUND-1',
    });

    const request = getRefundRequestBody(fetchSpy);

    expect(request).toMatchObject({
      vnp_Amount: 90000000,
      vnp_Command: 'refund',
      vnp_CreateBy: 'user-1',
      vnp_CreateDate: 20260724170000,
      vnp_IpAddr: '127.0.0.1',
      vnp_OrderInfo: 'Hoan tien booking BK123',
      vnp_RequestId: 'R12345678',
      vnp_TransactionDate: 20260723170000,
      vnp_TransactionNo: 123456789012345,
      vnp_TransactionType: '02',
      vnp_TxnRef: 'P123',
      vnp_TmnCode: 'TEST0001',
      vnp_Version: '2.1.0',
    });
    expect(request.vnp_SecureHash).toMatch(/^[0-9a-f]{128}$/);
  });

  it('verifies the unmodified refund response from VNPay', async () => {
    const response = createSignedRefundResponse({
      vnp_ResponseId: 'REFUND-PENDING-1',
      vnp_ResponseCode: '00',
      vnp_TxnRef: 'P123',
      vnp_Amount: 30000000,
      vnp_TransactionNo: '987654321012345',
      vnp_TransactionType: '02',
      vnp_TransactionStatus: '05',
      vnp_OrderInfo: 'Refund booking BK123',
    });
    mockRefundFetch(response);

    await expect(
      service.refundFull({
        amount: '300000.00',
        transactionReference: 'P123',
        transactionId: '123456789012345',
        transactionDate: '20260723170000',
        requestId: 'R12345679',
        orderInfo: 'Refund booking BK123',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
        createdBy: 'user-1',
      }),
    ).resolves.toMatchObject({
      isVerified: true,
      isSuccess: true,
      responseCode: '00',
      transactionStatus: '05',
      transactionType: '02',
      amount: '30000000',
    });
  });

  it('rejects a refund response whose signed data was modified', async () => {
    const response = createSignedRefundResponse({
      vnp_TransactionStatus: '05',
    });

    response.vnp_Amount = 40000000;
    mockRefundFetch(response);

    await expect(
      service.refundFull({
        amount: '300000.00',
        transactionReference: 'P123',
        transactionId: '123456789012345',
        transactionDate: '20260723170000',
        requestId: 'R12345680',
        orderInfo: 'Refund booking BK123',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
        createdBy: 'user-1',
      }),
    ).resolves.toMatchObject({
      isVerified: false,
      responseCode: '00',
      transactionStatus: '05',
      amount: '40000000',
    });
  });

  it.each([
    ['transaction reference', { vnp_TxnRef: 'P999' }],
    ['merchant code', { vnp_TmnCode: 'OTHER001' }],
  ])(
    'rejects a correctly signed refund response with a mismatched %s',
    async (_field, overrides) => {
      mockRefundFetch(createSignedRefundResponse(overrides));

      await expect(
        service.refundFull({
          amount: '300000.00',
          transactionReference: 'P123',
          transactionId: '123456789012345',
          transactionDate: '20260723170000',
          requestId: 'R12345681',
          orderInfo: 'Refund booking BK123',
          ipAddress: '127.0.0.1',
          createdAt: new Date('2026-07-24T10:00:00.000Z'),
          createdBy: 'user-1',
        }),
      ).resolves.toMatchObject({ isVerified: false });
    },
  );

  it('queries VNPay using the original payment transaction date', async () => {
    const querySpy = jest.spyOn(VNPay.prototype, 'queryDr').mockResolvedValue({
      isVerified: true,
      isSuccess: true,
      message: 'Query successful',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '123456789012345',
      vnp_TransactionType: '02',
      vnp_Amount: 90000000,
      vnp_ResponseId: 'QUERY-1',
      vnp_TmnCode: 'TEST0001',
      vnp_TxnRef: 'P123',
      vnp_SecureHash: 'SIGNED-QUERY-RESPONSE',
    } as never);

    await expect(
      service.queryTransaction({
        amount: '900000.00',
        transactionReference: 'P123',
        transactionId: '123456789012345',
        transactionDate: '20260723170000',
        requestId: 'Q12345678',
        orderInfo: 'Doi soat refund payment 123',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      isVerified: true,
      responseCode: '00',
      transactionType: '02',
      amount: '90000000',
    });

    expect(querySpy).toHaveBeenCalledWith({
      vnp_CreateDate: 20260724170000,
      vnp_IpAddr: '127.0.0.1',
      vnp_OrderInfo: 'Doi soat refund payment 123',
      vnp_RequestId: 'Q12345678',
      vnp_TransactionDate: 20260723170000,
      vnp_TransactionNo: 123456789012345,
      vnp_TxnRef: 'P123',
    });
  });

  it('rejects an unsigned QueryDr response even when the client marks it verified', async () => {
    jest.spyOn(VNPay.prototype, 'queryDr').mockResolvedValue({
      isVerified: true,
      isSuccess: true,
      message: 'Query successful',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '123456789012345',
      vnp_TransactionType: '02',
      vnp_Amount: 90000000,
      vnp_ResponseId: 'QUERY-UNSIGNED',
      vnp_TmnCode: 'TEST0001',
      vnp_TxnRef: 'P123',
    } as never);

    await expect(
      service.queryTransaction({
        amount: '900000.00',
        transactionReference: 'P123',
        transactionId: '123456789012345',
        transactionDate: '20260723170000',
        requestId: 'Q12345670',
        orderInfo: 'Doi soat refund payment 123',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ isVerified: false });
  });

  it('applies a finite deadline when QueryDr does not settle', async () => {
    jest.useFakeTimers();

    try {
      jest
        .spyOn(VNPay.prototype, 'queryDr')
        .mockReturnValue(new Promise(() => undefined) as never);

      const query = service.queryTransaction({
        amount: '900000.00',
        transactionReference: 'P123',
        transactionId: '123456789012345',
        transactionDate: '20260723170000',
        requestId: 'Q12345671',
        orderInfo: 'Doi soat refund payment 123',
        ipAddress: '127.0.0.1',
        createdAt: new Date('2026-07-24T10:00:00.000Z'),
      });
      const rejection = expect(query).rejects.toThrow(
        'VNPay request timed out.',
      );

      await jest.advanceTimersByTimeAsync(10_000);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['transaction reference', { vnp_TxnRef: 'P999' }],
    ['merchant code', { vnp_TmnCode: 'OTHER001' }],
  ])(
    'rejects a verified query response with a mismatched %s',
    async (_field, overrides) => {
      jest.spyOn(VNPay.prototype, 'queryDr').mockResolvedValue({
        isVerified: true,
        isSuccess: true,
        message: 'Query successful',
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_TransactionNo: '123456789012345',
        vnp_TransactionType: '02',
        vnp_Amount: 90000000,
        vnp_ResponseId: 'QUERY-2',
        vnp_TmnCode: 'TEST0001',
        vnp_TxnRef: 'P123',
        vnp_SecureHash: 'SIGNED-QUERY-RESPONSE',
        ...overrides,
      } as never);

      await expect(
        service.queryTransaction({
          amount: '900000.00',
          transactionReference: 'P123',
          transactionId: '123456789012345',
          transactionDate: '20260723170000',
          requestId: 'Q12345679',
          orderInfo: 'Doi soat refund payment 123',
          ipAddress: '127.0.0.1',
          createdAt: new Date('2026-07-24T10:00:00.000Z'),
        }),
      ).resolves.toMatchObject({ isVerified: false });
    },
  );

  it('rejects invalid transaction metadata before calling VNPay', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(
      service.refundFull({
        amount: '900000.00',
        transactionReference: 'P123',
        transactionId: 'not-a-number',
        transactionDate: '20260723170000',
        requestId: 'R12345678',
        orderInfo: 'Hoan tien booking BK123',
        ipAddress: undefined,
        createdAt: new Date(),
        createdBy: 'user-1',
      }),
    ).rejects.toThrow('VNPay transaction number is invalid.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function createSignedRefundResponse(
  overrides: Partial<Record<string, string | number>>,
): Record<string, string | number> {
  const response: Record<string, string | number> = {
    vnp_ResponseId: 'REFUND-RESPONSE',
    vnp_Command: 'refund',
    vnp_ResponseCode: '00',
    vnp_Message: 'Request successful',
    vnp_TmnCode: 'TEST0001',
    vnp_TxnRef: 'P123',
    vnp_Amount: 30000000,
    vnp_BankCode: 'NCB',
    vnp_PayDate: 20260724203000,
    vnp_TransactionNo: '987654321012345',
    vnp_TransactionType: '02',
    vnp_TransactionStatus: '05',
    vnp_OrderInfo: 'Refund booking BK123',
    ...overrides,
  };
  const signData = [
    response.vnp_ResponseId,
    response.vnp_Command,
    response.vnp_ResponseCode,
    response.vnp_Message,
    response.vnp_TmnCode,
    response.vnp_TxnRef,
    response.vnp_Amount,
    response.vnp_BankCode,
    response.vnp_PayDate,
    response.vnp_TransactionNo,
    response.vnp_TransactionType,
    response.vnp_TransactionStatus,
    response.vnp_OrderInfo,
  ].join('|');

  response.vnp_SecureHash = calculateSecureHash({
    secureSecret: 'test-vnpay-secret-at-least-16-characters',
    data: signData,
    hashAlgorithm: HashAlgorithm.SHA512,
    bufferEncode: 'utf8',
  });

  return response;
}

function mockRefundFetch(
  response: Record<string, string | number>,
): jest.SpiedFunction<typeof fetch> {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(response),
  } as Response);
}

function getRefundRequestBody(
  fetchSpy: jest.SpiedFunction<typeof fetch>,
): Record<string, string | number> {
  const options = fetchSpy.mock.calls[0][1];

  if (options === undefined || typeof options.body !== 'string') {
    throw new Error('VNPay refund request body was not sent.');
  }

  return JSON.parse(options.body) as Record<string, string | number>;
}
