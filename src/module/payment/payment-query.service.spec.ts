import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { FindOperator, Repository } from 'typeorm';

import { Booking } from '../booking/schema/booking.entity';
import { PaymentQueryService } from './payment-query.service';
import { Payment, PaymentMethod, PaymentStatus } from './schema/payment.entity';

describe('PaymentQueryService', () => {
  let paymentQuery: ReturnType<typeof createPaymentQuery>;
  let paymentsRepository: {
    createQueryBuilder: jest.Mock;
    countBy: jest.Mock;
  };
  let bookingsRepository: {
    findOneBy: jest.Mock;
    exists: jest.Mock;
  };
  let service: PaymentQueryService;

  beforeEach(() => {
    paymentQuery = createPaymentQuery();
    paymentsRepository = {
      createQueryBuilder: jest.fn(() => paymentQuery),
      countBy: jest.fn(),
    };
    bookingsRepository = {
      findOneBy: jest.fn(),
      exists: jest.fn(),
    };
    service = new PaymentQueryService(
      paymentsRepository as unknown as Repository<Payment>,
      bookingsRepository as unknown as Repository<Booking>,
    );
  });

  it('scopes a customer list to an owned booking', async () => {
    const payment = paymentFixture({
      gatewayName: 'VNPAY',
      gatewayReference: 'P500',
      gatewayTransactionId: 'internal-transaction',
      refundRequestId: 'internal-refund-request',
      createdByUserId: '20',
      createdByUser: {
        id: '20',
        fullName: 'Internal Operator',
      },
    });
    bookingsRepository.findOneBy.mockResolvedValue({
      id: '100',
      customerId: '10',
    });
    paymentQuery.getManyAndCount.mockResolvedValue([[payment], 1]);

    await expect(
      service.listForCustomer('10', '100', {
        page: 2,
        limit: 5,
        status: PaymentStatus.SUCCESS,
        method: PaymentMethod.CASH,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: '500',
          bookingId: '100',
          amount: '2000000.00',
          currency: 'VND',
          method: PaymentMethod.CASH,
          status: PaymentStatus.SUCCESS,
          gatewayReference: 'P500',
          paidAt: new Date('2030-01-01T00:00:00.000Z'),
          refundedAt: null,
          expiresAt: null,
          createdAt: new Date('2030-01-01T00:00:00.000Z'),
          updatedAt: new Date('2030-01-01T00:00:00.000Z'),
        },
      ],
      meta: {
        pagination: { page: 2, limit: 5, total: 1, totalPages: 1 },
      },
    });

    expect(paymentQuery.leftJoinAndSelect).not.toHaveBeenCalled();
    expect(paymentQuery.andWhere).toHaveBeenCalledWith(
      'payment.bookingId = :bookingId',
      { bookingId: '100' },
    );
    expect(paymentQuery.andWhere).toHaveBeenCalledWith(
      'payment.status = :status',
      { status: PaymentStatus.SUCCESS },
    );
    expect(paymentQuery.andWhere).toHaveBeenCalledWith(
      'payment.method = :method',
      { method: PaymentMethod.CASH },
    );
  });

  it('hides another customer booking as not found', async () => {
    bookingsRepository.findOneBy.mockResolvedValue({
      id: '100',
      customerId: '11',
    });

    await expect(
      service.listForCustomer('10', '100', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(paymentsRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects a missing customer actor before querying', async () => {
    await expect(
      service.listForCustomer(undefined, '100', {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(bookingsRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('requires the booking to exist for a management-scoped list', async () => {
    bookingsRepository.exists.mockResolvedValue(false);

    await expect(service.listManagement('100', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(paymentsRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('adds the stale refund count to the all-management list metadata', async () => {
    paymentsRepository.countBy.mockResolvedValue(2);
    paymentQuery.getManyAndCount.mockResolvedValue([[paymentFixture()], 1]);

    await expect(
      service.listAllManagement({ limit: 20, page: 1 }),
    ).resolves.toMatchObject({
      items: [{ id: '500' }],
      meta: {
        pagination: { limit: 20, page: 1, total: 1, totalPages: 1 },
        staleRefundCount: 2,
      },
    });
  });

  it('limits the staff payment feed to manual methods without refund metadata', async () => {
    paymentQuery.getManyAndCount.mockResolvedValue([[paymentFixture()], 1]);

    await expect(
      service.listAllManagement({ limit: 20, page: 1 }, [
        PaymentMethod.CASH,
        PaymentMethod.BANK_TRANSFER,
      ]),
    ).resolves.toMatchObject({
      meta: { staleRefundCount: 0 },
    });

    expect(paymentQuery.andWhere).toHaveBeenCalledWith(
      'payment.method IN (:...allowedMethods)',
      { allowedMethods: [PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER] },
    );
    expect(paymentsRepository.countBy).not.toHaveBeenCalled();
  });

  it('returns no rows when staff requests VNPay explicitly', async () => {
    paymentQuery.getManyAndCount.mockResolvedValue([[], 0]);

    await service.listAllManagement({ method: PaymentMethod.VNPAY }, [
      PaymentMethod.CASH,
      PaymentMethod.BANK_TRANSFER,
    ]);

    expect(paymentQuery.andWhere).toHaveBeenCalledWith('1 = 0');
  });

  it('returns a mapped management payment detail and rejects a missing id', async () => {
    paymentQuery.getOne.mockResolvedValueOnce(
      paymentFixture({
        gatewayTransactionId: 'gateway-transaction-500',
        refundRequestId: 'refund-request-500',
        createdByUserId: '20',
        createdByUser: {
          id: '20',
          fullName: 'Internal Operator',
        },
      }),
    );

    await expect(service.getManagementPayment('500')).resolves.toMatchObject({
      id: '500',
      method: PaymentMethod.CASH,
      status: PaymentStatus.SUCCESS,
      gatewayTransactionId: 'gateway-transaction-500',
      refundRequestId: 'refund-request-500',
      createdByUserId: '20',
      createdByUser: {
        id: '20',
        fullName: 'Internal Operator',
      },
      refundedByUser: null,
    });
    expect(paymentQuery.leftJoinAndSelect).toHaveBeenCalledWith(
      'payment.createdByUser',
      'createdByUser',
    );

    paymentQuery.getOne.mockResolvedValueOnce(null);
    await expect(service.getManagementPayment('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('counts refunds pending for more than seven days', async () => {
    paymentsRepository.countBy.mockResolvedValue(3);
    const now = new Date('2030-01-08T00:00:00.000Z');

    await expect(service.countStaleRefunds(now)).resolves.toBe(3);
    const countCalls = paymentsRepository.countBy.mock
      .calls as unknown as Array<
      [
        {
          status: PaymentStatus;
          refundRequestedAt: FindOperator<Date>;
        },
      ]
    >;

    expect(countCalls[0]?.[0].status).toBe(PaymentStatus.REFUND_PENDING);
    expect(countCalls[0]?.[0].refundRequestedAt.value).toEqual(
      new Date('2030-01-01T00:00:00.000Z'),
    );
  });
});

function createPaymentQuery() {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
}

function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '500',
    bookingId: '100',
    amount: '2000000.00',
    currency: 'VND',
    method: PaymentMethod.CASH,
    status: PaymentStatus.SUCCESS,
    reviewReason: null,
    reviewCanonicalPaymentId: null,
    gatewayName: null,
    gatewayReference: null,
    gatewayTransactionId: null,
    gatewayPaymentUrl: null,
    gatewayResponseCode: null,
    gatewayTransactionStatus: null,
    gatewayTransactionDate: null,
    idempotencyKey: 'manual-key-0001',
    refundIdempotencyKey: null,
    refundRequestId: null,
    refundPreviousStatus: null,
    refundGatewayTransactionId: null,
    refundResponseCode: null,
    refundTransactionStatus: null,
    refundMessage: null,
    refundReason: null,
    createdByUserId: '20',
    createdByUser: null,
    refundedByUserId: null,
    refundedByUser: null,
    paidAt: new Date('2030-01-01T00:00:00.000Z'),
    refundedAt: null,
    refundRequestedAt: null,
    refundLastQueriedAt: null,
    expiresAt: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as Payment;
}
