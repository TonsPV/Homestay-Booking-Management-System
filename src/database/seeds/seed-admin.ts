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
  assertSeedEnv(
    process.env.NODE_ENV,
    process.argv.includes('--allow-production'),
  );
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
    const userRepo = dataSource.getRepository(User);
    const existingUser = await userRepo.findOneBy({
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

    const passwordHasher = new PasswordHasherService();
    const admin = userRepo.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: await passwordHasher.hash(input.password),
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    const savedAdmin = await userRepo.save(admin);

    console.log(
      `Seeded admin user: id=${savedAdmin.id}, email=${savedAdmin.email}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

export function assertSeedEnv(
  nodeEnvironment: string | undefined,
  allowProduction: boolean,
): void {
  if (
    nodeEnvironment?.trim().toLowerCase() === 'production' &&
    !allowProduction
  ) {
    throw new Error(
      'Refusing to seed an admin in production without --allow-production.',
    );
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

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown seed error.';

    console.error(`Seed admin failed: ${message}`);
    process.exitCode = 1;
  });
}
