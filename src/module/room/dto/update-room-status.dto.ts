import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { RoomStatus } from '../schema/room.entity';

export class UpdateRoomStatusDto {
  @ApiProperty({
    enum: RoomStatus,
    example: RoomStatus.MAINTENANCE,
    type: String,
  })
  @Allow()
  status?: unknown;
}
