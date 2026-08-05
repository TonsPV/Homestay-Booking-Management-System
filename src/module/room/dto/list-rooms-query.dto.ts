import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class ListRoomsQueryDto {
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

  @ApiPropertyOptional({ example: '101', type: String })
  @Allow()
  search?: unknown;

  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @Allow()
  roomTypeId?: unknown;
}
