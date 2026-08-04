import 'reflect-metadata';

import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import { User } from '../src/module/user/schema/user.entity';
import { Customer } from '../src/module/customer/schema/customer.entity';
import AppDataSource from '../src/database/data-source';
import { assertSafeE2eEnvironment } from '../src/config/e2e-environment';
import {
  requiredPhone,
  requireEmail,
  requirePassword,
} from '../src/common/validation';

interface FixtureAccount {
  email: string;
  fullName: string;
  role: 'ADMIN' | 'STAFF';
}

function requiredEnvironmentValue(key: string): string {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

async function provisionAccount(
  account: FixtureAccount,
  passwordHash: string,
): Promise<User> {
  const repository = AppDataSource.getRepository(User);
  const existing = await repository.findOne({
    where: { email: account.email },
    withDeleted: true,
  });

  if (existing) {
    existing.deletedAt = null;
    existing.fullName = account.fullName;
    existing.passwordHash = passwordHash;
    existing.phone = null;
    existing.role = account.role;
    existing.status = 'ACTIVE';
    existing.tokenVersion += 1;
    return repository.save(existing);
  }

  return repository.save(
    repository.create({
      ...account,
      passwordHash,
      phone: null,
      status: 'ACTIVE',
    }),
  );
}

async function provisionCounterCustomer(phone: string): Promise<Customer> {
  const repository = AppDataSource.getRepository(Customer);
  const existing = await repository.findOne({
    where: { phone },
    withDeleted: true,
  });

  if (existing) {
    existing.deletedAt = null;
    existing.email = null;
    existing.fullName = 'Live E2E Counter Customer';
    existing.passwordHash = null;
    existing.status = 'ACTIVE';
    existing.tokenVersion += 1;
    return repository.save(existing);
  }

  return repository.save(
    repository.create({
      email: null,
      fullName: 'Live E2E Counter Customer',
      passwordHash: null,
      phone,
      status: 'ACTIVE',
    }),
  );
}

async function main(): Promise<void> {
  assertSafeE2eEnvironment(process.env);

  const adminEmail = requireEmail(
    requiredEnvironmentValue('HBMS_LIVE_ADMIN_IDENTIFIER'),
  );
  const staffEmail = requireEmail(
    requiredEnvironmentValue('HBMS_LIVE_STAFF_IDENTIFIER'),
  );
  const password = requirePassword(
    requiredEnvironmentValue('HBMS_LIVE_AUTH_PASSWORD'),
  );
  const counterCustomerPhone = requiredPhone(
    requiredEnvironmentValue('HBMS_LIVE_COUNTER_CUSTOMER_PHONE'),
  );
  const passwordHash = await new PasswordHasherService().hash(password);

  await AppDataSource.initialize();

  try {
    const admin = await provisionAccount(
      {
        email: adminEmail,
        fullName: 'Live E2E Administrator',
        role: 'ADMIN',
      },
      passwordHash,
    );
    const staff = await provisionAccount(
      {
        email: staffEmail,
        fullName: 'Live E2E Staff',
        role: 'STAFF',
      },
      passwordHash,
    );
    const counterCustomer =
      await provisionCounterCustomer(counterCustomerPhone);

    console.log(
      `Provisioned live auth fixtures in test DB: ADMIN id=${admin.id}, STAFF id=${staff.id}, counter CUSTOMER id=${counterCustomer.id}.`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
