import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { RoomTypeBedInputDto } from './room-type-bed.dto';

export class CreateRoomTypeDto {
  @ApiProperty({ example: 'Phòng đôi', maxLength: 120, type: String })
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

  @ApiProperty({ example: 2, maximum: 100, minimum: 1, type: Number })
  @Allow()
  maxGuests?: unknown;

  @ApiProperty({
    example: '900000.00',
    description: 'Positive base price; zero is not accepted.',
    pattern:
      '^(?:[1-9][0-9]{0,9}(?:\\.[0-9]{1,2})?|0\\.(?:0[1-9]|[1-9][0-9]?))$',
    type: String,
  })
  @Allow()
  basePrice?: unknown;
}
