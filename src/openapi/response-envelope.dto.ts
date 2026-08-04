import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  ErrorCode,
  type ErrorCode as ErrorCodeType,
} from '../common/http/error-codes';
import type { ApiErrorDetails } from '../common/http/api-response';

export class PaginationDto {
  @ApiProperty({ example: 1, minimum: 1 })
  page!: number;

  @ApiProperty({ example: 20, minimum: 1 })
  limit!: number;

  @ApiProperty({ example: 150, minimum: 0 })
  total!: number;

  @ApiProperty({ example: 8, minimum: 0 })
  totalPages!: number;
}

export class PaginationMetaDto {
  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class SuccessEnvelopeDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: 'Thanh cong.' })
  message!: string;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Response payload. The concrete schema is defined per route.',
  })
  data!: unknown;

  @ApiProperty({ example: '/api/v1/resource' })
  path!: string;

  @ApiProperty({
    example: '2026-07-27T04:00:00.000Z',
    format: 'date-time',
  })
  timestamp!: string;

  @ApiProperty({ example: 'f75cf4ac-6958-4d59-8a4f-183abfeaed15' })
  requestId!: string;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    enum: Object.values(ErrorCode),
    enumName: 'ErrorCode',
    example: ErrorCode.COMMON_VALIDATION_FAILED,
  })
  errorCode!: ErrorCodeType;

  @ApiProperty({
    example: 'Du lieu khong hop le.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];

  @ApiPropertyOptional({
    description: 'Validation errors keyed by request field.',
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: {
        type: 'object',
        required: ['errorCode'],
        properties: {
          errorCode: { type: 'string', enum: Object.values(ErrorCode) },
          message: { type: 'string' },
        },
      },
    },
  })
  fieldErrors?: Record<
    string,
    Array<{ errorCode: ErrorCodeType; message?: string }>
  >;

  @ApiPropertyOptional({
    description: 'Safe structured context that can help a client recover.',
    type: 'object',
    additionalProperties: false,
    properties: {
      retryable: { type: 'boolean', example: false },
      limit: { type: 'integer', example: 3, minimum: 0 },
      maxAdvanceDays: { type: 'integer', example: 365, minimum: 0 },
      maxStayNights: { type: 'integer', example: 30, minimum: 0 },
    },
  })
  details?: ApiErrorDetails;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({ example: '/api/v1/resource' })
  path!: string;

  @ApiProperty({
    example: '2026-07-27T04:00:00.000Z',
    format: 'date-time',
  })
  timestamp!: string;

  @ApiProperty({ example: 'f75cf4ac-6958-4d59-8a4f-183abfeaed15' })
  requestId!: string;
}
