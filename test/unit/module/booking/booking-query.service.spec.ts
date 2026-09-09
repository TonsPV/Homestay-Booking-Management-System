import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import { Payment } from '../../../../src/module/payment/schema/payment.entity';
import { BookingQueryService } from '../../../../src/module/booking/booking-query.service';
import { BookingTransitionPolicy } from '../../../../src/module/booking/domain/booking-transition.policy';
import { Booking } from '../../../../src/module/booking/schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import type { Customer } from '../../../../src/module/customer/schema/customer.entity';
import type { Room } from '../../../../src/module/room/schema/room.entity';

describe('BookingQueryService', () => {
  let repository: { createQueryBuilder: jest.Mock };
  let service: BookingQueryService;

  beforeEach(() => {
    repository = { createQueryBuilder: jest.fn() };
    service = new BookingQueryService(
      repository as unknown as Repository<Booking>,
      {
        existsBy: jest.fn().mockResolvedValue(false),
      } as unknown as Repository<Payment>,
      {
        getCapabilitiesByCustomerId: jest.fn().mockResolvedValue({
          canSetInitialPassword: true,
          reasonCode: null,
        }),
      } as never,
      new BookingTransitionPolicy(),
    );
  });

  it('lists only the authenticated customer bookings with status pagination', async () => {
    const query = createQuery({ manyAndCount: [[bookingFixture()], 21] });
    repository.createQueryBuilder.mockReturnValue(query);

    await expect(
      service.listForCustomer('10', {
        page: '2',
        limit: '10',
        status: BookingStatus.CONFIRMED,
      }),
    ).resolves.toMatchObject({
      items: [{ id: '100', customerId: '10' }],
      meta: {
        pagination: { page: 2, limit: 10, total: 21, totalPages: 3 },
      },
    });
    expect(query.where).toHaveBeenCalledWith(
      'booking.customerId = :customerId',
      { customerId: '10' },
    );
    expect(query.andWhere).toHaveBeenCalledWith('booking.status = :status', {
      status: BookingStatus.CONFIRMED,
    });
  });

  it('applies management customer/room/status/search filters', async () => {
    const query = createQuery();
    repository.createQueryBuilder.mockReturnValue(query);

    await service.listManagement({
      customerId: '10',
      roomId: '1',
      status: BookingStatus.PENDING_PAYMENT,
      search: ' BK100 ',
    });

    expect(query.andWhere).toHaveBeenCalledWith(
      'booking.customerId = :customerId',
      { customerId: '10' },
    );
    expect(query.andWhere).toHaveBeenCalledWith('booking.roomId = :roomId', {
      roomId: '1',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(booking.bookingCode)'),
      { search: '%bk100%', phoneSearch: '%BK100%' },
    );
  });

  it('scopes customer detail by both booking and customer id', async () => {
    const query = createQuery({ one: bookingFixture() });
    repository.createQueryBuilder.mockReturnValue(query);

    await expect(service.getForCustomer('10', '100')).resolves.toMatchObject({
      id: '100',
      customerId: '10',
      roomId: '1',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'booking.customerId = :customerId',
      { customerId: '10' },
    );
  });

  it('includes soft-deleted relations in customer and management history queries', async () => {
    const customerQuery = createQuery({ one: bookingFixture() });
    const managementQuery = createQuery({ one: bookingFixture() });
    repository.createQueryBuilder
      .mockReturnValueOnce(customerQuery)
      .mockReturnValueOnce(managementQuery);

    await expect(service.getForCustomer('10', '100')).resolves.toMatchObject({
      id: '100',
      customerId: '10',
      roomId: '1',
    });
    await expect(service.getManagement('100')).resolves.toMatchObject({
      id: '100',
      customerId: '10',
      roomId: '1',
    });

    for (const query of [customerQuery, managementQuery]) {
      expect(query.withDeleted).toHaveBeenCalledTimes(1);
      expect(query.innerJoinAndSelect).toHaveBeenCalledWith(
        'booking.customer',
        'customer',
      );
      expect(query.innerJoinAndSelect).toHaveBeenCalledWith(
        'booking.room',
        'room',
      );
      expect(query.innerJoinAndSelect).toHaveBeenCalledWith(
        'room.roomType',
        'roomType',
      );
      expect(query.withDeleted.mock.invocationCallOrder[0]).toBeLessThan(
        query.innerJoinAndSelect.mock.invocationCallOrder[0],
      );
    }
  });

  it('returns 404 instead of exposing another customer booking', async () => {
    repository.createQueryBuilder.mockReturnValue(createQuery());

    await expect(service.getForCustomer('10', '999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('validates actor, ids and status before query execution', async () => {
    await expect(service.listForCustomer(undefined, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.getManagement('bad-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.listManagement({ status: 'INVALID' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });
});

interface QueryResult {
  one?: Booking | null;
  manyAndCount?: [Booking[], number];
}

function createQuery(result: QueryResult = {}) {
  const query = {
    withDeleted: jest.fn(),
    innerJoinAndSelect: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue(result.manyAndCount ?? [[], 0]),
  };

  for (const method of [
    query.withDeleted,
    query.innerJoinAndSelect,
    query.leftJoinAndSelect,
    query.where,
    query.andWhere,
    query.orderBy,
    query.addOrderBy,
    query.skip,
    query.take,
  ]) {
    method.mockReturnValue(query);
  }

  return query;
}

function bookingFixture(): Booking {
  const customer = {
    id: '10',
    fullName: 'Customer',
    phone: '+84901234567',
  } as Customer;
  const room = {
    id: '1',
    roomNumber: 'A-101',
    name: 'Room A-101',
    roomType: { id: '1', name: 'Deluxe' },
  } as Room;

  return {
    id: '100',
    bookingCode: 'BK100',
    customerId: customer.id,
    customer,
    roomId: room.id,
    room,
    createdByUserId: null,
    createdByUser: null,
    checkInDate: '2030-02-01',
    checkOutDate: '2030-02-03',
    guestCount: 2,
    contactName: customer.fullName,
    contactPhone: customer.phone,
    contactEmail: null,
    totalAmount: '2000000.00',
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.UNPAID,
    acceptedPaymentId: null,
    acceptedPayment: null,
    requestIntentActorType: null,
    requestIntentActorId: null,
    requestIntentKey: null,
    requestIntentHash: null,
    paymentExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    customerNote: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2030-01-01'),
    updatedAt: new Date('2030-01-01'),
  };
}
