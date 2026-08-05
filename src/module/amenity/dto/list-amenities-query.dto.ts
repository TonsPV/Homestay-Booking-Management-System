import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class ListAmenitiesQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @Allow()
  limit?: unknown;

  @ApiPropertyOptional({ example: 'wifi', type: String })
  @Allow()
  search?: unknown;
}

export class AdminListAmenitiesQueryDto extends ListAmenitiesQueryDto {
  @ApiPropertyOptional({ default: false, example: true, type: Boolean })
  @Allow()
  includeDeleted?: unknown;
}
