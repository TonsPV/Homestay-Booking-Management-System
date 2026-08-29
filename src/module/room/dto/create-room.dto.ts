import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { RoomStatus } from '../domain/room-status';

export class CreateRoomDto {
  @ApiProperty({ example: '5', pattern: '^[1-9][0-9]*$', type: String })
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  roomTypeId?: string;

  @ApiProperty({ example: '101', maxLength: 50, type: String })
  @IsString()
  roomNumber?: string;

  @ApiProperty({ example: 'Phòng 101', maxLength: 120, type: String })
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'Phòng tầng một, gần khu vườn.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    enum: RoomStatus,
    example: RoomStatus.READY,
    type: String,
  })
  @IsOptional()
  @IsIn([...Object.values(RoomStatus), ''])
  status?: RoomStatus | '' | null;
}
