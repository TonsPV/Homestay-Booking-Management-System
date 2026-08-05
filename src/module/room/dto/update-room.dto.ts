import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class UpdateRoomDto {
  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  roomTypeId?: unknown;

  @ApiPropertyOptional({ example: '101', maxLength: 50, type: String })
  @Allow()
  roomNumber?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng 101 hướng vườn',
    maxLength: 120,
    type: String,
  })
  @Allow()
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng tầng một, gần khu vườn.',
    nullable: true,
    type: String,
  })
  @Allow()
  description?: unknown;
}
