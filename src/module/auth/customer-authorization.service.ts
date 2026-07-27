import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import {
  CustomerAuthorizationReader,
  type CustomerAuthorizationState,
} from '../../common/http';
import { Customer } from '../customer/schema/customer.entity';

@Injectable()
export class CustomerAuthorizationService extends CustomerAuthorizationReader {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {
    super();
  }

  async findById(id: string): Promise<CustomerAuthorizationState | null> {
    const customer = await this.customersRepository.findOneBy({ id });

    if (customer === null) {
      return null;
    }

    return {
      id: customer.id,
      status: customer.status,
      tokenVersion: customer.tokenVersion,
    };
  }
}
