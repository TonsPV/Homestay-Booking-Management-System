import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CreateRoomImageDto {
  @ApiPropertyOptional({ example: 0, minimum: 0, type: Number })
  @Allow()
  sortOrder?: number | string | null;

  @ApiPropertyOptional({ example: true, type: Boolean })
  @Allow()
  isCover?: boolean | string | null;
}
