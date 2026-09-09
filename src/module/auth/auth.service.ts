import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { AccessTokenPayload } from './auth.types';
import {
  getPhoneLookupVariants,
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
import {
  Customer,
  type CustomerStatus,
} from '../customer/schema/customer.entity';
import {
  User,
  type UserRole,
  type UserStatus,
} from '../user/schema/user.entity';
import { PasswordHasherService } from './password-hasher.service';

interface RegistrationInput {
  fullName: string;
  email: string | null;
  phone: string;
  password: string;
}

interface LoginInput {
  identifier: string;
  password: string;
}

export interface CustomerResponse {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
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

export interface RegistrationResult {
  accepted: true;
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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly passwordHasher: PasswordHasherService,
    private readonly tokenService: AccessTokenService,
  ) {}

  async registerCustomer(
    body: RegisterCustomerDto,
  ): Promise<RegistrationResult> {
    const input = this.normalizeRegistration(body);
    const [passwordHash, existingEmail, existingPhone] = await Promise.all([
      this.passwordHasher.hash(input.password),
      this.customerRepo.findOneBy({
        email: input.email ?? '__registration_without_email__',
      }),
      this.customerRepo
        .createQueryBuilder('customer')
        .where('customer.phone IN (:...phones)', {
          phones: getPhoneLookupVariants(input.phone),
        })
        .getOne(),
    ]);

    if (existingEmail !== null || existingPhone !== null) {
      this.logRegistrationConflict(existingEmail, existingPhone);
      throw this.registrationConflict();
    }

    const customer = this.customerRepo.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash,
      status: 'ACTIVE',
    });
    try {
      await this.customerRepo.save(customer);
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey === undefined) {
        throw error;
      }

      this.logger.warn(
        `Customer registration rejected. reason=${this.getDuplicateReason(duplicateKey)}`,
      );

      throw this.registrationConflict();
    }

    return { accepted: true };
  }

  async loginCustomer(body: LoginDto): Promise<LoginResponse> {
    const input = this.normalizeLoginInput(body);
    const identifier = this.normalizeIdentifier(input.identifier);
    const customer = await this.findCustomerByIdentifier(identifier);

    const passwordMatches = await this.passwordHasher.verifyOrDummy(
      input.password,
      customer?.passwordHash ?? null,
    );

    if (
      customer === null ||
      customer.status !== 'ACTIVE' ||
      customer.passwordHash === null ||
      !passwordMatches
    ) {
      this.logAuthFailure(
        'customer',
        this.customerLoginReason(customer, passwordMatches),
      );
      throw this.invalidLoginException();
    }

    return {
      accessToken: this.tokenService.sign({
        actorType: 'customer',
        customerId: customer.id,
        tokenVersion: customer.tokenVersion,
      }),
      tokenType: 'Bearer',
      expiresIn: this.tokenService.getExpiresInSeconds(),
      actorType: 'customer',
      customer: this.toCustomerResponse(customer),
    };
  }

  async loginUser(body: LoginDto): Promise<LoginResponse> {
    const input = this.normalizeLoginInput(body);
    const identifier = this.normalizeIdentifier(input.identifier);
    const user = await this.findUserByIdentifier(identifier);

    const passwordMatches = await this.passwordHasher.verifyOrDummy(
      input.password,
      user?.passwordHash ?? null,
    );

    if (user === null || user.status !== 'ACTIVE' || !passwordMatches) {
      this.logAuthFailure('user', this.userLoginReason(user, passwordMatches));
      throw this.invalidLoginException();
    }

    return {
      accessToken: this.tokenService.sign({
        actorType: 'user',
        userId: user.id,
        role: user.role,
        tokenVersion: user.tokenVersion,
      }),
      tokenType: 'Bearer',
      expiresIn: this.tokenService.getExpiresInSeconds(),
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

      const customer = await this.customerRepo.findOneBy({
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

    const user = await this.userRepo.findOneBy({ id: userId });

    if (user === null || user.status === 'LOCKED') {
      throw new UnauthorizedException('Invalid access token.');
    }

    return {
      actorType: 'user',
      user: this.toUserResponse(user),
    };
  }

  private async findCustomerByIdentifier(
    identifier: string,
  ): Promise<Customer | null> {
    const email = isEmail(identifier) ? identifier.toLowerCase() : identifier;
    const phone = normalizePhone(identifier);
    const phones =
      phone === null ? [identifier] : getPhoneLookupVariants(phone);

    return this.customerRepo
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.deletedAt IS NULL')
      .andWhere(
        '(LOWER(customer.email) = :email OR customer.phone IN (:...phones))',
        { email, phones },
      )
      .getOne();
  }

  private async findUserByIdentifier(identifier: string): Promise<User | null> {
    const email = isEmail(identifier) ? identifier.toLowerCase() : identifier;
    const phone = normalizePhone(identifier);
    const phones =
      phone === null ? [identifier] : getPhoneLookupVariants(phone);

    return this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.deletedAt IS NULL')
      .andWhere('(LOWER(user.email) = :email OR user.phone IN (:...phones))', {
        email,
        phones,
      })
      .getOne();
  }

  private normalizeRegistration(body: RegisterCustomerDto): RegistrationInput {
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

  private normalizeLoginInput(body: LoginDto): LoginInput {
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

  private logAuthFailure(actorType: 'customer' | 'user', reason: string): void {
    this.logger.warn(
      `Authentication rejected. actorType=${actorType} reason=${reason}`,
    );
  }

  private customerLoginReason(
    customer: Customer | null,
    passwordMatches: boolean,
  ): string {
    if (customer === null) {
      return 'account_not_found';
    }

    if (customer.status !== 'ACTIVE') {
      return 'account_not_active';
    }

    if (customer.passwordHash === null) {
      return 'password_not_configured';
    }

    return passwordMatches ? 'unknown' : 'password_mismatch';
  }

  private userLoginReason(user: User | null, passwordMatches: boolean): string {
    if (user === null) {
      return 'account_not_found';
    }

    if (user.status !== 'ACTIVE') {
      return 'account_not_active';
    }

    return passwordMatches ? 'unknown' : 'password_mismatch';
  }

  private invalidLoginException(): UnauthorizedException {
    return new UnauthorizedException('Thong tin dang nhap khong hop le.');
  }

  private registrationConflict(): ConflictException {
    return new ConflictException(
      'Khong the dang ky bang email hoac so dien thoai nay.',
    );
  }

  private logRegistrationConflict(
    existingEmail: Customer | null,
    existingPhone: Customer | null,
  ): void {
    const reason =
      existingEmail !== null && existingPhone !== null
        ? 'duplicate_email_and_phone'
        : existingEmail !== null
          ? 'duplicate_email'
          : 'duplicate_phone';

    this.logger.warn(`Customer registration rejected. reason=${reason}`);
  }

  private getDuplicateReason(duplicateKey: string): string {
    if (duplicateKey.includes('email')) {
      return 'duplicate_email_race';
    }

    if (duplicateKey.includes('phone')) {
      return 'duplicate_phone_race';
    }

    return 'duplicate_identifier_race';
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
