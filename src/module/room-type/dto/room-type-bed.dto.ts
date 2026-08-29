import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, Max, Min } from 'class-validator';

import { BedType, MAX_BED_QUANTITY } from '../bed-configuration';

export class RoomTypeBedInputDto {
  @ApiProperty({ enum: BedType, enumName: 'BedType', type: String })
  @IsEnum(BedType)
  type?: BedType;

  @ApiProperty({ example: 1, maximum: 20, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(MAX_BED_QUANTITY)
  quantity?: number;
}

export class RoomTypeBedResponseDto {
  @ApiProperty({ enum: BedType, enumName: 'BedType' })
  type!: BedType;

  @ApiProperty({ example: 1, maximum: 20, minimum: 1 })
  quantity!: number;
}
