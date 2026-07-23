import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type {
  AccountStatus,
  PaginationMeta,
  UserRole,
} from '../../common/http';
import {
  getVietnamesePhoneLookupVariants,
  optionalEmail,
  optionalAccountStatus,
  optionalNullablePhone,
  optionalPassword,
  optionalSearch,
  optionalTrimmedString,
  parsePagination,
  requireEmail,
  requireAccountStatus,
  requirePassword,
  requireTrimmedString,
} from '../../common/validation';
import { PasswordHasherService } from '../auth/password-hasher.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './schema/user.entity';

export interface AdminUserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUserListResponse {
  items: AdminUserResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class UserAdminService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly passwordHasherService: PasswordHasherService,
  ) {}

  async createUser(body: CreateUserDto): Promise<AdminUserResponse> {
    const fullName = requireTrimmedString(
      body.fullName,
      'Ho ten khong hop le.',
      120,
    );
    const email = requireEmail(body.email);
    const phone = optionalNullablePhone(body.phone) ?? null;
    const password = requirePassword(body.password);
    const requestedRole = this.optionalRole(body.role);

    if (requestedRole === 'ADMIN') {
      throw new BadRequestException('API nay chi dung de cap tai khoan STAFF.');
    }

    await this.ensureEmailIsAvailable(email);

    if (phone !== null) {
      await this.ensurePhoneIsAvailable(phone);
    }

    const user = this.usersRepository.create({
      fullName,
      email,
      phone,
      passwordHash: await this.passwordHasherService.hash(password),
      role: 'STAFF',
      status: 'ACTIVE',
    });

    try {
      return this.toAdminUserResponse(await this.usersRepository.save(user));
    } catch (error) {
      this.throwUserDuplicateConflict(error);
    }
  }

  async listUsers(query: ListUsersQueryDto): Promise<AdminUserListResponse> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const role = this.optionalRole(query.role);
    const status = optionalAccountStatus(query.status);
    const usersQuery = this.usersRepository
      .createQueryBuilder('user')
      .where('user.deletedAt IS NULL')
      .orderBy('user.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (search !== undefined) {
      usersQuery.andWhere(
        '(LOWER(user.fullName) LIKE :search OR LOWER(user.email) LIKE :search OR user.phone LIKE :phoneSearch)',
        {
          search: `%${search.toLowerCase()}%`,
          phoneSearch: `%${search}%`,
        },
      );
    }

    if (role !== undefined) {
      usersQuery.andWhere('user.role = :role', { role });
    }

    if (status !== undefined) {
      usersQuery.andWhere('user.status = :status', { status });
    }

    const [users, total] = await usersQuery.getManyAndCount();

    return {
      items: users.map((user) => this.toAdminUserResponse(user)),
      meta: this.toPaginationMeta(page, limit, total),
    };
  }

  async updateUser(
    id: string,
    body: UpdateUserDto,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    const user = await this.getUser(id);
    const fullName = optionalTrimmedString(
      body.fullName,
      'Ho ten khong hop le.',
      120,
    );
    const email = optionalEmail(body.email);
    const phone = optionalNullablePhone(body.phone);
    const password = optionalPassword(body.password);
    const role = this.optionalRole(body.role);

    if (email !== undefined) {
      await this.ensureEmailIsAvailable(email, user.id);
      user.email = email;
    }

    if (phone !== undefined) {
      if (phone !== null) {
        await this.ensurePhoneIsAvailable(phone, user.id);
      }

      user.phone = phone;
    }

    if (fullName !== undefined) {
      user.fullName = fullName;
    }

    if (role !== undefined) {
      if (
        currentAdminId !== undefined &&
        user.id === currentAdminId &&
        role !== 'ADMIN'
      ) {
        throw new BadRequestException(
          'Admin khong the tu ha quyen tai khoan cua minh.',
        );
      }

      user.role = role;
    }

    if (password !== undefined) {
      user.passwordHash = await this.passwordHasherService.hash(password);
      user.tokenVersion += 1;
    }

    try {
      return this.toAdminUserResponse(await this.usersRepository.save(user));
    } catch (error) {
      this.throwUserDuplicateConflict(error);
    }
  }

  async updateStatus(
    id: string,
    statusValue: unknown,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    const user = await this.getUser(id);
    const status = requireAccountStatus(statusValue);

    if (
      status === 'LOCKED' &&
      currentAdminId !== undefined &&
      user.id === currentAdminId
    ) {
      throw new BadRequestException(
        'Admin khong the tu khoa tai khoan cua minh.',
      );
    }

    user.status = status;

    return this.toAdminUserResponse(await this.usersRepository.save(user));
  }

  private async getUser(id: string): Promise<User> {
    this.validateId(id);

    const user = await this.usersRepository.findOneBy({ id });

    if (user === null) {
      throw new NotFoundException('Khong tim thay user.');
    }

    return user;
  }

  private async ensureEmailIsAvailable(
    email: string,
    currentUserId?: string,
  ): Promise<void> {
    const existingUserQuery = this.usersRepository
      .createQueryBuilder('user')
      .where('user.deletedAt IS NULL')
      .andWhere('LOWER(user.email) = :email', { email });

    if (currentUserId !== undefined) {
      existingUserQuery.andWhere('user.id <> :currentUserId', {
        currentUserId,
      });
    }

    if ((await existingUserQuery.getOne()) !== null) {
      throw new ConflictException('Email da duoc su dung.');
    }
  }

  private async ensurePhoneIsAvailable(
    phone: string,
    currentUserId?: string,
  ): Promise<void> {
    const existingUserQuery = this.usersRepository
      .createQueryBuilder('user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.phone IN (:...phones)', {
        phones: getVietnamesePhoneLookupVariants(phone),
      });

    if (currentUserId !== undefined) {
      existingUserQuery.andWhere('user.id <> :currentUserId', {
        currentUserId,
      });
    }

    if ((await existingUserQuery.getOne()) !== null) {
      throw new ConflictException('So dien thoai da duoc su dung.');
    }
  }

  private throwUserDuplicateConflict(error: unknown): never {
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

    throw new ConflictException('Thong tin user da ton tai.');
  }

  private optionalRole(value: unknown): UserRole | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (value !== 'STAFF' && value !== 'ADMIN') {
      throw new BadRequestException('Role khong hop le.');
    }

    return value;
  }

  private validateId(id: string): void {
    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException('Id khong hop le.');
    }
  }

  private toAdminUserResponse(user: User): AdminUserResponse {
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
