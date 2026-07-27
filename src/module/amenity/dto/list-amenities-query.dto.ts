import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAmenitiesQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  limit?: unknown;

  @ApiPropertyOptional({ example: 'wifi', type: String })
  search?: unknown;
}

export class AdminListAmenitiesQueryDto extends ListAmenitiesQueryDto {
  @ApiPropertyOptional({ default: false, example: true, type: Boolean })
  includeDeleted?: unknown;
}
