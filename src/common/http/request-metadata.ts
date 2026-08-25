import type { AppRequest } from './request.types';

export interface RequestMetadata {
  path: string;
  timestamp: string;
  requestId: string;
}

export function createRequestMetadata(
  request: Pick<AppRequest, 'originalUrl' | 'requestId'>,
): RequestMetadata {
  return {
    path: request.originalUrl,
    timestamp: new Date().toISOString(),
    requestId: request.requestId ?? 'unknown',
  };
}
