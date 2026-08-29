import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { UserRoleEnum } from '../../../common/domain/account.enums';

export class CreateUserDto {
  @ApiProperty({ example: 'Nguyen Van Staff', maxLength: 120, type: String })
  @IsString()
  fullName?: string;

  @ApiProperty({
    example: 'staff@example.com',
    maxLength: 160,
    type: String,
  })
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    example: '0901234567',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  phone?: string | null;

  @ApiProperty({
    example: 'StrongPassword123!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  @IsString()
  password?: string;

  @ApiPropertyOptional({
    description: 'Only STAFF accounts can be issued through this endpoint.',
    enum: [UserRoleEnum.STAFF],
    example: 'STAFF',
    type: String,
  })
  @IsOptional()
  @IsIn([UserRoleEnum.STAFF])
  role?: UserRoleEnum;
}
