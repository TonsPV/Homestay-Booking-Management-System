import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  createPaginationMeta,
  type PaginationMeta,
} from '../../common/pagination/pagination.types';
import {
  optionalNullableTrimmedString,
  optionalSearch,
  optionalTrimmedString,
  parseBoolean,
  parsePagination,
  requireTrimmedString,
} from '../../common/validation';
import { CreateAmenityDto } from './dto/create-amenity.dto';
import {
  AdminListAmenitiesQueryDto,
  ListAmenitiesQueryDto,
} from './dto/list-amenities-query.dto';
import { UpdateAmenityDto } from './dto/update-amenity.dto';
import { Amenity } from './schema/amenity.entity';
import { RoomType } from '../room-type/schema/room-type.entity';

export interface AmenityResponse {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAmenityResponse extends AmenityResponse {
  deletedAt: Date | null;
}

interface AmenityListResult<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

@Injectable()
export class AmenityService {
  constructor(
    @InjectRepository(Amenity)
    private readonly amenityRepo: Repository<Amenity>,
  ) {}

  async listPublic(
    query: ListAmenitiesQueryDto,
  ): Promise<AmenityListResult<AmenityResponse>> {
    const listResult = await this.findList(query, false);

    return {
      items: listResult.items.map((amenity) => this.toPublicResponse(amenity)),
      meta: listResult.meta,
    };
  }

  async getPublic(id: string): Promise<AmenityResponse> {
    return this.toPublicResponse(await this.getActiveAmenity(id));
  }

  async listAdmin(
    query: AdminListAmenitiesQueryDto,
  ): Promise<AmenityListResult<AdminAmenityResponse>> {
    const includeDeleted = parseBoolean(
      query.includeDeleted,
      false,
      'Include deleted khong hop le.',
    );
    const listResult = await this.findList(query, includeDeleted);

    return {
      items: listResult.items.map((amenity) => this.toAdminResponse(amenity)),
      meta: listResult.meta,
    };
  }

  async getAdmin(id: string): Promise<AdminAmenityResponse> {
    return this.toAdminResponse(await this.findWithDeleted(id));
  }

  async create(body: CreateAmenityDto): Promise<AdminAmenityResponse> {
    const name = requireTrimmedString(
      body.name,
      'Ten tien nghi khong hop le.',
      120,
    );
    const description =
      optionalNullableTrimmedString(
        body.description,
        'Mo ta tien nghi khong hop le.',
        500,
      ) ?? null;

    await this.assertNameAvailable(name);

    try {
      return this.toAdminResponse(
        await this.amenityRepo.save(
          this.amenityRepo.create({ name, description }),
        ),
      );
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async update(
    id: string,
    body: UpdateAmenityDto,
  ): Promise<AdminAmenityResponse> {
    this.validateId(id);
    const name = optionalTrimmedString(
      body.name,
      'Ten tien nghi khong hop le.',
      120,
    );
    const description = optionalNullableTrimmedString(
      body.description,
      'Mo ta tien nghi khong hop le.',
      500,
    );

    if (name === undefined && description === undefined) {
      throw new BadRequestException('Khong co du lieu de cap nhat.');
    }

    return this.amenityRepo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Amenity);
      const amenity = await this.lockActiveAmenity(manager, id);

      if (name !== undefined) {
        await this.assertNameAvailable(name, amenity.id, repository);
        amenity.name = name;
      }

      if (description !== undefined) {
        amenity.description = description;
      }

      try {
        return this.toAdminResponse(await repository.save(amenity));
      } catch (error) {
        this.throwDuplicateConflict(error);
      }
    });
  }

  async softDelete(id: string): Promise<AdminAmenityResponse> {
    this.validateId(id);
    const amenity = await this.amenityRepo.manager.transaction(
      async (manager) => {
        const amenity = await this.lockActiveAmenity(manager, id);

        if (await this.isUsedByActiveRoomType(manager, amenity.id)) {
          throw new AppHttpException(
            HttpStatus.CONFLICT,
            ErrorCode.AMENITY_IN_USE,
            'Khong the xoa tien nghi dang duoc loai phong su dung.',
          );
        }

        return manager.getRepository(Amenity).softRemove(amenity);
      },
    );

    return this.toAdminResponse(amenity);
  }

  async restore(id: string): Promise<AdminAmenityResponse> {
    const amenity = await this.findWithDeleted(id);

    if (amenity.deletedAt === null) {
      throw new BadRequestException('Tien nghi chua bi xoa.');
    }

    await this.assertNameAvailable(amenity.name, amenity.id);

    try {
      return this.toAdminResponse(await this.amenityRepo.recover(amenity));
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  private async findList(
    query: ListAmenitiesQueryDto,
    includeDeleted: boolean,
  ): Promise<AmenityListResult<Amenity>> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const amenitiesQuery = this.amenityRepo
      .createQueryBuilder('amenity')
      .orderBy('amenity.name', 'ASC')
      .addOrderBy('amenity.id', 'ASC')
      .skip(skip)
      .take(limit);

    if (includeDeleted) {
      amenitiesQuery.withDeleted();
    }

    if (search !== undefined) {
      amenitiesQuery.andWhere(
        '(LOWER(amenity.name) LIKE :search OR LOWER(amenity.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    const [items, total] = await amenitiesQuery.getManyAndCount();

    return {
      items,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  private async getActiveAmenity(id: string): Promise<Amenity> {
    this.validateId(id);

    const amenity = await this.amenityRepo.findOneBy({ id });

    if (amenity === null) {
      throw new NotFoundException('Khong tim thay tien nghi.');
    }

    return amenity;
  }

  private async findWithDeleted(id: string): Promise<Amenity> {
    this.validateId(id);

    const amenity = await this.amenityRepo
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.id = :id', { id })
      .getOne();

    if (amenity === null) {
      throw new NotFoundException('Khong tim thay tien nghi.');
    }

    return amenity;
  }

  private async assertNameAvailable(
    name: string,
    currentAmenityId?: string,
    repository: Repository<Amenity> = this.amenityRepo,
  ): Promise<void> {
    const query = repository
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.name = :name', { name });

    if (currentAmenityId !== undefined) {
      query.andWhere('amenity.id <> :currentAmenityId', {
        currentAmenityId,
      });
    }

    if ((await query.getOne()) !== null) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.AMENITY_NAME_ALREADY_EXISTS,
        'Ten tien nghi da ton tai, ke ca trong du lieu da xoa.',
      );
    }
  }

  private async lockActiveAmenity(
    manager: EntityManager,
    id: string,
  ): Promise<Amenity> {
    const amenity = await manager
      .getRepository(Amenity)
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    if (amenity === null || amenity.deletedAt !== null) {
      throw new NotFoundException('Khong tim thay tien nghi.');
    }

    return amenity;
  }

  private async isUsedByActiveRoomType(
    manager: EntityManager,
    id: string,
  ): Promise<boolean> {
    return manager
      .getRepository(RoomType)
      .createQueryBuilder('roomType')
      .innerJoin('roomType.amenities', 'amenity', 'amenity.id = :id', { id })
      .where('roomType.deletedAt IS NULL')
      .getExists();
  }

  private throwDuplicateConflict(error: unknown): never {
    if (getMysqlDuplicateKey(error) === undefined) {
      throw error;
    }

    throw new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.AMENITY_NAME_ALREADY_EXISTS,
      'Ten tien nghi da ton tai, ke ca trong du lieu da xoa.',
    );
  }

  private validateId(id: string): void {
    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException('Id khong hop le.');
    }
  }

  private toPublicResponse(amenity: Amenity): AmenityResponse {
    return {
      id: amenity.id,
      name: amenity.name,
      description: amenity.description,
      createdAt: amenity.createdAt,
      updatedAt: amenity.updatedAt,
    };
  }

  private toAdminResponse(amenity: Amenity): AdminAmenityResponse {
    return {
      ...this.toPublicResponse(amenity),
      deletedAt: amenity.deletedAt,
    };
  }
}
