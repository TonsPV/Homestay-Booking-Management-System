import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { AccountStatus } from '../../common/domain/account.enums';
import {
  createPaginationMeta,
  type PaginationMeta,
} from '../../common/pagination/pagination.types';
import {
  AuditLogService,
  type AuditActorContext,
} from '../audit/audit-log.service';
import { AuditAction, AuditEntityType } from '../audit/domain/audit-log';
import {
  optionalAccountStatus,
  optionalSearch,
  parsePagination,
  requireAccountStatus,
} from '../../common/validation';
import {
  CustomerCredentialPolicy,
  type CredentialCapabilities,
} from './customer-credential.policy';
import { CustomerCredentialLookupService } from './customer-credential-lookup.service';
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
  credentialCapabilities: CredentialCapabilities;
}

type AdminProfile = Omit<AdminCustomerResponse, 'credentialCapabilities'>;

export interface AdminCustomerListResponse {
  items: AdminCustomerResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class CustomerAdminService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly credentialPolicy: CustomerCredentialPolicy,
    private readonly credentialLookup: CustomerCredentialLookupService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listCustomers(
    query: ListCustomersQueryDto,
  ): Promise<AdminCustomerListResponse> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const status = optionalAccountStatus(query.status);
    const customersQuery = this.customerRepo
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
      items: customers.map((customer) => this.toAdminResponse(customer)),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async updateStatus(
    id: string,
    statusValue: unknown,
    auditContext?: AuditActorContext,
  ): Promise<AdminCustomerResponse> {
    const customer = await this.withTransaction((repository, manager) =>
      this.saveStatus(repository, id, statusValue, manager, auditContext),
    );

    return {
      ...customer,
      credentialCapabilities:
        await this.credentialLookup.getCapabilitiesByCustomerId(id),
    };
  }

  private async saveStatus(
    repository: Repository<Customer>,
    id: string,
    statusValue: unknown,
    manager: EntityManager,
    auditContext: AuditActorContext | undefined,
  ): Promise<AdminProfile> {
    const customer = await this.lockCustomerForUpdate(id, repository);
    const status = requireAccountStatus(statusValue);

    if (customer.status !== status) {
      const previousStatus = customer.status;
      customer.status = status;
      customer.tokenVersion += 1;
      const savedCustomer = await repository.save(customer);

      if (auditContext !== undefined) {
        await this.auditLogService.record(manager, {
          ...auditContext,
          action:
            status === 'LOCKED'
              ? AuditAction.ACCOUNT_LOCKED
              : AuditAction.ACCOUNT_UNLOCKED,
          entityType: AuditEntityType.CUSTOMER,
          entityId: savedCustomer.id,
          metadata: { fromStatus: previousStatus, toStatus: status },
        });
      }

      return this.toAdminProfile(savedCustomer);
    }

    return this.toAdminProfile(await repository.save(customer));
  }

  private async withTransaction<T>(
    operation: (
      repository: Repository<Customer>,
      manager: EntityManager,
    ) => Promise<T>,
  ): Promise<T> {
    return this.customerRepo.manager.transaction((manager) =>
      operation(manager.getRepository(Customer), manager),
    );
  }

  private async lockCustomerForUpdate(
    id: string,
    repository: Repository<Customer>,
  ): Promise<Customer> {
    this.validateId(id);

    const customer = await repository.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

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

  private toAdminResponse(customer: Customer): AdminCustomerResponse {
    return {
      ...this.toAdminProfile(customer),
      credentialCapabilities: this.credentialPolicy.evaluate(customer),
    };
  }

  private toAdminProfile(customer: Customer): AdminProfile {
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
}
