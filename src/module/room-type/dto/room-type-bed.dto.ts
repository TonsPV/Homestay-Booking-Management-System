import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { BedType } from '../bed-configuration';

export class RoomTypeBedInputDto {
  @ApiProperty({ enum: BedType, enumName: 'BedType', type: String })
  @Allow()
  type?: unknown;

  @ApiProperty({ example: 1, maximum: 20, minimum: 1, type: Number })
  @Allow()
  quantity?: unknown;
}

export class RoomTypeBedResponseDto {
  @ApiProperty({ enum: BedType, enumName: 'BedType' })
  type!: BedType;

  @ApiProperty({ example: 1, maximum: 20, minimum: 1 })
  quantity!: number;
}
