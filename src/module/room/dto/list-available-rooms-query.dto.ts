import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class ListAvailableRoomsQueryDto {
  @ApiProperty({ example: '2026-08-01', format: 'date', type: String })
  @Allow()
  checkIn?: unknown;

  @ApiProperty({ example: '2026-08-03', format: 'date', type: String })
  @Allow()
  checkOut?: unknown;

  @ApiProperty({ example: 2, minimum: 1, type: Number })
  @Allow()
  guests?: unknown;

  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  roomTypeId?: unknown;

  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @Allow()
  limit?: unknown;
}
