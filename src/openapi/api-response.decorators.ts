import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
  type ApiResponseOptions,
} from '@nestjs/swagger';

import {
  ErrorEnvelopeDto,
  PaginationMetaDto,
  SuccessEnvelopeDto,
} from './response-envelope.dto';

interface EnvelopeOptions {
  description?: string;
  isArray?: boolean;
  metaModel?: Type<unknown>;
  paginated?: boolean;
  nullable?: boolean;
}

export function ApiOkEnvelope(
  model: Type<unknown>,
  options: EnvelopeOptions = {},
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(
      SuccessEnvelopeDto,
      ErrorEnvelopeDto,
      PaginationMetaDto,
      model,
      ...(options.metaModel === undefined ? [] : [options.metaModel]),
    ),
    ApiOkResponse(createEnvelopeResponseOptions(HttpStatus.OK, model, options)),
  );
}

export function ApiCreatedEnvelope(
  model: Type<unknown>,
  options: EnvelopeOptions = {},
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(
      SuccessEnvelopeDto,
      ErrorEnvelopeDto,
      PaginationMetaDto,
      model,
      ...(options.metaModel === undefined ? [] : [options.metaModel]),
    ),
    ApiCreatedResponse(
      createEnvelopeResponseOptions(HttpStatus.CREATED, model, options),
    ),
  );
}

export function ApiOkEnvelopeUnion(
  models: Type<unknown>[],
  description?: string,
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(
      SuccessEnvelopeDto,
      ErrorEnvelopeDto,
      PaginationMetaDto,
      ...models,
    ),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(SuccessEnvelopeDto) },
          {
            type: 'object',
            properties: {
              statusCode: { type: 'number', example: HttpStatus.OK },
              data: {
                oneOf: models.map((model) => ({
                  $ref: getSchemaPath(model),
                })),
              },
            },
          },
        ],
      },
    }),
  );
}

export function ApiCommonAuthErrors(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiUnauthorizedResponse({
      description: 'Authentication is required.',
      type: ErrorEnvelopeDto,
    }),
    ApiForbiddenResponse({
      description: 'The authenticated actor does not have access.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiLoginFailureError(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiUnauthorizedResponse({
      description:
        'The login credentials are invalid. Missing, locked, passwordless, and password-mismatch states use the same response.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiInvalidRequestError(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiBadRequestResponse({
      description: 'The request data is invalid.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiRegistrationConflictError(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiConflictResponse({
      description:
        'A customer account cannot be created with the supplied email or phone number.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiCommonMutationErrors(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiBadRequestResponse({
      description: 'The request data is invalid.',
      type: ErrorEnvelopeDto,
    }),
    ApiNotFoundResponse({
      description: 'The requested resource does not exist.',
      type: ErrorEnvelopeDto,
    }),
    ApiConflictResponse({
      description: 'The request conflicts with the current resource state.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiRateLimitError(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiTooManyRequestsResponse({
      description: 'The request rate limit was exceeded.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiReadinessError(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiServiceUnavailableResponse({
      description: 'The database is unavailable or did not respond in time.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiFeatureUnavailableError(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiServiceUnavailableResponse({
      description: 'This feature is currently disabled.',
      type: ErrorEnvelopeDto,
    }),
  );
}

export function ApiFoundEnvelope(
  model: Type<unknown>,
  options: EnvelopeOptions = {},
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(SuccessEnvelopeDto, ErrorEnvelopeDto, model),
    ApiFoundResponse(
      createEnvelopeResponseOptions(HttpStatus.FOUND, model, options),
    ),
  );
}

export function ApiExternalServiceUnavailableError(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ErrorEnvelopeDto),
    ApiServiceUnavailableResponse({
      description:
        'The external payment operation outcome is unavailable and requires retry or reconciliation.',
      type: ErrorEnvelopeDto,
    }),
  );
}

function createEnvelopeResponseOptions(
  statusCode: number,
  model: Type<unknown>,
  options: EnvelopeOptions,
): ApiResponseOptions {
  const dataSchema = options.isArray
    ? {
        type: 'array',
        items: { $ref: getSchemaPath(model) },
      }
    : {
        $ref: getSchemaPath(model),
        ...(options.nullable === true ? { nullable: true } : {}),
      };
  return {
    description: options.description,
    schema: {
      allOf: [
        { $ref: getSchemaPath(SuccessEnvelopeDto) },
        {
          type: 'object',
          properties: {
            statusCode: { type: 'number', example: statusCode },
            data: dataSchema,
            ...(options.paginated === true
              ? {
                  meta: {
                    $ref: getSchemaPath(options.metaModel ?? PaginationMetaDto),
                  },
                }
              : {}),
          },
        },
      ],
    },
  };
}
