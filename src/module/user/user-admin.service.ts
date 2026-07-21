import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import type {
  AccountStatus,
  PaginationMeta,
  UserRole,
} from '../../common/http';
import {
  optionalEmail,
  optionalNullablePhone,
  optionalPassword,
  optionalSearch,
  optionalTrimmedString,
  parsePagination,
  requireEmail,
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
    const role = this.optionalRole(body.role) ?? 'STAFF';

    await this.ensureEmailIsAvailable(email);

    if (phone !== null) {
      await this.ensurePhoneIsAvailable(phone);
    }

    const user = this.usersRepository.create({
      fullName,
      email,
      phone,
      passwordHash: await this.passwordHasherService.hash(password),
      role,
      status: 'ACTIVE',
    });

    return this.toAdminUserResponse(await this.usersRepository.save(user));
  }

  async listUsers(query: ListUsersQueryDto): Promise<AdminUserListResponse> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const role = this.optionalRole(query.role);
    const status = this.optionalStatus(query.status);
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
      user.role = role;
    }

    if (password !== undefined) {
      user.passwordHash = await this.passwordHasherService.hash(password);
    }

    return this.toAdminUserResponse(await this.usersRepository.save(user));
  }

  async lockUser(
    id: string,
    currentAdminId: string | undefined,
  ): Promise<AdminUserResponse> {
    const user = await this.getUser(id);

    if (currentAdminId !== undefined && user.id === currentAdminId) {
      throw new BadRequestException(
        'Admin khong the tu khoa tai khoan cua minh.',
      );
    }

    user.status = 'LOCKED';

    return this.toAdminUserResponse(await this.usersRepository.save(user));
  }

  async unlockUser(id: string): Promise<AdminUserResponse> {
    const user = await this.getUser(id);
    user.status = 'ACTIVE';

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
      .andWhere('user.phone = :phone', { phone });

    if (currentUserId !== undefined) {
      existingUserQuery.andWhere('user.id <> :currentUserId', {
        currentUserId,
      });
    }

    if ((await existingUserQuery.getOne()) !== null) {
      throw new ConflictException('So dien thoai da duoc su dung.');
    }
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

  private optionalStatus(value: unknown): AccountStatus | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (value !== 'ACTIVE' && value !== 'LOCKED') {
      throw new BadRequestException('Trang thai khong hop le.');
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
