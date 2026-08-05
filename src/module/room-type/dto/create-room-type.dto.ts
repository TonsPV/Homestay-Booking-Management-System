import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

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
    example: '1 giường đôi',
    maxLength: 120,
    nullable: true,
    type: String,
  })
  @Allow()
  bedType?: unknown;

  @ApiProperty({ example: 2, maximum: 100, minimum: 1, type: Number })
  @Allow()
  maxGuests?: unknown;

  @ApiProperty({
    example: '900000.00',
    pattern: '^\\d+(?:\\.\\d{1,2})?$',
    type: String,
  })
  @Allow()
  basePrice?: unknown;
}
