import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListRoomTypesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'phòng đôi', type: String })
  @Allow()
  search?: unknown;
}

export class AdminListRoomTypesQueryDto extends ListRoomTypesQueryDto {
  @ApiPropertyOptional({ default: false, example: true, type: Boolean })
  @Allow()
  includeDeleted?: unknown;
}
