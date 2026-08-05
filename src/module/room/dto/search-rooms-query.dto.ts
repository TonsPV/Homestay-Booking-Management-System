import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export enum RoomSearchSort {
  RECOMMENDED = 'RECOMMENDED',
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
  POPULARITY = 'POPULARITY',
  NEWEST = 'NEWEST',
}

export class SearchRoomsQueryDto {
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

  @ApiPropertyOptional({
    description:
      'Repeat this query parameter to require all selected amenities.',
    example: ['1', '2'],
    items: { pattern: '^[1-9][0-9]*$', type: 'string' },
    type: [String],
  })
  @Allow()
  amenityIds?: unknown;

  @ApiPropertyOptional({ example: '500000.00', type: String })
  @Allow()
  minPrice?: unknown;

  @ApiPropertyOptional({ example: '1500000.00', type: String })
  @Allow()
  maxPrice?: unknown;

  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    default: RoomSearchSort.RECOMMENDED,
    enum: RoomSearchSort,
    enumName: 'RoomSearchSort',
    type: String,
  })
  @Allow()
  sort?: unknown;

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
