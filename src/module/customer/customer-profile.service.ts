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
  getPhoneLookupVariants,
  optionalNullableEmail,
  optionalTrimmedString,
  requiredPhone,
} from '../../common/validation';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { Customer, type CustomerStatus } from './schema/customer.entity';

export interface ProfileResponse {
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
    private readonly customerRepo: Repository<Customer>,
  ) {}

  //lay customer profile by id
  async getMe(customerId: string | undefined): Promise<ProfileResponse> {
    const customer = await this.getActiveCustomer(customerId);

    return this.toProfileResponse(customer);
  }

  //update customer profile
  async updateMe(
    customerId: string | undefined,
    body: UpdateCustomerProfileDto,
  ): Promise<ProfileResponse> {
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
      await this.assertEmailAvailable(email, customer.id);
      profileChanges.email = email;
    }

    if (email === null) {
      profileChanges.email = null;
    }

    if (phone !== undefined) {
      await this.assertPhoneAvailable(phone, customer.id);
      profileChanges.phone = phone;
    }

    if (fullName !== undefined) {
      profileChanges.fullName = fullName;
    }

    try {
      const updateResult = await this.customerRepo.update(
        {
          id: customer.id,
          status: 'ACTIVE',
          tokenVersion: customer.tokenVersion,
          deletedAt: IsNull(),
        },
        profileChanges,
      );

      if (updateResult.affected !== 1) {
        throw new ConflictException(
          'Thong tin tai khoan da thay doi. Vui long tai lai va thu lai.',
        );
      }
    } catch (error) {
      this.throwDuplicateConflict(error);
    }

    return this.toProfileResponse(await this.getActiveCustomer(customer.id));
  }

  //lay customer active by id
  private async getActiveCustomer(
    customerId: string | undefined,
  ): Promise<Customer> {
    if (customerId === undefined || customerId.length === 0) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    const customer = await this.customerRepo.findOneBy({
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

  //check email is available for update
  private async assertEmailAvailable(
    email: string,
    currentCustomerId: string,
  ): Promise<void> {
    const existingCustomer = await this.customerRepo
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

  //check phone is available for update
  private async assertPhoneAvailable(
    phone: string,
    currentCustomerId: string,
  ): Promise<void> {
    const existingCustomer = await this.customerRepo
      .createQueryBuilder('customer')
      .where('customer.deletedAt IS NULL')
      .andWhere('customer.id <> :currentCustomerId', { currentCustomerId })
      .andWhere('customer.phone IN (:...phones)', {
        phones: getPhoneLookupVariants(phone),
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

  //handle duplicate key error when update customer profile
  private throwDuplicateConflict(error: unknown): never {
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

  //create AppHttpException for contact conflict
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

  private toProfileResponse(customer: Customer): ProfileResponse {
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
