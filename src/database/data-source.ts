import 'reflect-metadata';

import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import { assertSafeE2eEnvironment } from '../config/e2e-environment';
import { Customer } from '../module/customer/schema/customer.entity';
import { RoomImage } from '../module/room/schema/room-image.entity';
import { Room } from '../module/room/schema/room.entity';
import { RoomType } from '../module/room-type/schema/room-type.entity';
import { User } from '../module/user/schema/user.entity';
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
  entities: [Customer, Room, RoomImage, RoomType, User],
  migrations: [
    InitialSchemaBaseline1784770000000,
    AlignEntityMetadata1784771000000,
    AlignRoomMetadata1784772000000,
    AddUserTokenVersion1784773000000,
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
