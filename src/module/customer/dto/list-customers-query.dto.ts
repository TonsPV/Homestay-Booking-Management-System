import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListCustomersQueryDto {
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

  @ApiPropertyOptional({ example: '0705840355', type: String })
  search?: unknown;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'LOCKED'],
    example: 'ACTIVE',
    type: String,
  })
  status?: unknown;
}
