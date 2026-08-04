import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  AccountStatusEnum,
  ActorTypeEnum,
  type ActorType,
  UserRoleEnum,
} from '../../../common/domain/account.enums';
import type { CustomerStatus } from '../../customer/schema/customer.entity';
import type { UserRole, UserStatus } from '../../user/schema/user.entity';

/**
 * Customer public profile for auth responses
 */
export class AuthCustomerDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  fullName!: string;

  @ApiProperty({
    example: 'user@example.com',
    nullable: true,
    type: String,
  })
  email!: string | null;

  @ApiProperty({ example: '+84912345678' })
  phone!: string;

  @ApiProperty({ example: 'ACTIVE', enum: AccountStatusEnum })
  status!: CustomerStatus;

  @ApiProperty({
    example: '2026-07-27T04:00:00.000Z',
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    example: '2026-07-27T04:00:00.000Z',
    format: 'date-time',
  })
  updatedAt!: Date;
}

export class AuthRegistrationAcceptedDto {
  @ApiProperty({
    example: true,
    description: 'The customer account was created successfully.',
  })
  accepted!: true;
}

/**
 * User (staff/admin) public profile for auth responses
 */
export class AuthUserDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ example: 'Tran Thi B' })
  fullName!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiProperty({
    example: '+84987654321',
    nullable: true,
    type: String,
  })
  phone!: string | null;

  @ApiProperty({ example: 'ADMIN', enum: UserRoleEnum })
  role!: UserRole;

  @ApiProperty({ example: 'ACTIVE', enum: AccountStatusEnum })
  status!: UserStatus;

  @ApiProperty({
    example: '2026-07-27T04:00:00.000Z',
    format: 'date-time',
  })
  createdAt!: Date;

  @ApiProperty({
    example: '2026-07-27T04:00:00.000Z',
    format: 'date-time',
  })
  updatedAt!: Date;
}

/**
 * Login response with access token
 */
export class AuthLoginResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token',
  })
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: 3600,
    description: 'Token expiration time in seconds',
  })
  expiresIn!: number;

  @ApiProperty({ example: 'customer', enum: ActorTypeEnum })
  actorType!: ActorType;

  @ApiPropertyOptional({
    type: AuthCustomerDto,
    nullable: true,
    description: 'Customer profile if actorType is customer',
  })
  customer?: AuthCustomerDto;

  @ApiPropertyOptional({
    type: AuthUserDto,
    nullable: true,
    description: 'User profile if actorType is user',
  })
  user?: AuthUserDto;
}

/**
 * ME endpoint response - union of customer or user
 */
export class AuthMeCustomerResponseDto {
  @ApiProperty({ enum: ['customer'], example: 'customer' })
  actorType!: 'customer';

  @ApiProperty({ type: AuthCustomerDto })
  customer!: AuthCustomerDto;
}

export class AuthMeUserResponseDto {
  @ApiProperty({ enum: ['user'], example: 'user' })
  actorType!: 'user';

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}
