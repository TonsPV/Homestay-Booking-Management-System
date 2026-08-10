import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  type DataSource,
  type EntityManager,
  QueryFailedError,
  type Repository,
} from 'typeorm';

import { AuditLogService } from '../audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/schema/audit-log.entity';
import { Customer } from '../customer/schema/customer.entity';
import { ErrorCode } from '../../common/http';
import { Payment } from '../payment/schema/payment.entity';
import { Room, RoomStatus } from '../room/schema/room.entity';
import { RoomType } from '../room-type/schema/room-type.entity';
import { BookingCreationService } from './booking-creation.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingQueryService } from './booking-query.service';
import { BookingService } from './booking.service';
import { BookingStayPolicy } from './booking-stay.policy';
import { BookingTransitionPolicy } from './booking-transition.policy';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from './schema/booking.entity';
import { RoomCalendar } from './schema/room-calendar.entity';

describe('BookingService characterization', () => {
  let bookingsRepository: {
    createQueryBuilder: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
  };
  let auditRecord: jest.Mock;
  let service: BookingService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    bookingsRepository = {
      createQueryBuilder: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
    };
    auditRecord = jest.fn().mockResolvedValue(undefined);
    const auditLogService = {
      record: auditRecord,
    } as unknown as AuditLogService;
    const configValues: Record<string, number> = {
      BOOKING_PAYMENT_TIMEOUT_MINUTES: 15,
      BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER: 3,
      BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER: 30,
      BOOKING_MAX_ADVANCE_DAYS: 365,
    };
    const config = {
      getOrThrow: jest.fn((key: string) => configValues[key]),
    };
    service = new BookingService(
      new BookingCreationService(
        dataSource as unknown as DataSource,
        config as unknown as ConfigService,
        new BookingStayPolicy(config as unknown as ConfigService),
        auditLogService,
      ),
      new BookingLifecycleService(
        dataSource as unknown as DataSource,
        config as unknown as ConfigService,
        new BookingTransitionPolicy(),
        auditLogService,
      ),
      new BookingQueryService(
        bookingsRepository as unknown as Repository<Booking>,
        {
          existsBy: jest.fn().mockResolvedValue(false),
        } as never,
        {
          evaluateByCustomerId: jest.fn().mockResolvedValue({
            canSetInitialPassword: true,
            reasonCode: null,
          }),
        } as never,
        {
          getCapabilities: jest.fn().mockReturnValue([]),
        } as never,
      ),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('creates an online booking with price snapshot and one RESERVED row per night', async () => {
    const customer = customerFixture();
    const room = roomFixture();
    const savedBooking = bookingFixture({
      id: '100',
      checkInDate: '2030-02-01',
      checkOutDate: '2030-02-04',
      totalAmount: '3000000.00',
    });
    const bookingCreate = jest.fn((value: Booking) => value);
    const bookingSave = jest.fn((value: Booking) =>
      Promise.resolve({ ...savedBooking, ...value, id: '100' }),
    );
    const calendarCreate = jest.fn((value: RoomCalendar) => value);
    const calendarInsert = jest.fn().mockResolvedValue({ identifiers: [] });
    const manager = createManager({
      customer,
      room,
      bookingCreate,
      bookingSave,
      calendarCreate,
      calendarInsert,
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(savedBooking),
    );

    await expect(
      service.createForCustomer(
        '10',
        {
          roomId: '1',
          checkInDate: '2030-02-01',
          checkOutDate: '2030-02-04',
          guestCount: 2,
        },
        { requestId: 'request-online-create' },
      ),
    ).resolves.toMatchObject({
      id: '100',
      totalAmount: '3000000.00',
      status: BookingStatus.PENDING_PAYMENT,
    });

    expect(bookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '10',
        roomId: '1',
        totalAmount: '3000000.00',
        status: BookingStatus.PENDING_PAYMENT,
        paymentStatus: BookingPaymentStatus.UNPAID,
        createdByUserId: null,
      }),
    );
    expect(calendarInsert).toHaveBeenCalledWith([
      expect.objectContaining({ stayDate: '2030-02-01' }),
      expect.objectContaining({ stayDate: '2030-02-02' }),
      expect.objectContaining({ stayDate: '2030-02-03' }),
    ]);
    expect(auditRecord).toHaveBeenCalledWith(manager, {
      actorType: AuditActorType.CUSTOMER,
      actorId: '10',
      action: AuditAction.BOOKING_CREATED,
      entityType: AuditEntityType.BOOKING,
      entityId: '100',
      requestId: 'request-online-create',
      metadata: {
        status: BookingStatus.PENDING_PAYMENT,
        roomId: '1',
        checkInDate: '2030-02-01',
        checkOutDate: '2030-02-04',
      },
    });
  });

  it('creates a counter booking for an existing customer with the staff snapshot', async () => {
    const customer = customerFixture();
    const room = roomFixture();
    const savedBooking = bookingFixture({
      id: '100',
      createdByUserId: '20',
    });
    const bookingCreate = jest.fn((value: Booking) => value);
    const bookingSave = jest.fn((value: Booking) =>
      Promise.resolve({ ...savedBooking, ...value, id: '100' }),
    );
    const manager = createManager({
      customer,
      room,
      bookingCreate,
      bookingSave,
      calendarCreate: jest.fn((value: RoomCalendar) => value),
      calendarInsert: jest.fn().mockResolvedValue({ identifiers: [] }),
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(savedBooking),
    );

    await service.createForManagement(
      '20',
      {
        customerId: '10',
        roomId: '1',
        checkInDate: '2030-02-01',
        checkOutDate: '2030-02-03',
        guestCount: 2,
      },
      { requestId: 'request-counter-create' },
    );

    expect(bookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: '10',
        createdByUserId: '20',
        paymentStatus: BookingPaymentStatus.UNPAID,
      }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actorType: AuditActorType.USER,
        actorId: '20',
        action: AuditAction.BOOKING_CREATED,
        entityType: AuditEntityType.BOOKING,
        entityId: '100',
        requestId: 'request-counter-create',
      }),
    );
  });

  it('rejects a booking whose guest count exceeds room capacity', async () => {
    const bookingCreate = jest.fn();
    const manager = createManager({
      customer: customerFixture(),
      room: roomFixture(),
      bookingCreate,
      bookingSave: jest.fn(),
      calendarCreate: jest.fn(),
      calendarInsert: jest.fn(),
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(
      service.createForCustomer('10', {
        roomId: '1',
        checkInDate: '2030-02-01',
        checkOutDate: '2030-02-02',
        guestCount: 3,
      }),
    ).rejects.toThrow('vuot qua suc chua');
    expect(bookingCreate).not.toHaveBeenCalled();
  });

  it.each([
    {
      body: {
        roomId: '1',
        checkInDate: '2029-12-31',
        checkOutDate: '2030-01-02',
        guestCount: 1,
      },
      message: 'qua khu',
    },
    {
      body: {
        roomId: '1',
        checkInDate: '2030-01-02',
        checkOutDate: '2030-04-03',
        guestCount: 1,
      },
      message: '90 dem',
    },
    {
      body: {
        roomId: '1',
        checkInDate: '2030-02-03',
        checkOutDate: '2030-02-01',
        guestCount: 1,
      },
      message: 'sau ngay check-in',
    },
    {
      body: {
        roomId: '1',
        checkInDate: '2031-01-02',
        checkOutDate: '2031-01-03',
        guestCount: 1,
      },
      message: '365 ngay',
    },
  ])('rejects invalid stay boundary: $message', async ({ body, message }) => {
    await expect(service.createForCustomer('10', body)).rejects.toThrow(
      message,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a customer who already has the maximum active unpaid bookings', async () => {
    const bookingCreate = jest.fn();
    const manager = createManager({
      customer: customerFixture(),
      room: roomFixture(),
      bookingCreate,
      bookingSave: jest.fn(),
      calendarCreate: jest.fn(),
      calendarInsert: jest.fn(),
      activeUnpaidBookings: [
        bookingFixture({
          checkInDate: '2030-03-01',
          checkOutDate: '2030-03-03',
        }),
        bookingFixture({
          checkInDate: '2030-03-04',
          checkOutDate: '2030-03-06',
        }),
        bookingFixture({
          checkInDate: '2030-03-07',
          checkOutDate: '2030-03-09',
        }),
      ],
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(
      service.createForCustomer('10', {
        roomId: '1',
        checkInDate: '2030-04-01',
        checkOutDate: '2030-04-03',
        guestCount: 1,
      }),
    ).rejects.toThrow('toi da 3 booking cho thanh toan');
    expect(bookingCreate).not.toHaveBeenCalled();
  });

  it('rejects a booking that would exceed the aggregate held-night budget', async () => {
    const bookingCreate = jest.fn();
    const manager = createManager({
      customer: customerFixture(),
      room: roomFixture(),
      bookingCreate,
      bookingSave: jest.fn(),
      calendarCreate: jest.fn(),
      calendarInsert: jest.fn(),
      activeUnpaidBookings: [
        bookingFixture({
          checkInDate: '2030-03-01',
          checkOutDate: '2030-03-16',
        }),
        bookingFixture({
          checkInDate: '2030-04-01',
          checkOutDate: '2030-04-15',
        }),
      ],
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(
      service.createForCustomer('10', {
        roomId: '1',
        checkInDate: '2030-05-01',
        checkOutDate: '2030-05-03',
        guestCount: 1,
      }),
    ).rejects.toThrow('khong duoc vuot qua 30 dem');
    expect(bookingCreate).not.toHaveBeenCalled();
  });

  it('rejects a missing actor before starting a transaction', async () => {
    await expect(
      service.createForCustomer(undefined, {
        roomId: '1',
        checkInDate: '2030-02-01',
        checkOutDate: '2030-02-02',
        guestCount: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps a concurrent room-calendar collision to Conflict', async () => {
    const loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    dataSource.transaction.mockRejectedValue(
      new QueryFailedError('INSERT', [], {
        code: 'ER_DUP_ENTRY',
        message:
          "Duplicate entry '1-2030-02-01' for key 'room_calendar_room_date'",
      }),
    );

    await expect(
      service.createForCustomer(
        '10',
        {
          roomId: '1',
          checkInDate: '2030-02-01',
          checkOutDate: '2030-02-02',
          guestCount: 1,
        },
        { requestId: 'request-room-conflict' },
      ),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.BOOKING_ROOM_UNAVAILABLE,
    );
    expect(loggerWarn).toHaveBeenCalledWith(
      'operation=booking_create errorCode=BOOKING_ROOM_UNAVAILABLE requestId=request-room-conflict roomId=1',
    );
  });

  it('does not allow confirming an unpaid online booking', async () => {
    const booking = bookingFixture({
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: null,
    });
    const manager = createLifecycleManager(booking);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(
      service.updateStatus('100', { status: BookingStatus.CONFIRMED }),
    ).rejects.toThrow('chi duoc xac nhan sau khi thanh toan');
  });

  it('requires PAID before check-in and enforces the stay date', async () => {
    const unpaid = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.UNPAID,
      checkInDate: '2030-01-01',
      checkOutDate: '2030-01-03',
    });
    dataSource.transaction.mockImplementationOnce(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(createLifecycleManager(unpaid))),
    );

    await expect(
      service.updateStatus('100', { status: BookingStatus.CHECKED_IN }),
    ).rejects.toThrow('thanh toan truoc khi check-in');

    const paidFuture = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      checkInDate: '2030-01-02',
      checkOutDate: '2030-01-04',
    });
    dataSource.transaction.mockImplementationOnce(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(createLifecycleManager(paidFuture))),
    );

    await expect(
      service.updateStatus('100', { status: BookingStatus.CHECKED_IN }),
    ).rejects.toThrow('thoi gian luu tru');
  });

  it('moves Room READY -> OCCUPIED on check-in', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
      checkInDate: '2030-01-01',
      checkOutDate: '2030-01-03',
    });
    const room = roomFixture();
    const manager = createLifecycleManager(booking, room);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.updateStatus('100', {
      status: BookingStatus.CHECKED_IN,
    });

    expect(room.status).toBe(RoomStatus.OCCUPIED);
    expect(booking.status).toBe(BookingStatus.CHECKED_IN);
  });

  it('allows a counter booking to move from PENDING_PAYMENT to CONFIRMED', async () => {
    const booking = bookingFixture({
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      createdByUserId: '20',
    });
    const manager = createLifecycleManager(booking);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.updateStatus(
      '100',
      {
        status: BookingStatus.CONFIRMED,
      },
      '20',
      { requestId: 'request-confirm-counter-booking' },
    );

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.paymentExpiresAt).toBeNull();
    expect(auditRecord).toHaveBeenCalledWith(manager, {
      actorType: AuditActorType.USER,
      actorId: '20',
      action: AuditAction.BOOKING_STATUS_CHANGED,
      entityType: AuditEntityType.BOOKING,
      entityId: '100',
      requestId: 'request-confirm-counter-booking',
      metadata: {
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CONFIRMED,
        cancellationReason: null,
      },
    });
  });

  it('does not write a duplicate audit entry for a same-status update', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const manager = createLifecycleManager(booking);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.updateStatus(
      '100',
      { status: BookingStatus.CONFIRMED },
      '20',
      { requestId: 'request-same-status' },
    );

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects an invalid management status transition', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CHECKED_IN,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(createLifecycleManager(booking))),
    );

    await expect(
      service.updateStatus('100', {
        status: BookingStatus.CONFIRMED,
      }),
    ).rejects.toThrow('Khong the chuyen booking');
  });

  it('blocks lifecycle mutation while a refund is pending', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(
          work(
            createLifecycleManager(booking, undefined, { refundPending: true }),
          ),
        ),
    );

    await expect(
      service.updateStatus('100', {
        status: BookingStatus.CHECKED_IN,
      }),
    ).rejects.toThrow('yeu cau hoan tien VNPay');
  });

  it('keeps the contractual stay, price, payment, and calendar unchanged on early check-out', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CHECKED_IN,
      paymentStatus: BookingPaymentStatus.PAID,
      checkInDate: '2030-01-01',
      checkOutDate: '2030-01-06',
      totalAmount: '5000000.00',
    });
    const room = roomFixture({ status: RoomStatus.OCCUPIED });
    const calendarDelete = jest.fn().mockResolvedValue({ affected: 0 });
    const paymentExecute = jest.fn().mockResolvedValue({ affected: 0 });
    const originalCheckOutDate = booking.checkOutDate;
    const originalTotalAmount = booking.totalAmount;
    const originalPaymentStatus = booking.paymentStatus;
    const manager = createLifecycleManager(booking, room, {
      calendarDelete,
      paymentExecute,
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.updateStatus('100', {
      status: BookingStatus.CHECKED_OUT,
    });

    expect(booking.status).toBe(BookingStatus.CHECKED_OUT);
    expect(room.status).toBe(RoomStatus.CLEANING);
    expect(booking.checkOutDate).toBe(originalCheckOutDate);
    expect(booking.totalAmount).toBe(originalTotalAmount);
    expect(booking.paymentStatus).toBe(originalPaymentStatus);
    expect(calendarDelete).not.toHaveBeenCalled();
    expect(paymentExecute).not.toHaveBeenCalled();
  });

  it('keeps a maintenance room unchanged when the booking checks out', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CHECKED_IN,
      paymentStatus: BookingPaymentStatus.PAID,
    });
    const room = roomFixture({ status: RoomStatus.MAINTENANCE });
    const manager = createLifecycleManager(booking, room);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.updateStatus('100', {
      status: BookingStatus.CHECKED_OUT,
    });

    expect(room.status).toBe(RoomStatus.MAINTENANCE);
  });

  it('does not allow customer cancellation after payment', async () => {
    const booking = bookingFixture({
      paymentStatus: BookingPaymentStatus.PAID,
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(createLifecycleManager(booking))),
    );

    await expect(
      service.cancelForCustomer('10', '100', {
        reason: 'Changed plans',
      }),
    ).rejects.toThrow('Can hoan tien truoc khi huy');
  });

  it('requires a cancellation reason for management cancellation', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
    const manager = createLifecycleManager(booking);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(
      service.updateStatus('100', { status: BookingStatus.CANCELLED }),
    ).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
    );
    await expect(
      service.updateStatus('100', { status: BookingStatus.CANCELLED }),
    ).rejects.toHaveProperty('response.fieldErrors.cancellationReason', [
      {
        errorCode: ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
        message: 'Ly do huy booking la bat buoc.',
      },
    ]);
  });

  it('audits a management cancellation with the staff actor in the mutation transaction', async () => {
    const booking = bookingFixture({
      status: BookingStatus.CONFIRMED,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
    const manager = createLifecycleManager(booking);
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.updateStatus(
      '100',
      {
        status: BookingStatus.CANCELLED,
        cancellationReason: 'Cancelled by staff',
      },
      '20',
      { requestId: 'request-management-cancel' },
    );

    expect(auditRecord).toHaveBeenCalledWith(manager, {
      actorType: AuditActorType.USER,
      actorId: '20',
      action: AuditAction.BOOKING_CANCELLED,
      entityType: AuditEntityType.BOOKING,
      entityId: '100',
      requestId: 'request-management-cancel',
      metadata: {
        fromStatus: BookingStatus.CONFIRMED,
        toStatus: BookingStatus.CANCELLED,
        cancellationReason: 'Cancelled by staff',
      },
    });
  });

  it('hides another customer booking as not found during cancellation', async () => {
    const booking = bookingFixture({ customerId: '10' });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(createLifecycleManager(booking))),
    );

    await expect(
      service.cancelForCustomer('11', '100', {
        reason: 'Not mine',
      }),
    ).rejects.toThrow('Khong tim thay booking');
  });

  it('customer cancellation releases calendar and fails pending VNPay payments', async () => {
    const booking = bookingFixture();
    const calendarDelete = jest.fn().mockResolvedValue({ affected: 2 });
    const paymentExecute = jest.fn().mockResolvedValue({ affected: 1 });
    const manager = createLifecycleManager(booking, undefined, {
      calendarDelete,
      paymentExecute,
    });
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    bookingsRepository.createQueryBuilder.mockReturnValue(
      createBookingQuery(booking),
    );

    await service.cancelForCustomer(
      '10',
      '100',
      {
        reason: 'Changed plans',
      },
      { requestId: 'request-customer-cancel' },
    );

    expect(booking).toMatchObject({
      status: BookingStatus.CANCELLED,
      paymentExpiresAt: null,
      cancellationReason: 'Changed plans',
    });
    expect(calendarDelete).toHaveBeenCalledWith({ bookingId: '100' });
    expect(paymentExecute).toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(manager, {
      actorType: AuditActorType.CUSTOMER,
      actorId: '10',
      action: AuditAction.BOOKING_CANCELLED,
      entityType: AuditEntityType.BOOKING,
      entityId: '100',
      requestId: 'request-customer-cancel',
      metadata: {
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CANCELLED,
        cancellationReason: 'Changed plans',
      },
    });
  });

  it('expires only the locked UNPAID batch and releases its calendars', async () => {
    const now = new Date('2030-01-01T01:00:00.000Z');
    const expired = [
      bookingFixture({ id: '100' }),
      bookingFixture({ id: '101' }),
    ];
    const bookingSave = jest.fn().mockResolvedValue(expired);
    const calendarDelete = jest.fn().mockResolvedValue({ affected: 4 });
    const paymentExecute = jest.fn().mockResolvedValue({ affected: 2 });
    const manager = createExpiryManager(
      expired,
      bookingSave,
      calendarDelete,
      paymentExecute,
    );
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(service.expirePendingPayments(now)).resolves.toBe(2);
    expect(expired).toEqual([
      expect.objectContaining({
        status: BookingStatus.CANCELLED,
        cancellationReason: 'Thanh toán đã hết hạn.',
      }),
      expect.objectContaining({
        status: BookingStatus.CANCELLED,
        cancellationReason: 'Thanh toán đã hết hạn.',
      }),
    ]);
    expect(calendarDelete).toHaveBeenCalled();
    expect(paymentExecute).toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledTimes(2);
    expect(auditRecord).toHaveBeenNthCalledWith(1, manager, {
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      action: AuditAction.BOOKING_CANCELLED,
      entityType: AuditEntityType.BOOKING,
      entityId: '100',
      requestId: undefined,
      metadata: {
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CANCELLED,
        cancellationReason: expired[0].cancellationReason,
      },
    });
    expect(auditRecord).toHaveBeenNthCalledWith(2, manager, {
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      action: AuditAction.BOOKING_CANCELLED,
      entityType: AuditEntityType.BOOKING,
      entityId: '101',
      requestId: undefined,
      metadata: {
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CANCELLED,
        cancellationReason: expired[1].cancellationReason,
      },
    });
  });

  it('returns zero without writes when no payment deadline has expired', async () => {
    const bookingSave = jest.fn();
    const calendarDelete = jest.fn();
    const paymentExecute = jest.fn();
    const manager = createExpiryManager(
      [],
      bookingSave,
      calendarDelete,
      paymentExecute,
    );
    dataSource.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );

    await expect(service.expirePendingPayments()).resolves.toBe(0);
    expect(bookingSave).not.toHaveBeenCalled();
    expect(calendarDelete).not.toHaveBeenCalled();
    expect(paymentExecute).not.toHaveBeenCalled();
  });
});

interface CreateManagerOptions {
  customer: Customer;
  room: Room;
  bookingCreate: jest.Mock;
  bookingSave: jest.Mock;
  calendarCreate: jest.Mock;
  calendarInsert: jest.Mock;
  activeUnpaidBookings?: Booking[];
}

function createManager(options: CreateManagerOptions): EntityManager {
  const customerQuery = createLockedQuery(options.customer);
  const roomQuery = createLockedQuery(options.room);
  const activeUnpaidBookings = options.activeUnpaidBookings ?? [];

  return {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Customer) {
        return { createQueryBuilder: () => customerQuery };
      }
      if (entity === Room) {
        return { createQueryBuilder: () => roomQuery };
      }
      if (entity === Booking) {
        return {
          create: options.bookingCreate,
          save: options.bookingSave,
          countBy: () => Promise.resolve(activeUnpaidBookings.length),
          find: () => Promise.resolve(activeUnpaidBookings),
        };
      }
      if (entity === RoomCalendar) {
        return {
          create: options.calendarCreate,
          insert: options.calendarInsert,
        };
      }
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
}

function createLifecycleManager(
  booking: Booking,
  room?: Room,
  overrides: {
    calendarDelete?: jest.Mock;
    paymentExecute?: jest.Mock;
    refundPending?: boolean;
  } = {},
): EntityManager {
  const bookingQuery = createLockedQuery(booking);
  const roomQuery = createLockedQuery(room ?? roomFixture());
  const paymentQuery = createMutationQuery(overrides.paymentExecute);
  const bookingSave = jest.fn((value: Booking) => Promise.resolve(value));

  return {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Booking) {
        return {
          createQueryBuilder: () => bookingQuery,
          save: bookingSave,
        };
      }
      if (entity === Payment) {
        return {
          existsBy: () => Promise.resolve(overrides.refundPending ?? false),
          createQueryBuilder: () => paymentQuery,
        };
      }
      if (entity === RoomCalendar) {
        return {
          delete:
            overrides.calendarDelete ??
            jest.fn().mockResolvedValue({ affected: 0 }),
        };
      }
      if (entity === Room) {
        return {
          createQueryBuilder: () => roomQuery,
          save: jest.fn((value: Room) => Promise.resolve(value)),
        };
      }
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
}

function createExpiryManager(
  bookings: Booking[],
  bookingSave: jest.Mock,
  calendarDelete: jest.Mock,
  paymentExecute: jest.Mock,
): EntityManager {
  const bookingQuery = createBookingQuery(undefined);
  bookingQuery.getMany.mockResolvedValue(bookings);
  const paymentQuery = createMutationQuery(paymentExecute);

  return {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Booking) {
        return {
          createQueryBuilder: () => bookingQuery,
          save: bookingSave,
        };
      }
      if (entity === Payment) {
        return { createQueryBuilder: () => paymentQuery };
      }
      if (entity === RoomCalendar) {
        return { delete: calendarDelete };
      }
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
}

function createLockedQuery<T>(result: T) {
  return {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

function createBookingQuery(result: Booking | undefined) {
  return {
    withDeleted: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result ?? null),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
}

function createMutationQuery(execute = jest.fn().mockResolvedValue({})) {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute,
  };
}

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  const customer = customerFixture();
  const room = roomFixture();

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
    contactEmail: customer.email,
    totalAmount: '2000000.00',
    status: BookingStatus.PENDING_PAYMENT,
    paymentStatus: BookingPaymentStatus.UNPAID,
    paymentExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    customerNote: null,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '10',
    fullName: 'Customer',
    email: 'customer@example.com',
    phone: '+84901234567',
    passwordHash: 'hash',
    tokenVersion: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

function roomFixture(overrides: Partial<Room> = {}): Room {
  const roomType = {
    id: '1',
    name: 'Deluxe',
    maxGuests: 2,
    basePrice: '1000000.00',
  } as RoomType;

  return {
    id: '1',
    roomTypeId: roomType.id,
    roomType,
    roomNumber: 'A-101',
    name: 'Room A-101',
    description: null,
    status: RoomStatus.READY,
    images: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
