import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../../common/http';
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

    const existingPhone = await this.customersRepository.findOneBy({
      phone: input.phone,
    });

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
    const savedCustomer = await this.customersRepository.save(customer);

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
    const email = this.looksLikeEmail(identifier)
      ? identifier.toLowerCase()
      : identifier;
    const phone = this.tryNormalizePhone(identifier) ?? identifier;

    return this.customersRepository
      .createQueryBuilder('customer')
      .addSelect('customer.passwordHash')
      .where('customer.deletedAt IS NULL')
      .andWhere('(LOWER(customer.email) = :email OR customer.phone = :phone)', {
        email,
        phone,
      })
      .getOne();
  }

  private async findUserForLogin(identifier: string): Promise<User | null> {
    const email = this.looksLikeEmail(identifier)
      ? identifier.toLowerCase()
      : identifier;
    const phone = this.tryNormalizePhone(identifier) ?? identifier;

    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.deletedAt IS NULL')
      .andWhere('(LOWER(user.email) = :email OR user.phone = :phone)', {
        email,
        phone,
      })
      .getOne();
  }

  private normalizeRegisterCustomerInput(
    body: RegisterCustomerDto,
  ): NormalizedRegisterCustomerInput {
    const fullName = this.requireTrimmedString(
      body.fullName,
      'Ho ten la bat buoc.',
    );
    const email = this.optionalEmail(body.email);
    const phone = this.requiredPhone(body.phone);
    const password = this.requirePassword(body.password, true);

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
      password: this.requirePassword(body.password, false),
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

  private requireTrimmedString(value: unknown, message: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(message);
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException(message);
    }

    return trimmed;
  }

  private optionalEmail(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const email = this.requireTrimmedString(
      value,
      'Email khong hop le.',
    ).toLowerCase();

    if (!this.looksLikeEmail(email)) {
      throw new BadRequestException('Email khong hop le.');
    }

    return email;
  }

  private requiredPhone(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('So dien thoai la bat buoc.');
    }

    const phone = this.tryNormalizePhone(value);

    if (phone === null) {
      throw new BadRequestException('So dien thoai khong hop le.');
    }

    return phone;
  }

  private normalizeIdentifier(identifier: string): string {
    if (this.looksLikeEmail(identifier)) {
      return identifier.toLowerCase();
    }

    return this.tryNormalizePhone(identifier) ?? identifier;
  }

  private tryNormalizePhone(value: string): string | null {
    const normalized = value.trim().replace(/[().\-\s]/g, '');

    if (!/^\+?[0-9]{7,20}$/.test(normalized)) {
      return null;
    }

    return normalized;
  }

  private requirePassword(value: unknown, enforcePolicy: boolean): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException('Mat khau la bat buoc.');
    }

    if (value.trim().length === 0) {
      throw new BadRequestException('Mat khau khong hop le.');
    }

    if (enforcePolicy && (value.length < 8 || value.length > 72)) {
      throw new BadRequestException('Mat khau phai tu 8 den 72 ky tu.');
    }

    return value;
  }

  private looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
