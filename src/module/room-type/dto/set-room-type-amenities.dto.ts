import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class SetRoomTypeAmenitiesDto {
  @ApiProperty({
    description: 'Complete active Amenity id set for this RoomType.',
    example: ['1', '2'],
    items: {
      pattern: '^[1-9][0-9]*$',
      type: 'string',
    },
    type: [String],
  })
  @Allow()
  amenityIds?: unknown;
}
