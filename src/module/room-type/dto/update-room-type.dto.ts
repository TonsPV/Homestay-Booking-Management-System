import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Allow,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_BED_TYPES } from '../bed-configuration';
import { RoomTypeBedInputDto } from './room-type-bed.dto';

export class UpdateRoomTypeDto {
  @ApiPropertyOptional({
    example: 'Phòng đôi hướng vườn',
    maxLength: 120,
    type: String,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'Phòng dành cho hai khách.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Legacy free-text bed configuration. Use beds instead.',
    example: '1 giường đôi',
    maxLength: 120,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  bedType?: string | null;

  @ApiPropertyOptional({
    description:
      'Normalized bed configuration. Do not send together with bedType.',
    items: { $ref: '#/components/schemas/RoomTypeBedInputDto' },
    maxItems: 6,
    type: [RoomTypeBedInputDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BED_TYPES)
  @ValidateNested({ each: true })
  @Type(() => RoomTypeBedInputDto)
  beds?: RoomTypeBedInputDto[] | null;

  @ApiPropertyOptional({
    example: 2,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxGuests?: number;

  @ApiPropertyOptional({
    example: '950000.00',
    description: 'Positive base price; zero is not accepted.',
    pattern:
      '^(?:[1-9][0-9]{0,9}(?:\\.[0-9]{1,2})?|0\\.(?:0[1-9]|[1-9][0-9]?))$',
    type: String,
  })
  /** Accepts both the documented decimal string and existing numeric callers. */
  @Allow()
  basePrice?: string | number;
}
