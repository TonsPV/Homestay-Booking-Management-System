import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class MarkChatReadDto {
  @ApiProperty({ example: 12, minimum: 0, type: Number })
  @Allow()
  lastReadSequence!: unknown;
}
