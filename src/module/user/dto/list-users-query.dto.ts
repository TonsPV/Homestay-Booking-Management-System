import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListUsersQueryDto {
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

  @ApiPropertyOptional({ example: 'staff@example.com', type: String })
  search?: unknown;

  @ApiPropertyOptional({
    enum: ['STAFF', 'ADMIN'],
    example: 'STAFF',
    type: String,
  })
  role?: unknown;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'LOCKED'],
    example: 'ACTIVE',
    type: String,
  })
  status?: unknown;
}
