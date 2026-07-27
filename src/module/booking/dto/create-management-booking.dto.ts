import { ApiPropertyOptional } from '@nestjs/swagger';

import { CreateBookingDto } from './create-booking.dto';

export class CreateManagementBookingDto extends CreateBookingDto {
  @ApiPropertyOptional({
    description:
      'Existing Customer id. Omit it to create or match a counter Customer from contact data.',
    example: '2',
    pattern: '^[1-9][0-9]*$',
    type: String,
  })
  customerId?: unknown;
}
