import type { AdminUserResponse, AdminUserListResponse } from './user.types';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { UserRole } from '../../common/account/account.enums';
import { createPaginationMeta } from '../../common/pagination/pagination.types';
import {
  getPhoneLookupVariants,
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
import {
  AuditLogService,
  type AuditActorContext,
} from '../audit/audit-log.service';
import { AuditAction, AuditEntityType } from '../audit/domain/audit-log';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './schema/user.entity';

@Injectable()
export class UserAdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly passwordHasher: PasswordHasherService,
    private readonly auditLogService: AuditLogService,
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
    this.optionalStaffRole(body.role);

    await this.assertEmailAvailable(email);

    if (phone !== null) {
      await this.assertPhoneAvailable(phone);
    }

    const user = this.userRepo.create({
      fullName,
      email,
      phone,
      passwordHash: await this.passwordHasher.hash(password),
      role: 'STAFF',
      status: 'ACTIVE',
    });

    try {
      return this.toAdminResponse(await this.userRepo.save(user));
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async listUsers(query: ListUsersQueryDto): Promise<AdminUserListResponse> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const role = this.optionalRole(query.role);
    const status = optionalAccountStatus(query.status);
    const usersQuery = this.userRepo
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
      items: users.map((user) => this.toAdminResponse(user)),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async updateUser(
    id: string,
    body: UpdateUserDto,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    return this.withTransaction((repository) =>
      this.saveUserChanges(repository, id, body, currentAdminId),
    );
  }

  private async saveUserChanges(
    repository: Repository<User>,
    id: string,
    body: UpdateUserDto,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    const user = await this.lockUserForUpdate(id, repository);
    const fullName = optionalTrimmedString(
      body.fullName,
      'Ho ten khong hop le.',
      120,
    );
    const email = optionalEmail(body.email);
    const phone = optionalNullablePhone(body.phone);
    const password = optionalPassword(body.password);
    const role = this.optionalStaffRole(body.role);

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
      await this.assertEmailAvailable(email, user.id, repository);
      user.email = email;
    }

    if (phone !== undefined) {
      if (phone !== null) {
        await this.assertPhoneAvailable(phone, user.id, repository);
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
      user.passwordHash = await this.passwordHasher.hash(password);
      user.tokenVersion += 1;
    }

    try {
      return this.toAdminResponse(await repository.save(user));
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async updateStatus(
    id: string,
    statusValue: unknown,
    currentAdminId: string | undefined,
    auditContext: AuditActorContext,
  ): Promise<AdminUserResponse> {
    return this.withTransaction((repository, manager) =>
      this.saveStatus(
        repository,
        id,
        statusValue,
        currentAdminId,
        manager,
        auditContext,
      ),
    );
  }

  private async saveStatus(
    repository: Repository<User>,
    id: string,
    statusValue: unknown,
    currentAdminId: string | undefined,
    manager: EntityManager,
    auditContext: AuditActorContext,
  ): Promise<AdminUserResponse> {
    const user = await this.lockUserForUpdate(id, repository);
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
      const previousStatus = user.status;
      user.status = status;
      user.tokenVersion += 1;
      const savedUser = await repository.save(user);

      await this.auditLogService.record(manager, {
        ...auditContext,
        action:
          status === 'LOCKED'
            ? AuditAction.ACCOUNT_LOCKED
            : AuditAction.ACCOUNT_UNLOCKED,
        entityType: AuditEntityType.USER,
        entityId: savedUser.id,
        metadata: { fromStatus: previousStatus, toStatus: status },
      });

      return this.toAdminResponse(savedUser);
    }

    return this.toAdminResponse(await repository.save(user));
  }

  private async withTransaction<T>(
    operation: (
      repository: Repository<User>,
      manager: EntityManager,
    ) => Promise<T>,
  ): Promise<T> {
    return this.userRepo.manager.transaction((manager) =>
      operation(manager.getRepository(User), manager),
    );
  }

  private async lockUserForUpdate(
    id: string,
    repository: Repository<User>,
  ): Promise<User> {
    this.validateId(id);

    const user = await repository.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (user === null) {
      throw new NotFoundException('Khong tim thay user.');
    }

    return user;
  }

  private async assertEmailAvailable(
    email: string,
    currentUserId?: string,
    repository: Repository<User> = this.userRepo,
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

  private async assertPhoneAvailable(
    phone: string,
    currentUserId?: string,
    repository: Repository<User> = this.userRepo,
  ): Promise<void> {
    const existingUserQuery = repository
      .createQueryBuilder('user')
      .where('user.deletedAt IS NULL')
      .andWhere('user.phone IN (:...phones)', {
        phones: getPhoneLookupVariants(phone),
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

  private throwDuplicateConflict(error: unknown): never {
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

  private optionalStaffRole(value: unknown): 'STAFF' | undefined {
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

  private toAdminResponse(user: User): AdminUserResponse {
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
