import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class BlockRoomDatesDto {
  @ApiProperty({ example: '2030-08-01', format: 'date', type: String })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiProperty({ example: '2030-08-04', format: 'date', type: String })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiProperty({ example: 'Bao tri may lanh', maxLength: 500, type: String })
  @IsString()
  reason?: string;
}
