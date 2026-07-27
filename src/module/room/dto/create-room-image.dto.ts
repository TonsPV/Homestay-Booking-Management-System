import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomImageDto {
  @ApiPropertyOptional({ example: 0, minimum: 0, type: Number })
  sortOrder?: unknown;

  @ApiPropertyOptional({ example: true, type: Boolean })
  isCover?: unknown;
}
