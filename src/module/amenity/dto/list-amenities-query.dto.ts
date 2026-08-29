import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListAmenitiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'wifi', type: String })
  @Allow()
  search?: unknown;
}

export class AdminListAmenitiesQueryDto extends ListAmenitiesQueryDto {
  @ApiPropertyOptional({ default: false, example: true, type: Boolean })
  @Allow()
  includeDeleted?: unknown;
}
