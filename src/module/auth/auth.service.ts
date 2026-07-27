import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { AccessTokenPayload } from '../../common/http';
import {
  getVietnamesePhoneLookupVariants,
  isEmail,
  normalizePhone,
  optionalNullableEmail,
  requiredPhone,
  requireLoginPassword,
  requirePassword,
  requireTrimmedString,
} from '../../common/validation';
import { AccessTokenService } from './access-token.service';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { PasswordHasherService } from './password-hasher.service';

interface NormalizedRegisterCustomerInput {
  fullName: string;
  email: string | null;
  phone: string;
  password: string;
}

interface NormalizedLoginInput {
  identifier: string;
  password: string;
}

export interface CustomerResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  actorType: 'customer' | 'user';
  customer?: CustomerResponse;
  user?: UserResponse;
}

export type MeResponse =
  | {
      actorType: 'customer';
      customer: CustomerResponse;
    }
  | {
      actorType: 'user';
      user: UserResponse;
    };

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly passwordHasherService: PasswordHasherService,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  async registerCustomer(body: RegisterCustomerDto): Promise<CustomerResponse> {
    const input = this.normalizeRegisterCustomerInput(body);

    if (input.email !== null) {
      const existingEmail = await this.customersRepository.findOneBy({
        email: input.email,
      });

      if (existingEmail !== null) {
        throw new ConflictException('Email da duoc su dung.');
      }
    }

    const existingPhone = await this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.phone IN (:...phones)', {
        phones: getVietnamesePhoneLookupVariants(input.phone),
      })
      .getOne();

    if (existingPhone !== null) {
      throw new ConflictException('So dien thoai da duoc su dung.');
    }

    const passwordHash = await this.passwordHasherService.hash(input.password);
    const customer = this.customersRepository.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      status: 'ACTIVE',
    });
    let savedCustomer: Customer;

    try {
      savedCustomer = await this.customersRepository.save(customer);
    } catch (error) {
      this.throwCustomerDuplicateConflict(error);
    }

    return this.toCustomerResponse(savedCustomer);
  }

  async loginCustomer(body: LoginDto): Promise<LoginResponse> {
    const input = this.normalizeLoginInput(body);
    const identifier = this.normalizeIdentifier(input.identifier);
    const customer = await this.findCustomerForLogin(identifier);

    if (customer === null) {
      throw new UnauthorizedException('Thong tin dang nhap khong dung.');
    }

    if (customer.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }

    if (customer.passwordHash === null) {
      throw new ForbiddenException(
        'Khach chua co mat khau. Vui long tao mat khau hoac lien he ho tro.',
      );
    }

    const passwordMatches = await this.passwordHasherService.verify(
      input.password,
      customer.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Thong tin dang nhap khong dung.');
    }

    return {
      accessToken: this.accessTokenService.sign({
        actorType: 'customer',
        customerId: customer.id,
        tokenVersion: customer.tokenVersion,
      }),
      tokenType: 'Bearer',
      expiresIn: this.accessTokenService.getExpiresInSeconds(),
      actorType: 'customer',
      customer: this.toCustomerResponse(customer),
    };
  }

  async loginUser(body: LoginDto): Promise<LoginResponse> {
    const input = this.normalizeLoginInput(body);
    const identifier = this.normalizeIdentifier(input.identifier);
    const user = await this.findUserForLogin(identifier);

    if (user === null) {
      throw new UnauthorizedException('Thong tin dang nhap khong dung.');
    }

    if (user.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }

    const passwordMatches = await this.passwordHasherService.verify(
      input.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Thong tin dang nhap khong dung.');
    }

    return {
      accessToken: this.accessTokenService.sign({
        actorType: 'user',
        userId: user.id,
        role: user.role,
        tokenVersion: user.tokenVersion,
      }),
      tokenType: 'Bearer',
      expiresIn: this.accessTokenService.getExpiresInSeconds(),
      actorType: 'user',
      user: this.toUserResponse(user),
    };
  }

  async getMe(payload: AccessTokenPayload): Promise<MeResponse> {
    if (payload.actor_type === 'customer') {
      const customerId = payload.customer_id;

      if (customerId === undefined) {
        throw new UnauthorizedException('Invalid access token.');
      }

      const customer = await this.customersRepository.findOneBy({
        id: customerId,
      });

      if (customer === null || customer.status === 'LOCKED') {
        throw new UnauthorizedException('Invalid access token.');
      }

      return {
        actorType: 'customer',
        customer: this.toCustomerResponse(customer),
      };
    }

    const userId = payload.user_id;

    if (userId === undefined) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const user = await this.usersRepository.findOneBy({ id: userId });

    if (user === null || user.status === 'LOCKED') {
      throw new UnauthorizedException('Invalid access token.');
    }

    return {
      actorType: 'user',
      user: this.toUserResponse(user),
    };
  }

  private async findCustomerForLogin(
    identifier: string,
  ): Promise<Customer | null> {
    const email = isEmail(identifier) ? identifier.toLowerCase() : identifier;
    const phone = normalizePhone(identifier);
    const phones =
      phone === null ? [identifier] : getVietnamesePhoneLookupVariants(phone);

    return this.customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.deletedAt IS NULL')
      .andWhere(
        '(LOWER(customer.email) = :email OR customer.phone IN (:...phones))',
        { email, phones },
      )
      .getOne();
  }

  private async findUserForLogin(identifier: string): Promise<User | null> {
    const email = isEmail(identifier) ? identifier.toLowerCase() : identifier;
    const phone = normalizePhone(identifier);
    const phones =
      phone === null ? [identifier] : getVietnamesePhoneLookupVariants(phone);

    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.deletedAt IS NULL')
      .andWhere('(LOWER(user.email) = :email OR user.phone IN (:...phones))', {
        email,
        phones,
      })
      .getOne();
  }

  private normalizeRegisterCustomerInput(
    body: RegisterCustomerDto,
  ): NormalizedRegisterCustomerInput {
    const fullName = requireTrimmedString(
      body.fullName,
      'Ho ten la bat buoc.',
      120,
    );
    const email = optionalNullableEmail(body.email) ?? null;
    const phone = requiredPhone(body.phone);
    const password = requirePassword(body.password);

    return {
      fullName,
      email,
      phone,
      password,
    };
  }

  private normalizeLoginInput(body: LoginDto): NormalizedLoginInput {
    const identifier = this.firstTrimmedString([
      body.identifier,
      body.emailOrPhone,
      body.email,
      body.phone,
    ]);

    if (identifier === null) {
      throw new BadRequestException('Email hoac so dien thoai la bat buoc.');
    }

    return {
      identifier,
      password: requireLoginPassword(body.password),
    };
  }

  private firstTrimmedString(values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const trimmed = value.trim();

      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    return null;
  }

  private normalizeIdentifier(identifier: string): string {
    if (isEmail(identifier)) {
      return identifier.toLowerCase();
    }

    return normalizePhone(identifier) ?? identifier;
  }

  private throwCustomerDuplicateConflict(error: unknown): never {
    const duplicateKey = getMysqlDuplicateKey(error);

    if (duplicateKey === undefined) {
      throw error;
    }

    if (duplicateKey.includes('email')) {
      throw new ConflictException('Email da duoc su dung.');
    }

    if (duplicateKey.includes('phone')) {
      throw new ConflictException('So dien thoai da duoc su dung.');
    }

    throw new ConflictException('Thong tin customer da ton tai.');
  }

  private toCustomerResponse(customer: Customer): CustomerResponse {
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

  private toUserResponse(user: User): UserResponse {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
