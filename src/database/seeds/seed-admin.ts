import 'reflect-metadata';

import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import {
  optionalNullablePhone,
  requireEmail,
  requirePassword,
  requireTrimmedString,
} from '../../common/validation';
import { PasswordHasherService } from '../../module/auth/password-hasher.service';
import { User } from '../../module/user/schema/user.entity';

config({ quiet: true });

interface SeedAdminInput {
  fullName: string;
  email: string;
  phone: string | null;
  password: string;
}

async function main(): Promise<void> {
  const input = getSeedAdminInput();
  const dataSource = new DataSource({
    type: 'mysql',
    host: getRequiredEnv('DB_HOST'),
    port: getRequiredNumberEnv('DB_PORT'),
    username: getRequiredEnv('DB_USERNAME'),
    password: getRequiredEnv('DB_PASSWORD'),
    database: getRequiredEnv('DB_DATABASE'),
    timezone: 'Z',
    entities: [User],
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const usersRepository = dataSource.getRepository(User);
    const existingUser = await usersRepository.findOneBy({
      email: input.email,
    });

    if (existingUser !== null) {
      if (existingUser.role !== 'ADMIN') {
        throw new Error(
          `User with email ${input.email} already exists but is not ADMIN.`,
        );
      }

      console.log(
        `Admin user already exists: id=${existingUser.id}, email=${existingUser.email}, status=${existingUser.status}.`,
      );
      return;
    }

    const passwordHasherService = new PasswordHasherService();
    const admin = usersRepository.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: await passwordHasherService.hash(input.password),
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const savedAdmin = await usersRepository.save(admin);

    console.log(
      `Seeded admin user: id=${savedAdmin.id}, email=${savedAdmin.email}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

function getSeedAdminInput(): SeedAdminInput {
  return {
    fullName: requireTrimmedString(
      getRequiredEnv('SEED_ADMIN_FULL_NAME'),
      'SEED_ADMIN_FULL_NAME khong hop le.',
      120,
    ),
    email: requireEmail(getRequiredEnv('SEED_ADMIN_EMAIL')),
    phone: optionalNullablePhone(process.env.SEED_ADMIN_PHONE) ?? null,
    password: requirePassword(getRequiredEnv('SEED_ADMIN_PASSWORD')),
  };
}

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

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown seed error.';

  console.error(`Seed admin failed: ${message}`);
  process.exitCode = 1;
});
