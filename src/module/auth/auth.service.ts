import type {
  CustomerResponse,
  UserResponse,
  LoginResponse,
  RegistrationResult,
  MeResponse,
  AccessTokenPayload,
} from './auth.types';

import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { AppHttpException } from '../../common/http/app-http-exception';
import { ErrorCode } from '../../common/error-codes';

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
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { PasswordHasherService } from './password-hasher.service';
import { CustomerAuthIdentity } from './schema/customer-auth-identity.entity';
import { GoogleCustomerLoginDto } from './dto/google-customer-login.dto';
import { GoogleIdentityVerifier } from './google-identity.verifier';

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
    @Optional()
    @InjectRepository(CustomerAuthIdentity)
    private readonly googleIdentityRepo?: Repository<CustomerAuthIdentity>,
    @Optional()
    private readonly googleVerifier?: GoogleIdentityVerifier,
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

    return this.createCustomerLoginResponse(customer);
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

    return this.createUserLoginResponse(user);
  }

  async login(body: LoginDto): Promise<LoginResponse> {
    const input = this.normalizeLoginInput(body);
    const identifier = this.normalizeIdentifier(input.identifier);
    const [customer, user] = await Promise.all([
      this.findCustomerByIdentifier(identifier),
      this.findUserByIdentifier(identifier),
    ]);
    const [customerPasswordMatches, userPasswordMatches] = await Promise.all([
      this.passwordHasher.verifyOrDummy(
        input.password,
        customer?.passwordHash ?? null,
      ),
      this.passwordHasher.verifyOrDummy(
        input.password,
        user?.passwordHash ?? null,
      ),
    ]);

    // A user account takes deterministic precedence if a legacy data set has
    // the same active credentials in both account tables.
    if (user !== null && user.status === 'ACTIVE' && userPasswordMatches) {
      return this.createUserLoginResponse(user);
    }

    if (
      customer !== null &&
      customer.status === 'ACTIVE' &&
      customer.passwordHash !== null &&
      customerPasswordMatches
    ) {
      return this.createCustomerLoginResponse(customer);
    }

    this.logAuthFailure('unified', 'credentials_invalid');
    throw this.invalidLoginException();
  }

  /**
   * Signs a customer in with a Google Identity Services ID token. Google is
   * only an identity provider here; the API always issues its own access
   * token and never stores the provider credential.
   *
   * A new Google identity needs a phone number because the Customer schema
   * requires one. The browser can retry this endpoint with the same short
   * lived ID token after collecting that number; the token stays in memory on
   * the client and is never put in a URL or persisted by the API.
   */
  async loginCustomerWithGoogle(
    body: GoogleCustomerLoginDto,
  ): Promise<LoginResponse> {
    const identityRepo = this.googleIdentityRepo;
    const verifier = this.googleVerifier;

    if (
      identityRepo === undefined ||
      verifier === undefined ||
      !verifier.isEnabled()
    ) {
      throw new ServiceUnavailableException(
        'Dang nhap Google chua duoc cau hinh.',
      );
    }

    const credential = requireTrimmedString(
      body.credential,
      'Google credential la bat buoc.',
      4096,
    );
    const googleIdentity = await verifier.verify(credential);
    const existingIdentity = await identityRepo.findOneBy({
      provider: 'google',
      providerSubject: googleIdentity.subject,
    });

    if (existingIdentity !== null) {
      return this.loginExistingGoogleCustomer(existingIdentity.customerId);
    }

    const existingCustomer = await this.findCustomerByEmailIncludingDeleted(
      googleIdentity.email,
    );

    if (existingCustomer !== null) {
      throw this.googleAccountConflict();
    }

    if (body.phone === undefined || body.phone.trim().length === 0) {
      throw this.googlePhoneRequired();
    }

    const phone = requiredPhone(body.phone);

    try {
      return await this.customerRepo.manager.transaction(async (manager) => {
        const transactionIdentityRepo =
          manager.getRepository(CustomerAuthIdentity);
        const transactionCustomerRepo = manager.getRepository(Customer);
        const lockedIdentity = await transactionIdentityRepo
          .createQueryBuilder('identity')
          .where('identity.provider = :provider', { provider: 'google' })
          .andWhere('identity.providerSubject = :providerSubject', {
            providerSubject: googleIdentity.subject,
          })
          .setLock('pessimistic_write')
          .getOne();

        if (lockedIdentity !== null) {
          const customer = await transactionCustomerRepo.findOneBy({
            id: lockedIdentity.customerId,
          });

          if (customer === null || customer.status !== 'ACTIVE') {
            throw this.invalidGoogleAccount();
          }

          return this.createCustomerLoginResponse(customer);
        }

        const customerByEmail = await transactionCustomerRepo
          .createQueryBuilder('customer')
          .withDeleted()
          .where('LOWER(customer.email) = :email', {
            email: googleIdentity.email,
          })
          .setLock('pessimistic_write')
          .getOne();

        if (customerByEmail !== null) {
          throw this.googleAccountConflict();
        }

        const customerByPhone = await transactionCustomerRepo
          .createQueryBuilder('customer')
          .withDeleted()
          .where('customer.phone IN (:...phones)', {
            phones: getPhoneLookupVariants(phone),
          })
          .setLock('pessimistic_write')
          .getOne();

        if (customerByPhone !== null) {
          throw this.googleAccountConflict();
        }

        const customer = await transactionCustomerRepo.save(
          transactionCustomerRepo.create({
            fullName: googleIdentity.fullName,
            email: googleIdentity.email,
            phone,
            passwordHash: null,
            status: 'ACTIVE',
          }),
        );

        await transactionIdentityRepo.save(
          transactionIdentityRepo.create({
            customerId: customer.id,
            provider: 'google',
            providerSubject: googleIdentity.subject,
          }),
        );

        return this.createCustomerLoginResponse(customer);
      });
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey?.includes('provider_subject')) {
        const racedIdentity = await identityRepo.findOneBy({
          provider: 'google',
          providerSubject: googleIdentity.subject,
        });

        if (racedIdentity !== null) {
          return this.loginExistingGoogleCustomer(racedIdentity.customerId);
        }
      }

      if (duplicateKey?.includes('email') || duplicateKey?.includes('phone')) {
        throw this.googleAccountConflict();
      }

      throw error;
    }
  }

  private async loginExistingGoogleCustomer(
    customerId: string,
  ): Promise<LoginResponse> {
    const customer = await this.customerRepo.findOneBy({ id: customerId });

    if (customer === null || customer.status !== 'ACTIVE') {
      throw this.invalidGoogleAccount();
    }

    return this.createCustomerLoginResponse(customer);
  }

  private findCustomerByEmailIncludingDeleted(
    email: string,
  ): Promise<Customer | null> {
    return this.customerRepo
      .createQueryBuilder('customer')
      .withDeleted()
      .where('LOWER(customer.email) = :email', { email })
      .getOne();
  }

  private googlePhoneRequired(): AppHttpException {
    return new AppHttpException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.AUTH_GOOGLE_PHONE_REQUIRED,
      'So dien thoai la bat buoc de tao tai khoan bang Google.',
    );
  }

  private googleAccountConflict(): AppHttpException {
    return new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.AUTH_GOOGLE_ACCOUNT_CONFLICT,
      'Email nay da duoc dang ky. Vui long dang nhap bang mat khau hien tai.',
    );
  }

  private invalidGoogleAccount(): AppHttpException {
    return new AppHttpException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.AUTH_GOOGLE_INVALID_TOKEN,
      'Google credential khong hop le.',
    );
  }

  private createCustomerLoginResponse(customer: Customer): LoginResponse {
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

  private createUserLoginResponse(user: User): LoginResponse {
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

  private logAuthFailure(
    actorType: 'customer' | 'user' | 'unified',
    reason: string,
  ): void {
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
