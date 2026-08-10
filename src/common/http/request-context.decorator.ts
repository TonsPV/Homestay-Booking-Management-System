import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AppRequest } from './auth.types';

export interface RequestContext {
  requestId: string | undefined;
  method: string;
  path: string;
  ip: string | undefined;
  userAgent: string | undefined;
  auth: unknown;
}

export const ReqContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<AppRequest>();

    return {
      requestId: request.requestId,
      method: request.method,
      path: request.originalUrl,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      auth: request.auth,
    };
  },
);
