import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomTypeDto {
  @ApiProperty({ example: 'Phòng đôi', maxLength: 120, type: String })
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng dành cho hai khách.',
    nullable: true,
    type: String,
  })
  description?: unknown;

  @ApiProperty({ example: 2, maximum: 100, minimum: 1, type: Number })
  maxGuests?: unknown;

  @ApiProperty({
    example: '900000.00',
    pattern: '^\\d+(?:\\.\\d{1,2})?$',
    type: String,
  })
  basePrice?: unknown;
}
