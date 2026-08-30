import type { Request } from 'express';

import type { AuthenticatedPrincipal } from '../../module/auth/authenticated-principal';

export interface AppRequest<TAuth = unknown> extends Request {
  auth?: TAuth;
  /** Canonical Passport principal set by JwtAuthGuard. */
  user?: AuthenticatedPrincipal;
  requestId?: string;
}
