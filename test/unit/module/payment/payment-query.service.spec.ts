import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { Booking } from '../../../../src/module/booking/schema/booking.entity';
import { PaymentQueryService } from '../../../../src/module/payment/payment-query.service';
import { Payment } from '../../../../src/module/payment/schema/payment.entity';
import { PaymentRefund } from '../../../../src/module/payment/schema/payment-refund.entity';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../../src/module/payment/domain/payment-state';

describe('PaymentQueryService', () => {
  let paymentQuery: ReturnType<typeof createPaymentQuery>;
  let paymentsRepository: {
    createQueryBuilder: jest.Mock;
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
      refund: refundFixture({ requestId: 'internal-refund-request' }),
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

    expect(paymentQuery.leftJoinAndSelect).toHaveBeenCalledWith(
      'payment.refund',
      'refund',
    );
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
    paymentQuery.getCount.mockResolvedValue(2);
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
    expect(paymentQuery.getCount).not.toHaveBeenCalled();
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
        refund: refundFixture({ requestId: 'refund-request-500' }),
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
    expect(paymentQuery.leftJoinAndSelect).toHaveBeenCalledWith(
      'payment.refund',
      'refund',
    );

    paymentQuery.getOne.mockResolvedValueOnce(null);
    await expect(service.getManagementPayment('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('counts refunds pending for more than seven days', async () => {
    paymentQuery.getCount.mockResolvedValue(3);
    const now = new Date('2030-01-08T00:00:00.000Z');

    await expect(service.countStaleRefunds(now)).resolves.toBe(3);
    expect(paymentQuery.innerJoin).toHaveBeenCalledWith(
      'payment.refund',
      'refund',
    );
    expect(paymentQuery.where).toHaveBeenCalledWith(
      'payment.status = :status',
      { status: PaymentStatus.REFUND_PENDING },
    );
    expect(paymentQuery.andWhere).toHaveBeenCalledWith(
      'refund.requestedAt < :cutoff',
      { cutoff: new Date('2030-01-01T00:00:00.000Z') },
    );
  });
});

function createPaymentQuery() {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getCount: jest.fn(),
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
    refund: null,
    createdByUserId: '20',
    createdByUser: null,
    paidAt: new Date('2030-01-01T00:00:00.000Z'),
    expiresAt: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as Payment;
}

function refundFixture(overrides: Partial<PaymentRefund> = {}): PaymentRefund {
  return {
    id: '900',
    paymentId: '500',
    payment: null,
    idempotencyKey: null,
    requestId: null,
    previousPaymentStatus: null,
    gatewayTransactionId: null,
    responseCode: null,
    transactionStatus: null,
    message: null,
    reason: null,
    refundedByUserId: null,
    refundedByUser: null,
    requestedAt: null,
    refundedAt: null,
    lastQueriedAt: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as PaymentRefund;
}
