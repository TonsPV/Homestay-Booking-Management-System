import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

import { CreateBookingDto } from './create-booking.dto';

export class CreateManagementBookingDto extends CreateBookingDto {
  @ApiPropertyOptional({
    description:
      'Existing Customer id. Omit it to create or match a counter Customer from contact data.',
    example: '2',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(/^(?:[1-9][0-9]*)?$/)
  customerId?: string | null;
}
