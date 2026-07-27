import { ApiPropertyOptional } from '@nestjs/swagger';

import { ListRoomsQueryDto } from './list-rooms-query.dto';
import { RoomStatus } from '../schema/room.entity';

export class ListManagementRoomsQueryDto extends ListRoomsQueryDto {
  @ApiPropertyOptional({
    enum: RoomStatus,
    example: RoomStatus.MAINTENANCE,
    type: String,
  })
  status?: unknown;
}
