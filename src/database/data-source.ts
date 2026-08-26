import 'reflect-metadata';

import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import { assertSafeE2eEnvironment } from '../config/e2e-environment';
import { Booking } from '../module/booking/schema/booking.entity';
import { AuditLog } from '../module/audit/schema/audit-log.entity';
import { Amenity } from '../module/amenity/schema/amenity.entity';
import { RoomCalendar } from '../module/booking/schema/room-calendar.entity';
import { Customer } from '../module/customer/schema/customer.entity';
import { Payment } from '../module/payment/schema/payment.entity';
import { RoomImage } from '../module/room/schema/room-image.entity';
import { Room } from '../module/room/schema/room.entity';
import { RoomType } from '../module/room-type/schema/room-type.entity';
import { RoomTypeBed } from '../module/room-type/schema/room-type-bed.entity';
import { User } from '../module/user/schema/user.entity';
import { AlignBookingMetadata1784774000000 } from './migrations/1784774000000-AlignBookingMetadata';
import { AddPaymentManagement1784775000000 } from './migrations/1784775000000-AddPaymentManagement';
import { AddVnpayPaymentFields1784776000000 } from './migrations/1784776000000-AddVnpayPaymentFields';
import { AddPaymentReviewStatus1784777000000 } from './migrations/1784777000000-AddPaymentReviewStatus';
import { AddVnpayRefundManagement1784778000000 } from './migrations/1784778000000-AddVnpayRefundManagement';
import { HardenRoomCalendarOwnership1784779000000 } from './migrations/1784779000000-HardenRoomCalendarOwnership';
import { AddCustomerTokenVersion1784780000000 } from './migrations/1784780000000-AddCustomerTokenVersion';
import { AddAmenities1784781000000 } from './migrations/1784781000000-AddAmenities';
import { AddDashboardQueryIndexes1784782000000 } from './migrations/1784782000000-AddDashboardQueryIndexes';
import { AlignAmenityJoinMetadata1784783000000 } from './migrations/1784783000000-AlignAmenityJoinMetadata';
import { AddCustomerPhoneClaim1784784000000 } from './migrations/1784784000000-AddCustomerPhoneClaim';
import { AddRoomTypeBedType1784785000000 } from './migrations/1784785000000-AddRoomTypeBedType';
import { CreateRoomTypeBeds1784786000000 } from './migrations/1784786000000-CreateRoomTypeBeds';
import { CreateAuditLogs1784787000000 } from './migrations/1784787000000-CreateAuditLogs';
import { AddUserAuditEntityType1784788000000 } from './migrations/1784788000000-AddUserAuditEntityType';
import { AlignRoomTypeBedMetadata1784789000000 } from './migrations/1784789000000-AlignRoomTypeBedMetadata';
import { AddPaymentReviewContext1784790000000 } from './migrations/1784790000000-AddPaymentReviewContext';
import { HardenPositivePriceConstraints1784791000000 } from './migrations/1784791000000-HardenPositivePriceConstraints';
import { HardenPaymentLineage1784792000000 } from './migrations/1784792000000-HardenPaymentLineage';
import { AddBookingRequestIntent1784793000000 } from './migrations/1784793000000-AddBookingRequestIntent';
import { RetireCustomerPhoneClaim1784794000000 } from './migrations/1784794000000-RetireCustomerPhoneClaim';
import { AlignRoomMetadata1784772000000 } from './migrations/1784772000000-AlignRoomMetadata';
import { AddUserTokenVersion1784773000000 } from './migrations/1784773000000-AddUserTokenVersion';
import { AlignEntityMetadata1784771000000 } from './migrations/1784771000000-AlignEntityMetadata';
import { InitialSchemaBaseline1784770000000 } from './migrations/1784770000000-InitialSchemaBaseline';

config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  quiet: true,
});

if (process.env.NODE_ENV === 'test') {
  assertSafeE2eEnvironment(process.env);
}

const AppDataSource = new DataSource({
  type: 'mysql',
  host: getRequiredEnv('DB_HOST'),
  port: getRequiredNumberEnv('DB_PORT'),
  username: getRequiredEnv('DB_USERNAME'),
  password: getRequiredEnv('DB_PASSWORD'),
  database: getRequiredEnv('DB_DATABASE'),
  timezone: 'Z',
  connectTimeout: getOptionalNumberEnv('DB_CONNECT_TIMEOUT_MS', 5000),
  poolSize: getOptionalNumberEnv('DB_POOL_SIZE', 10),
  extra: {
    waitForConnections: true,
    queueLimit: getOptionalNumberEnv('DB_POOL_QUEUE_LIMIT', 50),
    maxIdle: getOptionalNumberEnv('DB_POOL_SIZE', 10),
    idleTimeout: 60_000,
    enableKeepAlive: true,
  },
  entities: [
    AuditLog,
    Booking,
    Amenity,
    Customer,
    Payment,
    Room,
    RoomCalendar,
    RoomImage,
    RoomType,
    RoomTypeBed,
    User,
  ],
  migrations: [
    InitialSchemaBaseline1784770000000,
    AlignEntityMetadata1784771000000,
    AlignRoomMetadata1784772000000,
    AddUserTokenVersion1784773000000,
    AlignBookingMetadata1784774000000,
    AddPaymentManagement1784775000000,
    AddVnpayPaymentFields1784776000000,
    AddPaymentReviewStatus1784777000000,
    AddVnpayRefundManagement1784778000000,
    HardenRoomCalendarOwnership1784779000000,
    AddCustomerTokenVersion1784780000000,
    AddAmenities1784781000000,
    AddDashboardQueryIndexes1784782000000,
    AlignAmenityJoinMetadata1784783000000,
    AddCustomerPhoneClaim1784784000000,
    AddRoomTypeBedType1784785000000,
    CreateRoomTypeBeds1784786000000,
    CreateAuditLogs1784787000000,
    AddUserAuditEntityType1784788000000,
    AlignRoomTypeBedMetadata1784789000000,
    AddPaymentReviewContext1784790000000,
    HardenPositivePriceConstraints1784791000000,
    HardenPaymentLineage1784792000000,
    AddBookingRequestIntent1784793000000,
    RetireCustomerPhoneClaim1784794000000,
  ],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
});

export default AppDataSource;

function getRequiredEnv(key: string): string {
  const value = process.env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function getRequiredNumberEnv(key: string): number {
  const value = Number(getRequiredEnv(key));

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return value;
}

function getOptionalNumberEnv(key: string, defaultValue: number): number {
  const rawValue = process.env[key];

  if (rawValue === undefined || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return value;
}
