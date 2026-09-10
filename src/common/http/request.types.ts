import type { Request } from 'express';

export interface AppRequest<
  TAuth = unknown,
  TPrincipal = Request['user'],
> extends Omit<Request, 'user'> {
  auth?: TAuth;
  /** Canonical Passport principal set by JwtAuthGuard. */
  user?: TPrincipal;
  requestId?: string;
}
