import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { RoomStatus } from '../domain/room-status';

export class UpdateRoomStatusDto {
  @ApiProperty({
    enum: RoomStatus,
    example: RoomStatus.MAINTENANCE,
    type: String,
  })
  @IsEnum(RoomStatus)
  status?: RoomStatus;
}
