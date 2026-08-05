import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { RoomStatus } from '../schema/room.entity';

export class CreateRoomDto {
  @ApiProperty({ example: '5', pattern: '^[1-9][0-9]*$', type: String })
  @Allow()
  roomTypeId?: unknown;

  @ApiProperty({ example: '101', maxLength: 50, type: String })
  @Allow()
  roomNumber?: unknown;

  @ApiProperty({ example: 'Phòng 101', maxLength: 120, type: String })
  @Allow()
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng tầng một, gần khu vườn.',
    nullable: true,
    type: String,
  })
  @Allow()
  description?: unknown;

  @ApiPropertyOptional({
    enum: RoomStatus,
    example: RoomStatus.READY,
    type: String,
  })
  @Allow()
  status?: unknown;
}
