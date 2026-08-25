import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createPaginationMeta,
  type PaginationMeta,
} from '../../../../src/common/pagination/pagination.types';

describe('pagination runtime and OpenAPI contract', () => {
  it('keeps runtime fields, nesting, requiredness and numeric schema in sync', () => {
    const runtimeMeta: PaginationMeta = createPaginationMeta(2, 20, 21);
    const runtimePagination = runtimeMeta.pagination;
    const document = JSON.parse(
      readFileSync(resolve(process.cwd(), 'openapi/openapi.json'), 'utf8'),
    ) as OpenApiDocument;
    const schemas = document.components?.schemas ?? {};
    const paginationMetaSchema = schemas.PaginationMetaDto;
    const paginationSchema = schemas.PaginationDto;
    const runtimeFields = Object.keys(runtimePagination).sort();
    const openApiFields = Object.keys(
      paginationSchema?.properties ?? {},
    ).sort();

    expect(Object.keys(runtimeMeta)).toEqual(['pagination']);
    expect(paginationMetaSchema?.properties?.pagination).toEqual({
      $ref: '#/components/schemas/PaginationDto',
    });
    expect(paginationMetaSchema?.required).toEqual(['pagination']);
    expect(openApiFields).toEqual(runtimeFields);
    expect(paginationSchema?.required?.slice().sort()).toEqual(runtimeFields);

    expect(paginationSchema?.properties).toMatchObject({
      page: { minimum: 1, type: 'number' },
      limit: { minimum: 1, type: 'number' },
      total: { minimum: 0, type: 'number' },
      totalPages: { minimum: 0, type: 'number' },
    });
  });
});

type OpenApiDocument = {
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

type OpenApiSchema = {
  properties?: Record<string, OpenApiSchemaProperty>;
  required?: string[];
};

type OpenApiSchemaProperty = OpenApiSchema & {
  $ref?: string;
  minimum?: number;
  type?: string;
};
