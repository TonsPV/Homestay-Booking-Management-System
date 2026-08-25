import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ValidationPipe } from '@nestjs/common';

import { PaginationQueryDto } from '../../../../src/common/pagination/pagination-query.dto';
import { parsePagination } from '../../../../src/common/validation/input-normalizer';
import { ListManagementBookingsQueryDto } from '../../../../src/module/booking/dto/list-management-bookings-query.dto';

describe('PaginationQueryDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  it('keeps page and limit optional and preserves raw query values', async () => {
    const absent = (await transform({})) as PaginationQueryDto;
    const present = (await transform({
      page: '2',
      limit: '10',
    })) as PaginationQueryDto;

    expect(absent).toBeInstanceOf(PaginationQueryDto);
    expect(absent.page).toBeUndefined();
    expect(absent.limit).toBeUndefined();
    expect(present).toMatchObject({ page: '2', limit: '10' });
  });

  it('preserves inherited pagination metadata through feature query DTOs', async () => {
    const value = (await pipe.transform(
      { page: '2', limit: '10', search: 'BKMR' },
      { type: 'query', metatype: ListManagementBookingsQueryDto },
    )) as ListManagementBookingsQueryDto;

    expect(value).toBeInstanceOf(ListManagementBookingsQueryDto);
    expect(value).toMatchObject({ page: '2', limit: '10', search: 'BKMR' });
  });

  it.each([
    [{ page: '0' }, 'Page khong hop le.'],
    [{ page: 'not-a-number' }, 'Page khong hop le.'],
    [{ limit: '0' }, 'Limit khong hop le.'],
    [{ limit: 'not-a-number' }, 'Limit khong hop le.'],
  ])(
    'leaves invalid raw values for parsePagination to reject: %j',
    async (query, message) => {
      const transformed = await transform(query);

      expect(() =>
        parsePagination(transformed as Record<string, unknown>),
      ).toThrow(message);
    },
  );

  it('keeps generated page and limit parameters optional with the shared contract', () => {
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), 'openapi/openapi.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> };
    const paginationParameters = Object.values(document.paths)
      .flatMap((pathItem) => Object.values(pathItem))
      .filter(isOperation)
      .flatMap((operation) => operation.parameters ?? [])
      .filter(
        (parameter) => parameter.name === 'page' || parameter.name === 'limit',
      );

    expect(paginationParameters.length).toBeGreaterThan(0);

    for (const parameter of paginationParameters) {
      expect(parameter).toMatchObject({
        in: 'query',
        required: false,
      });

      if (parameter.name === 'page') {
        expect(parameter.schema).toMatchObject({
          default: 1,
          example: 1,
          minimum: 1,
          type: 'number',
        });
      } else {
        expect(parameter.schema).toMatchObject({
          default: 20,
          example: 20,
          maximum: 100,
          minimum: 1,
          type: 'number',
        });
      }
    }
  });

  async function transform(query: Record<string, unknown>): Promise<unknown> {
    return pipe.transform(query, {
      type: 'query',
      metatype: PaginationQueryDto,
    });
  }
});

type OpenApiParameter = {
  in?: string;
  name?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};

type OpenApiOperation = {
  parameters?: OpenApiParameter[];
  responses?: Record<string, unknown>;
};

function isOperation(value: unknown): value is OpenApiOperation {
  return typeof value === 'object' && value !== null && 'responses' in value;
}
