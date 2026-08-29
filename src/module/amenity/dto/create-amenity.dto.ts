import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateAmenityDto {
  @ApiProperty({ example: 'Wi-Fi', maxLength: 120, type: String })
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'Internet không dây miễn phí trong phòng.',
    maxLength: 500,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  description?: string | null;
}
