import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

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
    this.optionalIssuableRole(body.role);

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
    return this.withUserTransaction((repository) =>
      this.updateUserWithRepository(repository, id, body, currentAdminId),
    );
  }

  private async updateUserWithRepository(
    repository: Repository<User>,
    id: string,
    body: UpdateUserDto,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    const user = await this.getUser(id, repository);
    const fullName = optionalTrimmedString(
      body.fullName,
      'Ho ten khong hop le.',
      120,
    );
    const email = optionalEmail(body.email);
    const phone = optionalNullablePhone(body.phone);
    const password = optionalPassword(body.password);
    const role = this.optionalIssuableRole(body.role);

    if (
      fullName === undefined &&
      email === undefined &&
      phone === undefined &&
      password === undefined &&
      role === undefined
    ) {
      throw new BadRequestException('Khong co thong tin user de cap nhat.');
    }

    if (email !== undefined) {
      await this.ensureEmailIsAvailable(email, user.id, repository);
      user.email = email;
    }

    if (phone !== undefined) {
      if (phone !== null) {
        await this.ensurePhoneIsAvailable(phone, user.id, repository);
      }

      user.phone = phone;
    }

    if (fullName !== undefined) {
      user.fullName = fullName;
    }

    if (role !== undefined) {
      if (currentAdminId !== undefined && user.id === currentAdminId) {
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
      return this.toAdminUserResponse(await repository.save(user));
    } catch (error) {
      this.throwUserDuplicateConflict(error);
    }
  }

  async updateStatus(
    id: string,
    statusValue: unknown,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    return this.withUserTransaction((repository) =>
      this.updateStatusWithRepository(
        repository,
        id,
        statusValue,
        currentAdminId,
      ),
    );
  }

  private async updateStatusWithRepository(
    repository: Repository<User>,
    id: string,
    statusValue: unknown,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    const user = await this.getUser(id, repository);
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

    if (user.status !== status) {
      user.status = status;
      user.tokenVersion += 1;
    }

    return this.toAdminUserResponse(await repository.save(user));
  }

  private async withUserTransaction<T>(
    operation: (repository: Repository<User>) => Promise<T>,
  ): Promise<T> {
    const repository = this.usersRepository as Repository<User> & {
      manager?: EntityManager;
    };

    if (repository.manager === undefined) {
      return operation(this.usersRepository);
    }

    return repository.manager.transaction((manager) =>
      operation(manager.getRepository(User)),
    );
  }

  private async getUser(
    id: string,
    repository: Repository<User> = this.usersRepository,
  ): Promise<User> {
    this.validateId(id);

    const repositoryWithFindOne = repository as Repository<User> & {
      findOne?: Repository<User>['findOne'];
    };
    const user =
      typeof repositoryWithFindOne.findOne === 'function'
        ? await repositoryWithFindOne.findOne({
            where: { id },
            lock: { mode: 'pessimistic_write' },
          })
        : await repository.findOneBy({ id });

    if (user === null) {
      throw new NotFoundException('Khong tim thay user.');
    }

    return user;
  }

  private async ensureEmailIsAvailable(
    email: string,
    currentUserId?: string,
    repository: Repository<User> = this.usersRepository,
  ): Promise<void> {
    const existingUserQuery = repository
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
    repository: Repository<User> = this.usersRepository,
  ): Promise<void> {
    const existingUserQuery = repository
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

  private optionalIssuableRole(value: unknown): 'STAFF' | undefined {
    const role = this.optionalRole(value);

    if (role === 'ADMIN') {
      throw new BadRequestException('API nay chi dung de cap tai khoan STAFF.');
    }

    return role;
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
