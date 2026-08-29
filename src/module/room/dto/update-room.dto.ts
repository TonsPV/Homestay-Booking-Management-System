import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateRoomDto {
  @ApiPropertyOptional({
    example: '5',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:[1-9][0-9]*)?$/)
  roomTypeId?: string | null;

  @ApiPropertyOptional({ example: '101', maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  roomNumber?: string;

  @ApiPropertyOptional({
    example: 'Phòng 101 hướng vườn',
    maxLength: 120,
    type: String,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'Phòng tầng một, gần khu vườn.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  description?: string | null;
}
