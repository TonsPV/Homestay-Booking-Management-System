import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import { CustomerProfileService } from '../../../../src/module/customer/customer-profile.service';
import { Customer } from '../../../../src/module/customer/schema/customer.entity';

describe('CustomerProfileService', () => {
  let repository: {
    findOneBy: jest.Mock;
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
  };
  let service: CustomerProfileService;

  beforeEach(() => {
    repository = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new CustomerProfileService(
      repository as unknown as Repository<Customer>,
    );
  });

  it('returns only the authenticated active customer profile', async () => {
    repository.findOneBy.mockResolvedValue(customerFixture());

    await expect(service.getMe('10')).resolves.toEqual({
      id: '10',
      fullName: 'Customer',
      email: 'customer@example.com',
      phone: '+84705840355',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(repository.findOneBy).toHaveBeenCalledWith({ id: '10' });
  });

  it.each([
    { id: undefined, customer: null, error: UnauthorizedException },
    { id: '10', customer: null, error: UnauthorizedException },
    {
      id: '10',
      customer: customerFixture({ status: 'LOCKED' }),
      error: ForbiddenException,
    },
  ])(
    'rejects profile read for invalid current account',
    async ({ id, customer, error }) => {
      repository.findOneBy.mockResolvedValue(customer);

      await expect(service.getMe(id)).rejects.toBeInstanceOf(error);
    },
  );

  it('normalizes and updates nullable contact fields', async () => {
    const customer = customerFixture();
    const updatedCustomer = customerFixture({
      fullName: 'Updated Customer',
      email: null,
      phone: '+84912345678',
    });
    const phoneQuery = createUniqueQueryBuilder(null);
    repository.findOneBy
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce(updatedCustomer);
    repository.createQueryBuilder.mockReturnValue(phoneQuery);

    await expect(
      service.updateMe('10', {
        fullName: '  Updated Customer ',
        email: null,
        phone: '091 234 5678',
      }),
    ).resolves.toMatchObject({
      fullName: 'Updated Customer',
      email: null,
      phone: '+84912345678',
    });
    expect(phoneQuery.andWhere).toHaveBeenCalledWith(
      'customer.phone IN (:...phones)',
      {
        phones: ['+84912345678', '0912345678', '84912345678'],
      },
    );
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '10',
        status: 'ACTIVE',
        tokenVersion: 0,
      }),
      {
        email: null,
        fullName: 'Updated Customer',
        phone: '+84912345678',
      },
    );
  });

  it('normalizes email and excludes the current customer from uniqueness', async () => {
    const customer = customerFixture();
    const updatedCustomer = customerFixture({
      email: 'updated@example.com',
    });
    const emailQuery = createUniqueQueryBuilder(null);
    repository.findOneBy
      .mockResolvedValueOnce(customer)
      .mockResolvedValueOnce(updatedCustomer);
    repository.createQueryBuilder.mockReturnValue(emailQuery);

    await service.updateMe('10', {
      email: ' UPDATED@EXAMPLE.COM ',
    });

    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '10',
        status: 'ACTIVE',
        tokenVersion: 0,
      }),
      { email: 'updated@example.com' },
    );
    expect(emailQuery.andWhere).toHaveBeenCalledWith(
      'customer.id <> :currentCustomerId',
      { currentCustomerId: '10' },
    );
  });

  it('rejects an empty profile update', async () => {
    repository.findOneBy.mockResolvedValue(customerFixture());

    await expect(service.updateMe('10', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([
    { body: { email: 'used@example.com' }, message: 'Email' },
    { body: { phone: '0901234567' }, message: 'So dien thoai' },
  ])('rejects duplicate profile contact data', async ({ body, message }) => {
    repository.findOneBy.mockResolvedValue(customerFixture());
    repository.createQueryBuilder.mockReturnValue(
      createUniqueQueryBuilder(customerFixture({ id: '11' })),
    );

    await expect(service.updateMe('10', body)).rejects.toThrow(message);
  });

  it('returns Conflict when account security state changes during profile update', async () => {
    const customer = customerFixture();
    repository.findOneBy.mockResolvedValue(customer);
    repository.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.updateMe('10', { fullName: 'Updated Customer' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '10',
        status: 'ACTIVE',
        tokenVersion: 0,
      }),
      { fullName: 'Updated Customer' },
    );
  });
});

function createUniqueQueryBuilder(result: Customer | null) {
  const queryBuilder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result),
  };

  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);

  return queryBuilder;
}

function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: '10',
    fullName: 'Customer',
    email: 'customer@example.com',
    phone: '+84705840355',
    passwordHash: 'password-hash',
    tokenVersion: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}
