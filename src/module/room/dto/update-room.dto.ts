import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoomDto {
  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  roomTypeId?: unknown;

  @ApiPropertyOptional({ example: '101', maxLength: 50, type: String })
  roomNumber?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng 101 hướng vườn',
    maxLength: 120,
    type: String,
  })
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng tầng một, gần khu vườn.',
    nullable: true,
    type: String,
  })
  description?: unknown;
}
