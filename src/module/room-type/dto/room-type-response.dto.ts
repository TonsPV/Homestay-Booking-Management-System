import { ApiProperty } from '@nestjs/swagger';

import { BedType } from '../bed-configuration';
import { RoomTypeBedResponseDto } from './room-type-bed.dto';

export class RoomTypeAmenityDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Wi-Fi' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;
}

export class RoomTypeDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Deluxe Room' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({
    deprecated: true,
    description: 'Legacy free-text bed configuration. Use beds instead.',
    example: '1 giường đôi',
    nullable: true,
    type: String,
  })
  bedType!: string | null;

  @ApiProperty({ type: [RoomTypeBedResponseDto] })
  beds!: Array<{ type: BedType; quantity: number }>;

  @ApiProperty({ example: 2, minimum: 1 })
  maxGuests!: number;

  @ApiProperty({
    example: '1500000.00',
    description: 'Base price represented as a decimal string.',
  })
  basePrice!: string;

  @ApiProperty({ type: [RoomTypeAmenityDto] })
  amenities!: RoomTypeAmenityDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class AdminRoomTypeDto extends RoomTypeDto {
  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  deletedAt!: Date | null;
}
