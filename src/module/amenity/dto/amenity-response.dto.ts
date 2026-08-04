import { ApiProperty } from '@nestjs/swagger';

export class AmenityDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Wi-Fi' })
  name!: string;

  @ApiProperty({
    example: 'Free wireless internet.',
    nullable: true,
    type: String,
  })
  description!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class AdminAmenityDto extends AmenityDto {
  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  deletedAt!: Date | null;
}
