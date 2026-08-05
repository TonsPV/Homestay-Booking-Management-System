import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CreateRoomImageDto {
  @ApiPropertyOptional({ example: 0, minimum: 0, type: Number })
  @Allow()
  sortOrder?: unknown;

  @ApiPropertyOptional({ example: true, type: Boolean })
  @Allow()
  isCover?: unknown;
}
