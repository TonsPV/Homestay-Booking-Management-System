import type { EntityManager } from 'typeorm';

import AppDataSource from '../data-source';
import { Customer } from '../../module/customer/schema/customer.entity';
import { User } from '../../module/user/schema/user.entity';
import {
  buildPhonePlan,
  isProductionEnvironment,
  type PhoneNormalizationPlan,
  type PhoneRecord,
} from './phone-normalization';

const applyChanges = process.argv.includes('--apply');
const allowProduction = process.argv.includes('--allow-production');

async function main(): Promise<void> {
  if (
    applyChanges &&
    isProductionEnvironment(process.env.NODE_ENV) &&
    !allowProduction
  ) {
    throw new Error(
      'Refusing to normalize production data without --allow-production.',
    );
  }

  await AppDataSource.initialize();

  try {
    const initialPlan = buildPhonePlan(
      await readPhoneRecords(AppDataSource.manager, false),
    );

    printSummary(initialPlan, false);
    assertPlanCanBeApplied(initialPlan);

    if (!applyChanges || initialPlan.changes.length === 0) {
      return;
    }

    const appliedChanges = await AppDataSource.transaction(async (manager) => {
      const lockedPlan = buildPhonePlan(await readPhoneRecords(manager, true));

      assertPlanCanBeApplied(lockedPlan);

      for (const change of lockedPlan.changes) {
        const repository =
          change.source === 'users'
            ? manager.getRepository(User)
            : manager.getRepository(Customer);
        const result = await repository.update(
          { id: change.id, phone: change.currentPhone },
          { phone: change.normalizedPhone },
        );

        if (result.affected !== 1) {
          throw new Error(
            `Phone record changed concurrently: ${change.source}#${change.id}`,
          );
        }
      }

      return lockedPlan.changes.length;
    });

    console.log(
      JSON.stringify({
        mode: 'apply',
        database: String(AppDataSource.options.database),
        appliedChanges,
      }),
    );
  } finally {
    await AppDataSource.destroy();
  }
}

async function readPhoneRecords(
  manager: EntityManager,
  lockRows: boolean,
): Promise<PhoneRecord[]> {
  const usersQuery = manager
    .getRepository(User)
    .createQueryBuilder('user')
    .withDeleted()
    .select(['user.id', 'user.phone'])
    .orderBy('user.id', 'ASC');
  const customersQuery = manager
    .getRepository(Customer)
    .createQueryBuilder('customer')
    .withDeleted()
    .select(['customer.id', 'customer.phone'])
    .orderBy('customer.id', 'ASC');

  if (lockRows) {
    usersQuery.setLock('pessimistic_write');
    customersQuery.setLock('pessimistic_write');
  }

  const users = await usersQuery.getMany();
  const customers = await customersQuery.getMany();

  return [
    ...users.map((user) => ({
      source: 'users' as const,
      id: user.id,
      phone: user.phone,
    })),
    ...customers.map((customer) => ({
      source: 'customers' as const,
      id: customer.id,
      phone: customer.phone,
    })),
  ];
}

function assertPlanCanBeApplied(plan: PhoneNormalizationPlan): void {
  if (plan.invalidRecords.length > 0) {
    throw new Error(
      `Refusing to normalize: ${plan.invalidRecords.length} invalid phone record(s).`,
    );
  }

  if (plan.collisions.length > 0) {
    throw new Error(
      `Refusing to normalize: ${plan.collisions.length} canonical collision(s).`,
    );
  }
}

function printSummary(plan: PhoneNormalizationPlan, applied: boolean): void {
  console.log(
    JSON.stringify({
      mode: applied ? 'apply' : applyChanges ? 'preflight' : 'dry-run',
      database: String(AppDataSource.options.database),
      plannedChanges: plan.changes.length,
      invalidRecords: plan.invalidRecords.length,
      collisions: plan.collisions.length,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
