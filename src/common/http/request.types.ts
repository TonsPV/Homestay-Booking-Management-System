import type { Request } from 'express';

export interface AppRequest<TAuth = unknown> extends Request {
  auth?: TAuth;
  requestId?: string;
}
