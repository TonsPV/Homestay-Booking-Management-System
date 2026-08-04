import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { AccountStatus, PaginationMeta } from '../../common/http';
import {
  optionalAccountStatus,
  optionalSearch,
  parsePagination,
  requireAccountStatus,
} from '../../common/validation';
import {
  CustomerCredentialPolicy,
  type CustomerCredentialCapabilities,
} from './customer-credential.policy';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { Customer } from './schema/customer.entity';

export interface AdminCustomerResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
  credentialCapabilities: CustomerCredentialCapabilities;
}

type AdminCustomerProfile = Omit<
  AdminCustomerResponse,
  'credentialCapabilities'
>;

export interface AdminCustomerListResponse {
  items: AdminCustomerResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class CustomerAdminService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
    private readonly customerCredentialPolicy: CustomerCredentialPolicy,
  ) {}

  async listCustomers(
    query: ListCustomersQueryDto,
  ): Promise<AdminCustomerListResponse> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const status = optionalAccountStatus(query.status);
    const customersQuery = this.customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.deletedAt IS NULL')
      .orderBy('customer.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (search !== undefined) {
      customersQuery.andWhere(
        '(LOWER(customer.fullName) LIKE :search OR LOWER(customer.email) LIKE :search OR customer.phone LIKE :phoneSearch)',
        {
          search: `%${search.toLowerCase()}%`,
          phoneSearch: `%${search}%`,
        },
      );
    }

    if (status !== undefined) {
      customersQuery.andWhere('customer.status = :status', { status });
    }

    const [customers, total] = await customersQuery.getManyAndCount();

    return {
      items: customers.map((customer) =>
        this.toAdminCustomerResponse(customer),
      ),
      meta: this.toPaginationMeta(page, limit, total),
    };
  }

  async updateStatus(
    id: string,
    statusValue: unknown,
  ): Promise<AdminCustomerResponse> {
    const customer = await this.withCustomerTransaction((repository) =>
      this.updateStatusWithRepository(repository, id, statusValue),
    );

    return {
      ...customer,
      credentialCapabilities:
        await this.customerCredentialPolicy.evaluateByCustomerId(id),
    };
  }

  private async updateStatusWithRepository(
    repository: Repository<Customer>,
    id: string,
    statusValue: unknown,
  ): Promise<AdminCustomerProfile> {
    const customer = await this.getCustomer(id, repository);
    const status = requireAccountStatus(statusValue);

    if (customer.status !== status) {
      customer.status = status;
      customer.tokenVersion += 1;
    }

    return this.toAdminCustomerProfile(await repository.save(customer));
  }

  private async withCustomerTransaction<T>(
    operation: (repository: Repository<Customer>) => Promise<T>,
  ): Promise<T> {
    const repository = this.customersRepository as Repository<Customer> & {
      manager?: EntityManager;
    };

    if (repository.manager === undefined) {
      return operation(this.customersRepository);
    }

    return repository.manager.transaction((manager) =>
      operation(manager.getRepository(Customer)),
    );
  }

  private async getCustomer(
    id: string,
    repository: Repository<Customer> = this.customersRepository,
  ): Promise<Customer> {
    this.validateId(id);

    const repositoryWithFindOne = repository as Repository<Customer> & {
      findOne?: Repository<Customer>['findOne'];
    };
    const customer =
      typeof repositoryWithFindOne.findOne === 'function'
        ? await repositoryWithFindOne.findOne({
            where: { id },
            lock: { mode: 'pessimistic_write' },
          })
        : await repository.findOneBy({ id });

    if (customer === null) {
      throw new NotFoundException('Khong tim thay customer.');
    }

    return customer;
  }

  private validateId(id: string): void {
    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException('Id khong hop le.');
    }
  }

  private toAdminCustomerResponse(customer: Customer): AdminCustomerResponse {
    return {
      ...this.toAdminCustomerProfile(customer),
      credentialCapabilities: this.customerCredentialPolicy.evaluate(customer),
    };
  }

  private toAdminCustomerProfile(customer: Customer): AdminCustomerProfile {
    return {
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      status: customer.status,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  private toPaginationMeta(
    page: number,
    limit: number,
    total: number,
  ): PaginationMeta {
    return {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
