import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '21', pattern: '^[1-9][0-9]*$', type: String })
  @IsString()
  @Matches(/^[1-9][0-9]*$/)
  roomId?: string;

  @ApiProperty({ example: '2026-08-01', format: 'date', type: String })
  @IsString()
  @Matches(/^\s*\d{4}-\d{2}-\d{2}\s*$/)
  checkInDate?: string;

  @ApiProperty({ example: '2026-08-03', format: 'date', type: String })
  @IsString()
  @Matches(/^\s*\d{4}-\d{2}-\d{2}\s*$/)
  checkOutDate?: string;

  @ApiProperty({ example: 2, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  guestCount?: number;

  @ApiPropertyOptional({
    description: 'Overrides the authenticated Customer profile contact.',
    example: 'Nguyen Van A',
    maxLength: 120,
    type: String,
  })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({
    example: '0901234567',
    type: String,
  })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({
    example: 'guest@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  contactEmail?: string | null;

  @ApiPropertyOptional({
    example: 'Vui lòng chuẩn bị phòng yên tĩnh.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  customerNote?: string | null;
}
