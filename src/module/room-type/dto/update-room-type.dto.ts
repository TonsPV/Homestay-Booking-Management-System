import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoomTypeDto {
  @ApiPropertyOptional({
    example: 'Phòng đôi hướng vườn',
    maxLength: 120,
    type: String,
  })
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Phòng dành cho hai khách.',
    nullable: true,
    type: String,
  })
  description?: unknown;

  @ApiPropertyOptional({
    example: '1 giường đôi',
    maxLength: 120,
    nullable: true,
    type: String,
  })
  bedType?: unknown;

  @ApiPropertyOptional({
    example: 2,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  maxGuests?: unknown;

  @ApiPropertyOptional({
    example: '950000.00',
    pattern: '^\\d+(?:\\.\\d{1,2})?$',
    type: String,
  })
  basePrice?: unknown;
}
