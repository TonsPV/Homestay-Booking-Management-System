import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { ListRoomsQueryDto } from './list-rooms-query.dto';
import { RoomStatus } from '../domain/room-status';

export class ListManagementRoomsQueryDto extends ListRoomsQueryDto {
  @ApiPropertyOptional({
    enum: RoomStatus,
    example: RoomStatus.MAINTENANCE,
    type: String,
  })
  @Allow()
  status?: unknown;
}
