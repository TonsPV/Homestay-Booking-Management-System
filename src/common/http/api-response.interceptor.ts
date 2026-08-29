import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiSuccessResponse, isApiResponsePayload } from './api-response';
import { createRequestMetadata } from './request-metadata';
import type { AppRequest } from './request.types';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccessResponse> {
    const http = context.switchToHttp();
    const request = http.getRequest<AppRequest>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        const payload = isApiResponsePayload(body)
          ? body
          : {
              data: body,
              message: undefined,
              meta: undefined,
            };

        const responseBody: ApiSuccessResponse = {
          success: true,
          statusCode: response.statusCode,
          message: payload.message ?? 'Thanh cong.',
          data: payload.data ?? null,
          ...createRequestMetadata(request),
        };

        if (payload.meta !== undefined) {
          responseBody.meta = payload.meta;
        }

        return responseBody;
      }),
    );
  }
}
