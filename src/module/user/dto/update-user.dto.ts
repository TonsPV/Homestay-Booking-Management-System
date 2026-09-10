import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { UserRoleEnum } from '../../../common/account/account.enums';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Nguyen Van Staff',
    maxLength: 120,
    type: String,
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    example: 'staff@example.com',
    maxLength: 160,
    type: String,
  })
  @IsOptional()
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

  @ApiPropertyOptional({
    example: 'UpdatedPassword456!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({
    enum: [UserRoleEnum.STAFF],
    example: 'STAFF',
    type: String,
  })
  @IsOptional()
  @IsIn([UserRoleEnum.STAFF])
  role?: UserRoleEnum;
}
