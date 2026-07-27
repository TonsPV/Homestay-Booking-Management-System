import { ApiProperty } from '@nestjs/swagger';

import { RoomStatus } from '../schema/room.entity';

export class UpdateRoomStatusDto {
  @ApiProperty({
    enum: RoomStatus,
    example: RoomStatus.MAINTENANCE,
    type: String,
  })
  status?: unknown;
}
