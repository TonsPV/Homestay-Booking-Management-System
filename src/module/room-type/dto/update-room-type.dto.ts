import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { RoomTypeBedInputDto } from './room-type-bed.dto';

export class UpdateRoomTypeDto {
  @ApiPropertyOptional({
    example: 'Phòng đôi hướng vườn',
    maxLength: 120,
    type: String,
  })
  @Allow()
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng dành cho hai khách.',
    nullable: true,
    type: String,
  })
  @Allow()
  description?: unknown;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Legacy free-text bed configuration. Use beds instead.',
    example: '1 giường đôi',
    maxLength: 120,
    nullable: true,
    type: String,
  })
  @Allow()
  bedType?: unknown;

  @ApiPropertyOptional({
    description:
      'Normalized bed configuration. Do not send together with bedType.',
    items: { $ref: '#/components/schemas/RoomTypeBedInputDto' },
    maxItems: 6,
    type: [RoomTypeBedInputDto],
  })
  @Allow()
  beds?: unknown;

  @ApiPropertyOptional({
    example: 2,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @Allow()
  maxGuests?: unknown;

  @ApiPropertyOptional({
    example: '950000.00',
    pattern: '^\\d+(?:\\.\\d{1,2})?$',
    type: String,
  })
  @Allow()
  basePrice?: unknown;
}
