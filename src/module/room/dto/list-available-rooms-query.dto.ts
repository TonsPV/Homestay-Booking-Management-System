import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListAvailableRoomsQueryDto {
  @ApiProperty({ example: '2026-08-01', format: 'date', type: String })
  checkIn?: unknown;

  @ApiProperty({ example: '2026-08-03', format: 'date', type: String })
  checkOut?: unknown;

  @ApiProperty({ example: 2, minimum: 1, type: Number })
  guests?: unknown;

  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  roomTypeId?: unknown;

  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  limit?: unknown;
}
