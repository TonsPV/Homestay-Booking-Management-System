import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import {
  CustomerCredentialPolicy,
  type CredentialCapabilities,
} from './customer-credential.policy';
import { Customer } from './schema/customer.entity';

@Injectable()
export class CustomerCredentialLookupService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly credentialPolicy: CustomerCredentialPolicy,
  ) {}

  async getCapabilitiesByCustomerId(
    customerId: string,
  ): Promise<CredentialCapabilities> {
    const customer = await this.customerRepo
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :customerId', { customerId })
      .andWhere('customer.deletedAt IS NULL')
      .getOne();

    return this.credentialPolicy.evaluate(customer);
  }
}
