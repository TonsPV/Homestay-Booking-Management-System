import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { requireLoginPassword, requirePassword } from '../../common/validation';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { ChangeCustomerPasswordDto } from './dto/change-customer-password.dto';
import { SetInitialCustomerPasswordDto } from './dto/set-initial-customer-password.dto';
import { Customer } from './schema/customer.entity';

export interface CustomerCredentialResult {
  passwordConfigured: true;
}

@Injectable()
export class CustomerCredentialService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordHasherService: PasswordHasherService,
  ) {}

  async changeOwnPassword(
    customerId: string | undefined,
    body: ChangeCustomerPasswordDto,
  ): Promise<CustomerCredentialResult> {
    if (customerId === undefined || customerId.length === 0) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    const currentPassword = requireLoginPassword(body.currentPassword);
    const newPassword = requirePassword(body.newPassword);

    return this.dataSource.transaction(async (manager) => {
      const customer = await this.getCustomerWithPassword(manager, customerId);

      if (customer === null) {
        throw new UnauthorizedException('Access token is invalid.');
      }

      if (
        !(await this.passwordHasherService.verify(
          currentPassword,
          customer.passwordHash,
        ))
      ) {
        throw new BadRequestException('Mat khau hien tai khong dung.');
      }

      if (
        await this.passwordHasherService.verify(
          newPassword,
          customer.passwordHash,
        )
      ) {
        throw new BadRequestException(
          'Mat khau moi phai khac mat khau hien tai.',
        );
      }

      customer.passwordHash =
        await this.passwordHasherService.hash(newPassword);
      customer.tokenVersion += 1;
      await manager.getRepository(Customer).save(customer);

      return { passwordConfigured: true };
    });
  }

  async setInitialPassword(
    customerId: string,
    body: SetInitialCustomerPasswordDto,
  ): Promise<CustomerCredentialResult> {
    this.validateCustomerId(customerId);
    const password = requirePassword(body.password);

    return this.dataSource.transaction(async (manager) => {
      const customer = await this.getCustomerWithPassword(manager, customerId);

      if (customer === null) {
        throw new NotFoundException('Khong tim thay customer.');
      }

      if (customer.passwordHash !== null) {
        throw new ConflictException('Customer da co mat khau.');
      }

      customer.passwordHash = await this.passwordHasherService.hash(password);
      customer.tokenVersion += 1;
      await manager.getRepository(Customer).save(customer);

      return { passwordConfigured: true };
    });
  }

  private getCustomerWithPassword(
    manager: EntityManager,
    customerId: string,
  ): Promise<Customer | null> {
    return manager
      .getRepository(Customer)
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.id = :customerId', { customerId })
      .andWhere('customer.deletedAt IS NULL')
      .setLock('pessimistic_write')
      .getOne();
  }

  private validateCustomerId(customerId: string): void {
    if (!/^[1-9][0-9]*$/.test(customerId)) {
      throw new BadRequestException('Id khong hop le.');
    }
  }
}
