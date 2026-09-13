import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class ListChatMessagesQueryDto {
  @ApiPropertyOptional({ example: 40, minimum: 1, type: Number })
  @Allow()
  beforeSequence?: unknown;

  @ApiPropertyOptional({ example: 40, minimum: 0, type: Number })
  @Allow()
  afterSequence?: unknown;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100, type: Number })
  @Allow()
  limit?: unknown;
}
