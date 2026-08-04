import type { OpenAPIObject } from '@nestjs/swagger';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface ContractResponse {
  $ref?: string;
  content?: Record<string, { schema?: unknown }>;
}

interface ContractOperation {
  responses: Record<string, ContractResponse>;
}

type ContractPathItem = Partial<
  Record<(typeof HTTP_METHODS)[number], ContractOperation>
>;

export interface MissingSuccessSchema {
  method: string;
  path: string;
  statusCode: string;
}

export function findMissingJsonSuccessSchemas(
  document: OpenAPIObject,
): MissingSuccessSchema[] {
  return findMissingJsonResponseSchemas(document).filter(({ statusCode }) =>
    /^2\d\d$/.test(statusCode),
  );
}

export function assertOpenApiSuccessSchemas(document: OpenAPIObject): void {
  assertNoMissingSchemas(
    findMissingJsonSuccessSchemas(document),
    'OpenAPI JSON success responses without application/json schema',
  );
}

export function findMissingJsonResponseSchemas(
  document: OpenAPIObject,
): MissingSuccessSchema[] {
  const missing: MissingSuccessSchema[] = [];

  for (const [path, pathItem] of Object.entries(
    document.paths as Record<string, ContractPathItem>,
  )) {
    for (const method of HTTP_METHODS) {
      const operation = getOperation(pathItem, method);

      if (operation === undefined) {
        continue;
      }

      for (const [statusCode, response] of Object.entries(
        operation.responses,
      )) {
        if (!/^[1-5]\d\d$/.test(statusCode) || response.$ref !== undefined) {
          continue;
        }

        if (statusCode === '204') {
          continue;
        }

        if (!hasJsonSchema(response)) {
          missing.push({
            method: method.toUpperCase(),
            path,
            statusCode,
          });
        }
      }
    }
  }

  return missing;
}

export function assertOpenApiResponseSchemas(document: OpenAPIObject): void {
  assertNoMissingSchemas(
    findMissingJsonResponseSchemas(document),
    'OpenAPI JSON responses without application/json schema',
  );
}

function assertNoMissingSchemas(
  missing: MissingSuccessSchema[],
  message: string,
): void {
  if (missing.length === 0) {
    return;
  }

  const details = missing
    .map(
      ({ method, path, statusCode }) => `- ${method} ${path} -> ${statusCode}`,
    )
    .join('\n');

  throw new Error(`${message}:\n${details}`);
}

function getOperation(
  pathItem: ContractPathItem,
  method: (typeof HTTP_METHODS)[number],
): ContractOperation | undefined {
  return pathItem[method];
}

function hasJsonSchema(response: ContractResponse): boolean {
  return response.content?.['application/json']?.schema !== undefined;
}
