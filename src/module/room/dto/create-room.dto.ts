import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RoomStatus } from '../schema/room.entity';

export class CreateRoomDto {
  @ApiProperty({ example: '5', pattern: '^[1-9][0-9]*$', type: String })
  roomTypeId?: unknown;

  @ApiProperty({ example: '101', maxLength: 50, type: String })
  roomNumber?: unknown;

  @ApiProperty({ example: 'Phòng 101', maxLength: 120, type: String })
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng tầng một, gần khu vườn.',
    nullable: true,
    type: String,
  })
  description?: unknown;

  @ApiPropertyOptional({
    enum: RoomStatus,
    example: RoomStatus.READY,
    type: String,
  })
  status?: unknown;
}
