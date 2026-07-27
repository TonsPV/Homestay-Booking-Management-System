import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { PaginationMeta } from '../../common/http';
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
    private readonly amenitiesRepository: Repository<Amenity>,
  ) {}

  async listPublic(
    query: ListAmenitiesQueryDto,
  ): Promise<AmenityListResult<AmenityResponse>> {
    const result = await this.list(query, false);

    return {
      items: result.items.map((amenity) => this.toPublicResponse(amenity)),
      meta: result.meta,
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
    const result = await this.list(query, includeDeleted);

    return {
      items: result.items.map((amenity) => this.toAdminResponse(amenity)),
      meta: result.meta,
    };
  }

  async getAdmin(id: string): Promise<AdminAmenityResponse> {
    return this.toAdminResponse(await this.getAmenityWithDeleted(id));
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

    await this.ensureNameIsAvailable(name);

    try {
      return this.toAdminResponse(
        await this.amenitiesRepository.save(
          this.amenitiesRepository.create({ name, description }),
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
    const amenity = await this.getActiveAmenity(id);
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

    if (name !== undefined) {
      await this.ensureNameIsAvailable(name, amenity.id);
      amenity.name = name;
    }

    if (description !== undefined) {
      amenity.description = description;
    }

    try {
      return this.toAdminResponse(await this.amenitiesRepository.save(amenity));
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async softDelete(id: string): Promise<AdminAmenityResponse> {
    const amenity = await this.getActiveAmenity(id);

    return this.toAdminResponse(
      await this.amenitiesRepository.softRemove(amenity),
    );
  }

  async restore(id: string): Promise<AdminAmenityResponse> {
    const amenity = await this.getAmenityWithDeleted(id);

    if (amenity.deletedAt === null) {
      throw new BadRequestException('Tien nghi chua bi xoa.');
    }

    await this.ensureNameIsAvailable(amenity.name, amenity.id);

    try {
      return this.toAdminResponse(
        await this.amenitiesRepository.recover(amenity),
      );
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  private async list(
    query: ListAmenitiesQueryDto,
    includeDeleted: boolean,
  ): Promise<AmenityListResult<Amenity>> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const amenitiesQuery = this.amenitiesRepository
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
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  private async getActiveAmenity(id: string): Promise<Amenity> {
    this.validateId(id);

    const amenity = await this.amenitiesRepository.findOneBy({ id });

    if (amenity === null) {
      throw new NotFoundException('Khong tim thay tien nghi.');
    }

    return amenity;
  }

  private async getAmenityWithDeleted(id: string): Promise<Amenity> {
    this.validateId(id);

    const amenity = await this.amenitiesRepository
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.id = :id', { id })
      .getOne();

    if (amenity === null) {
      throw new NotFoundException('Khong tim thay tien nghi.');
    }

    return amenity;
  }

  private async ensureNameIsAvailable(
    name: string,
    currentAmenityId?: string,
  ): Promise<void> {
    const query = this.amenitiesRepository
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.name = :name', { name });

    if (currentAmenityId !== undefined) {
      query.andWhere('amenity.id <> :currentAmenityId', {
        currentAmenityId,
      });
    }

    if ((await query.getOne()) !== null) {
      throw new ConflictException(
        'Ten tien nghi da ton tai, ke ca trong du lieu da xoa.',
      );
    }
  }

  private throwDuplicateConflict(error: unknown): never {
    if (getMysqlDuplicateKey(error) === undefined) {
      throw error;
    }

    throw new ConflictException(
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
