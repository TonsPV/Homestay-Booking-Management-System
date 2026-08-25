import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type QueryDeepPartialEntity, type Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  getVietnamesePhoneLookupVariants,
  optionalNullableEmail,
  optionalTrimmedString,
  requiredPhone,
} from '../../common/validation';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { Customer, type CustomerStatus } from './schema/customer.entity';

export interface CustomerProfileResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CustomerProfileService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {}

  async getMe(
    customerId: string | undefined,
  ): Promise<CustomerProfileResponse> {
    const customer = await this.getActiveCustomer(customerId);

    return this.toCustomerProfileResponse(customer);
  }

  async updateMe(
    customerId: string | undefined,
    body: UpdateCustomerProfileDto,
  ): Promise<CustomerProfileResponse> {
    const customer = await this.getActiveCustomer(customerId);
    const fullName = optionalTrimmedString(
      body.fullName,
      'Ho ten khong hop le.',
      120,
    );
    const email = optionalNullableEmail(body.email);
    const phone =
      body.phone === undefined ? undefined : requiredPhone(body.phone);

    if (fullName === undefined && email === undefined && phone === undefined) {
      throw new BadRequestException('Khong co thong tin customer de cap nhat.');
    }

    const profileChanges: QueryDeepPartialEntity<Customer> = {};

    if (email !== undefined && email !== null) {
      await this.ensureEmailIsAvailable(email, customer.id);
      profileChanges.email = email;
    }

    if (email === null) {
      profileChanges.email = null;
    }

    if (phone !== undefined) {
      await this.ensurePhoneIsAvailable(phone, customer.id);
      profileChanges.phone = phone;
    }

    if (fullName !== undefined) {
      profileChanges.fullName = fullName;
    }

    try {
      const result = await this.customersRepository.update(
        {
          id: customer.id,
          status: 'ACTIVE',
          tokenVersion: customer.tokenVersion,
          deletedAt: IsNull(),
        },
        profileChanges,
      );

      if (result.affected !== 1) {
        throw new ConflictException(
          'Thong tin tai khoan da thay doi. Vui long tai lai va thu lai.',
        );
      }
    } catch (error) {
      this.throwCustomerDuplicateConflict(error);
    }

    return this.toCustomerProfileResponse(
      await this.getActiveCustomer(customer.id),
    );
  }

  private async getActiveCustomer(
    customerId: string | undefined,
  ): Promise<Customer> {
    if (customerId === undefined || customerId.length === 0) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    const customer = await this.customersRepository.findOneBy({
      id: customerId,
    });

    if (customer === null) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    if (customer.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }

    return customer;
  }

  private async ensureEmailIsAvailable(
    email: string,
    currentCustomerId: string,
  ): Promise<void> {
    const existingCustomer = await this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.deletedAt IS NULL')
      .andWhere('customer.id <> :currentCustomerId', { currentCustomerId })
      .andWhere('LOWER(customer.email) = :email', { email })
      .getOne();

    if (existingCustomer !== null) {
      throw this.contactConflict(
        'email',
        ErrorCode.CUSTOMER_EMAIL_IN_USE,
        'Email da duoc su dung.',
      );
    }
  }

  private async ensurePhoneIsAvailable(
    phone: string,
    currentCustomerId: string,
  ): Promise<void> {
    const existingCustomer = await this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.deletedAt IS NULL')
      .andWhere('customer.id <> :currentCustomerId', { currentCustomerId })
      .andWhere('customer.phone IN (:...phones)', {
        phones: getVietnamesePhoneLookupVariants(phone),
      })
      .getOne();

    if (existingCustomer !== null) {
      throw this.contactConflict(
        'phone',
        ErrorCode.CUSTOMER_PHONE_IN_USE,
        'So dien thoai da duoc su dung.',
      );
    }
  }

  private throwCustomerDuplicateConflict(error: unknown): never {
    const duplicateKey = getMysqlDuplicateKey(error);

    if (duplicateKey === undefined) {
      throw error;
    }

    if (duplicateKey.includes('email')) {
      throw this.contactConflict(
        'email',
        ErrorCode.CUSTOMER_EMAIL_IN_USE,
        'Email da duoc su dung.',
      );
    }

    if (duplicateKey.includes('phone')) {
      throw this.contactConflict(
        'phone',
        ErrorCode.CUSTOMER_PHONE_IN_USE,
        'So dien thoai da duoc su dung.',
      );
    }

    throw new ConflictException('Thong tin customer da ton tai.');
  }

  private contactConflict(
    field: 'email' | 'phone',
    errorCode:
      | typeof ErrorCode.CUSTOMER_EMAIL_IN_USE
      | typeof ErrorCode.CUSTOMER_PHONE_IN_USE,
    message: string,
  ): AppHttpException {
    return new AppHttpException(HttpStatus.CONFLICT, errorCode, message, {
      fieldErrors: {
        [field]: [{ errorCode, message }],
      },
    });
  }

  private toCustomerProfileResponse(
    customer: Customer,
  ): CustomerProfileResponse {
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
