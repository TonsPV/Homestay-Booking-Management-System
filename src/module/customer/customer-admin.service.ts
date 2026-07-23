import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import type { AccountStatus, PaginationMeta } from '../../common/http';
import {
  optionalAccountStatus,
  optionalSearch,
  parsePagination,
  requireAccountStatus,
} from '../../common/validation';
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
}

export interface AdminCustomerListResponse {
  items: AdminCustomerResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class CustomerAdminService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
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
    const customer = await this.getCustomer(id);
    customer.status = requireAccountStatus(statusValue);

    return this.toAdminCustomerResponse(
      await this.customersRepository.save(customer),
    );
  }

  private async getCustomer(id: string): Promise<Customer> {
    this.validateId(id);

    const customer = await this.customersRepository.findOneBy({ id });

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
