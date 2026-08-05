import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '21', pattern: '^[1-9][0-9]*$', type: String })
  @Allow()
  roomId?: unknown;

  @ApiProperty({ example: '2026-08-01', format: 'date', type: String })
  @Allow()
  checkInDate?: unknown;

  @ApiProperty({ example: '2026-08-03', format: 'date', type: String })
  @Allow()
  checkOutDate?: unknown;

  @ApiProperty({ example: 2, minimum: 1, type: Number })
  @Allow()
  guestCount?: unknown;

  @ApiPropertyOptional({
    description: 'Overrides the authenticated Customer profile contact.',
    example: 'Nguyen Van A',
    maxLength: 120,
    type: String,
  })
  @Allow()
  contactName?: unknown;

  @ApiPropertyOptional({
    example: '0901234567',
    type: String,
  })
  @Allow()
  contactPhone?: unknown;

  @ApiPropertyOptional({
    example: 'guest@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  @Allow()
  contactEmail?: unknown;

  @ApiPropertyOptional({
    example: 'Vui lòng chuẩn bị phòng yên tĩnh.',
    nullable: true,
    type: String,
  })
  @Allow()
  customerNote?: unknown;
}
