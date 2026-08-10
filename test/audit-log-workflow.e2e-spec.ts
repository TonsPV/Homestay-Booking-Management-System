import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, In, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  AuditLog,
} from '../src/module/audit/schema/audit-log.entity';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../src/module/booking/schema/booking.entity';
import { RoomCalendar } from '../src/module/booking/schema/room-calendar.entity';
import { Customer } from '../src/module/customer/schema/customer.entity';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { Room, RoomStatus } from '../src/module/room/schema/room.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface Envelope<T> {
  data: T;
}

interface BookingPayload {
  id: string;
  status: BookingStatus;
}

describe('Audit log workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let auditLogs: Repository<AuditLog>;
  let bookings: Repository<Booking>;
  let calendars: Repository<RoomCalendar>;
  let customers: Repository<Customer>;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let users: Repository<User>;
  let hasher: PasswordHasherService;
  let accessTokens: AccessTokenService;
  let admin: User;
  let staff: User;
  let adminToken: string;
  let customer: Customer;
  let room: Room;

  const suffix = E2eHarness.createUniqueSuffix();
  const requestId = 'audit-workflow-' + suffix;
  const bookingIds: string[] = [];
  const customerIds: string[] = [];
  const roomIds: string[] = [];
  const roomTypeIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    auditLogs = dataSource.getRepository(AuditLog);
    bookings = dataSource.getRepository(Booking);
    calendars = dataSource.getRepository(RoomCalendar);
    customers = dataSource.getRepository(Customer);
    rooms = dataSource.getRepository(Room);
    roomTypes = dataSource.getRepository(RoomType);
    users = dataSource.getRepository(User);
    hasher = app.get(PasswordHasherService);
    accessTokens = app.get(AccessTokenService);

    harness.registerCleanup(async () => {
      // Audit rows intentionally go first so cleanup keeps working if a later
      // migration adds foreign keys from audit history to domain entities.
      await auditLogs.delete({ requestId });

      const ownedBookingIds = unique(bookingIds);
      if (ownedBookingIds.length > 0) {
        await calendars.delete({ bookingId: In(ownedBookingIds) });
        await bookings.delete(ownedBookingIds);
      }
      if (roomIds.length > 0) await rooms.delete(unique(roomIds));
      if (roomTypeIds.length > 0) await roomTypes.delete(unique(roomTypeIds));
      if (customerIds.length > 0) await customers.delete(unique(customerIds));
      if (userIds.length > 0) await users.delete(unique(userIds));
    });

    admin = await createAdmin();
    staff = await createStaff();
    customer = await createCustomer();
    room = await createRoom();
    adminToken = accessTokens.sign({
      actorType: 'user',
      userId: admin.id,
      role: admin.role,
      tokenVersion: admin.tokenVersion,
    });
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('persists transactional domain audits and suppresses same-state duplicates', async () => {
    expect(await auditLogs.countBy({ requestId })).toBe(0);
    const checkInDate = futureIsoDate(30);
    const checkOutDate = futureIsoDate(32);

    const created = await managementPost('/api/v1/management/bookings')
      .send({
        customerId: customer.id,
        roomId: room.id,
        checkInDate,
        checkOutDate,
        guestCount: 1,
      })
      .expect(201);
    const booking = (created.body as Envelope<BookingPayload>).data;
    bookingIds.push(booking.id);
    expect(await bookings.findOneByOrFail({ id: booking.id })).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
    });
    await expectSingleAudit({
      action: AuditAction.BOOKING_CREATED,
      entityType: AuditEntityType.BOOKING,
      entityId: booking.id,
      metadata: {
        status: BookingStatus.PENDING_PAYMENT,
        roomId: room.id,
        checkInDate,
        checkOutDate,
      },
    });

    await managementPatch(`/api/v1/management/bookings/${booking.id}/status`)
      .send({ status: BookingStatus.CONFIRMED })
      .expect(200);
    expect((await bookings.findOneByOrFail({ id: booking.id })).status).toBe(
      BookingStatus.CONFIRMED,
    );
    await expectSingleAudit({
      action: AuditAction.BOOKING_STATUS_CHANGED,
      entityType: AuditEntityType.BOOKING,
      entityId: booking.id,
      metadata: {
        fromStatus: BookingStatus.PENDING_PAYMENT,
        toStatus: BookingStatus.CONFIRMED,
        cancellationReason: null,
      },
    });

    await managementPatch(`/api/v1/management/bookings/${booking.id}/status`)
      .send({ status: BookingStatus.CONFIRMED })
      .expect(200);
    expect(
      await countAudits(
        AuditAction.BOOKING_STATUS_CHANGED,
        AuditEntityType.BOOKING,
        booking.id,
      ),
    ).toBe(1);

    await managementPatch(`/api/v1/management/bookings/${booking.id}/status`)
      .send({
        status: BookingStatus.CANCELLED,
        cancellationReason: 'Audit workflow cancellation',
      })
      .expect(200);
    expect((await bookings.findOneByOrFail({ id: booking.id })).status).toBe(
      BookingStatus.CANCELLED,
    );
    await expectSingleAudit({
      action: AuditAction.BOOKING_CANCELLED,
      entityType: AuditEntityType.BOOKING,
      entityId: booking.id,
      metadata: {
        fromStatus: BookingStatus.CONFIRMED,
        toStatus: BookingStatus.CANCELLED,
        cancellationReason: 'Audit workflow cancellation',
      },
    });

    await managementPatch(`/api/v1/management/bookings/${booking.id}/status`)
      .send({
        status: BookingStatus.CANCELLED,
        cancellationReason: 'Audit workflow cancellation',
      })
      .expect(200);
    expect(
      await countAudits(
        AuditAction.BOOKING_CANCELLED,
        AuditEntityType.BOOKING,
        booking.id,
      ),
    ).toBe(1);

    await managementPatch(`/api/v1/rooms/${room.id}/status`)
      .send({ status: RoomStatus.CLEANING })
      .expect(200);
    expect((await rooms.findOneByOrFail({ id: room.id })).status).toBe(
      RoomStatus.CLEANING,
    );
    await expectSingleAudit({
      action: AuditAction.ROOM_STATUS_CHANGED,
      entityType: AuditEntityType.ROOM,
      entityId: room.id,
      metadata: {
        fromStatus: RoomStatus.READY,
        toStatus: RoomStatus.CLEANING,
      },
    });

    await managementPatch(`/api/v1/rooms/${room.id}/status`)
      .send({ status: RoomStatus.CLEANING })
      .expect(200);
    expect(
      await countAudits(
        AuditAction.ROOM_STATUS_CHANGED,
        AuditEntityType.ROOM,
        room.id,
      ),
    ).toBe(1);

    await managementPatch(`/api/v1/customers/${customer.id}/status`)
      .send({ status: 'LOCKED' })
      .expect(200);
    expect((await customers.findOneByOrFail({ id: customer.id })).status).toBe(
      'LOCKED',
    );
    await expectSingleAudit({
      action: AuditAction.ACCOUNT_LOCKED,
      entityType: AuditEntityType.CUSTOMER,
      entityId: customer.id,
      metadata: { fromStatus: 'ACTIVE', toStatus: 'LOCKED' },
    });

    await managementPatch(`/api/v1/customers/${customer.id}/status`)
      .send({ status: 'LOCKED' })
      .expect(200);
    expect(
      await countAudits(
        AuditAction.ACCOUNT_LOCKED,
        AuditEntityType.CUSTOMER,
        customer.id,
      ),
    ).toBe(1);

    await managementPatch(`/api/v1/users/${staff.id}/status`)
      .send({ status: 'LOCKED' })
      .expect(200);
    expect((await users.findOneByOrFail({ id: staff.id })).status).toBe(
      'LOCKED',
    );
    await expectSingleAudit({
      action: AuditAction.ACCOUNT_LOCKED,
      entityType: AuditEntityType.USER,
      entityId: staff.id,
      metadata: { fromStatus: 'ACTIVE', toStatus: 'LOCKED' },
    });

    await managementPatch(`/api/v1/users/${staff.id}/status`)
      .send({ status: 'LOCKED' })
      .expect(200);
    expect(
      await countAudits(
        AuditAction.ACCOUNT_LOCKED,
        AuditEntityType.USER,
        staff.id,
      ),
    ).toBe(1);

    await managementPatch(`/api/v1/users/${staff.id}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect((await users.findOneByOrFail({ id: staff.id })).status).toBe(
      'ACTIVE',
    );
    await expectSingleAudit({
      action: AuditAction.ACCOUNT_UNLOCKED,
      entityType: AuditEntityType.USER,
      entityId: staff.id,
      metadata: { fromStatus: 'LOCKED', toStatus: 'ACTIVE' },
    });

    const persistedAudits = await auditLogs.findBy({ requestId });
    expect(persistedAudits).toHaveLength(7);
  });

  function managementPost(path: string): request.Test {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', 'Bearer ' + adminToken)
      .set('X-Request-Id', requestId);
  }

  function managementPatch(path: string): request.Test {
    return request(app.getHttpServer())
      .patch(path)
      .set('Authorization', 'Bearer ' + adminToken)
      .set('X-Request-Id', requestId);
  }

  async function expectSingleAudit(input: {
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    metadata: Record<string, string | null>;
  }): Promise<void> {
    const rows = await auditLogs.findBy({
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: AuditActorType.USER,
      actorId: admin.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId,
      metadata: input.metadata,
    });
  }

  function countAudits(
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: string,
  ): Promise<number> {
    return auditLogs.countBy({ action, entityType, entityId, requestId });
  }

  async function createAdmin(): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Audit Workflow Admin',
        email: `audit-admin-${suffix}@example.com`,
        phone: null,
        passwordHash: await hasher.hash(PASSWORD),
        tokenVersion: 0,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    userIds.push(user.id);
    return user;
  }

  async function createStaff(): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Audit Workflow Staff',
        email: `audit-staff-${suffix}@example.com`,
        phone: null,
        passwordHash: await hasher.hash(PASSWORD),
        tokenVersion: 0,
        role: 'STAFF',
        status: 'ACTIVE',
      }),
    );
    userIds.push(user.id);
    return user;
  }

  async function createCustomer(): Promise<Customer> {
    const value = await customers.save(
      customers.create({
        fullName: 'Audit Workflow Customer',
        email: `audit-customer-${suffix}@example.com`,
        phone: '+849' + numericSuffix(),
        passwordHash: await hasher.hash(PASSWORD),
        tokenVersion: 0,
        status: 'ACTIVE',
      }),
    );
    customerIds.push(value.id);
    return value;
  }

  async function createRoom(): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'Audit Room Type ' + suffix,
        description: null,
        maxGuests: 2,
        basePrice: '125.00',
        amenities: [],
      }),
    );
    roomTypeIds.push(roomType.id);
    const value = await rooms.save(
      rooms.create({
        roomTypeId: roomType.id,
        roomNumber: 'AUD-' + suffix,
        name: 'Audit Workflow Room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(value.id);
    return value;
  }

  function futureIsoDate(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function numericSuffix(): string {
    return String(Date.now() % 100_000_000).padStart(8, '0');
  }

  function unique(values: string[]): string[] {
    return [...new Set(values)];
  }
});
