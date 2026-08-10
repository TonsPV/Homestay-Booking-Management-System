import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { OpenAPIObject } from '@nestjs/swagger';

import { ErrorCode } from '../common/http';
import {
  assertOpenApiResponseSchemas,
  assertOpenApiSuccessSchemas,
  findMissingJsonResponseSchemas,
  findMissingJsonSuccessSchemas,
} from './openapi-contract';

describe('OpenAPI response contract', () => {
  it('requires an application/json schema for every documented response', () => {
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), 'openapi/openapi.json'), 'utf8'),
    ) as OpenAPIObject;

    expect(() => assertOpenApiSuccessSchemas(document)).not.toThrow();
    expect(() => assertOpenApiResponseSchemas(document)).not.toThrow();
  });

  it('preserves nullable scalar response fields as scalars', () => {
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), 'openapi/openapi.json'), 'utf8'),
    ) as OpenAPIObject;
    const schemas = document.components?.schemas as Record<
      string,
      {
        properties?: Record<
          string,
          { format?: string; nullable?: boolean; type?: string }
        >;
      }
    >;

    const nullableStrings = [
      ['AuthCustomerDto', 'email'],
      ['BookingDto', 'contactEmail'],
      ['PaymentDto', 'gatewayTransactionId'],
      ['RoomDto', 'description'],
      ['RoomTypeDto', 'description'],
      ['VnPayReturnDto', 'responseCode'],
    ] as const;
    const nullableDates = [
      ['AdminAmenityDto', 'deletedAt'],
      ['BookingDto', 'paymentExpiresAt'],
      ['PaymentDto', 'paidAt'],
      ['AdminRoomTypeDto', 'deletedAt'],
    ] as const;

    for (const [schemaName, propertyName] of nullableStrings) {
      expect(schemas[schemaName]?.properties?.[propertyName]).toMatchObject({
        nullable: true,
        type: 'string',
      });
    }

    for (const [schemaName, propertyName] of nullableDates) {
      expect(schemas[schemaName]?.properties?.[propertyName]).toMatchObject({
        format: 'date-time',
        nullable: true,
        type: 'string',
      });
    }
  });

  it('locks the stable error taxonomy and structured error fields', () => {
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), 'openapi/openapi.json'), 'utf8'),
    ) as OpenAPIObject;
    type SchemaFixture = {
      additionalProperties?: boolean | SchemaFixture;
      allOf?: Array<{ $ref?: string }>;
      enum?: string[];
      items?: SchemaFixture;
      minimum?: number;
      properties?: Record<string, SchemaFixture>;
      required?: string[];
      type?: string;
    };
    const schemas = document.components?.schemas as Record<
      string,
      SchemaFixture
    >;
    const errorEnvelope = schemas.ErrorEnvelopeDto;
    const fieldErrors = errorEnvelope.properties?.fieldErrors;
    const fieldErrorMap = fieldErrors?.additionalProperties;
    const fieldErrorItem =
      typeof fieldErrorMap === 'object' ? fieldErrorMap.items : undefined;

    expect(schemas.ErrorCode).toMatchObject({
      type: 'string',
      enum: Object.values(ErrorCode),
    });
    expect(errorEnvelope.required).toContain('errorCode');
    expect(errorEnvelope.properties?.errorCode?.allOf).toEqual([
      { $ref: '#/components/schemas/ErrorCode' },
    ]);
    expect(fieldErrorItem?.required).toContain('errorCode');
    expect(fieldErrorItem?.properties?.errorCode?.enum).toEqual(
      Object.values(ErrorCode),
    );
    expect(errorEnvelope.properties?.details).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        retryable: { type: 'boolean' },
        limit: { type: 'integer', minimum: 0 },
        maxAdvanceDays: { type: 'integer', minimum: 0 },
        maxStayNights: { type: 'integer', minimum: 0 },
      },
    });
  });

  it('reports the route and status when a schema is missing', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: {
        '/api/example': {
          get: {
            responses: {
              '200': { description: 'missing content' },
            },
          },
        },
      },
      components: { schemas: {} },
    } as OpenAPIObject;

    expect(findMissingJsonSuccessSchemas(document)).toEqual([
      {
        method: 'GET',
        path: '/api/example',
        statusCode: '200',
      },
    ]);
  });

  it('also reports a documented error response without a schema', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: {
        '/api/health/ready': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { type: 'object' } },
                },
              },
              '503': { description: 'missing content' },
            },
          },
        },
      },
      components: { schemas: {} },
    } as OpenAPIObject;

    expect(findMissingJsonResponseSchemas(document)).toEqual([
      {
        method: 'GET',
        path: '/api/health/ready',
        statusCode: '503',
      },
    ]);
    expect(() => assertOpenApiResponseSchemas(document)).toThrow(
      'GET /api/health/ready -> 503',
    );
  });

  it('documents payment idempotency, gateway failures and VNPay callbacks', () => {
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), 'openapi/openapi.json'), 'utf8'),
    ) as OpenAPIObject;
    const operations = [
      document.paths['/api/v1/bookings/{bookingId}/payments']?.post,
      document.paths['/api/v1/management/bookings/{bookingId}/payments']?.post,
      document.paths['/api/v1/management/payments/{id}/refund']?.post,
    ];

    for (const operation of operations) {
      expect(
        (operation?.parameters as Array<{ name?: string }> | undefined)?.some(
          (parameter) => parameter.name?.toLowerCase() === 'idempotency-key',
        ),
      ).toBe(true);
    }

    expect(
      document.paths['/api/v1/bookings/{bookingId}/payments']?.post?.responses,
    ).toHaveProperty('503');
    expect(
      document.paths['/api/v1/management/payments/{id}/refund']?.post
        ?.responses,
    ).toHaveProperty('503');
    expect(
      document.paths['/api/v1/management/payments/{id}/reconcile-refund']?.post
        ?.responses,
    ).toHaveProperty('503');
    expect(
      document.paths['/api/v1/payments/vnpay/return']?.get?.responses,
    ).toHaveProperty('302');

    for (const path of [
      '/api/v1/payments/vnpay/ipn',
      '/api/v1/payments/vnpay/return',
    ]) {
      const parameterNames = (
        document.paths[path]?.get?.parameters as
          Array<{ name?: string }> | undefined
      )?.map((parameter) => parameter.name);

      expect(parameterNames).toEqual(
        expect.arrayContaining([
          'vnp_TmnCode',
          'vnp_TxnRef',
          'vnp_Amount',
          'vnp_ResponseCode',
          'vnp_TransactionStatus',
          'vnp_TransactionNo',
          'vnp_PayDate',
          'vnp_SecureHash',
        ]),
      );
    }
  });
});
