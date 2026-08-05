import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class ListRoomTypesQueryDto {
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

  @ApiPropertyOptional({ example: 'phòng đôi', type: String })
  @Allow()
  search?: unknown;
}

export class AdminListRoomTypesQueryDto extends ListRoomTypesQueryDto {
  @ApiPropertyOptional({ default: false, example: true, type: Boolean })
  @Allow()
  includeDeleted?: unknown;
}
