import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { RoomStatus } from '../domain/room-status';

export class ListManagementRoomsQueryDto extends PaginationQueryDto {
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
    enum: RoomStatus,
    example: RoomStatus.MAINTENANCE,
    type: String,
  })
  @Allow()
  status?: unknown;
}
