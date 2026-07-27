import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookingDto {
  @ApiProperty({ example: '21', pattern: '^[1-9][0-9]*$', type: String })
  roomId?: unknown;

  @ApiProperty({ example: '2026-08-01', format: 'date', type: String })
  checkInDate?: unknown;

  @ApiProperty({ example: '2026-08-03', format: 'date', type: String })
  checkOutDate?: unknown;

  @ApiProperty({ example: 2, minimum: 1, type: Number })
  guestCount?: unknown;

  @ApiPropertyOptional({
    description: 'Overrides the authenticated Customer profile contact.',
    example: 'Nguyen Van A',
    maxLength: 120,
    type: String,
  })
  contactName?: unknown;

  @ApiPropertyOptional({
    example: '0901234567',
    type: String,
  })
  contactPhone?: unknown;

  @ApiPropertyOptional({
    example: 'guest@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  contactEmail?: unknown;

  @ApiPropertyOptional({
    example: 'Vui lòng chuẩn bị phòng yên tĩnh.',
    nullable: true,
    type: String,
  })
  customerNote?: unknown;
}
