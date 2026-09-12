import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListRoomsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '101', type: String })
  @Allow()
  search?: unknown;

  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  roomTypeId?: unknown;

  @ApiPropertyOptional({
    description:
      'Repeat this query parameter to require all selected amenities.',
    example: ['1', '2'],
    items: { pattern: '^[1-9][0-9]*$', type: 'string' },
    type: [String],
  })
  @Allow()
  amenityIds?: unknown;
}
