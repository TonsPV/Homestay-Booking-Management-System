import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AccessTokenPayload, AuthenticatedRequest } from './auth.types';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return request.auth;
  },
);
