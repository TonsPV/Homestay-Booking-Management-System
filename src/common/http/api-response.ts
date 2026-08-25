import type { ErrorCode } from '../error-codes';

export interface ApiResponsePayload<TData = unknown> {
  data: TData;
  message?: string;
  meta?: Record<string, unknown>;
  readonly __apiResponsePayload: true;
}

export interface ApiSuccessResponse<TData = unknown> {
  success: true;
  statusCode: number;
  message: string;
  data: TData | null;
  meta?: Record<string, unknown>;
  path: string;
  timestamp: string;
  requestId: string;
}

export interface ApiFieldError {
  errorCode: ErrorCode;
  message?: string;
}

export type ApiFieldErrors = Record<string, ApiFieldError[]>;

export interface ApiErrorDetails {
  retryable?: boolean;
  limit?: number;
  maxAdvanceDays?: number;
  maxStayNights?: number;
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  errorCode: ErrorCode;
  message: string | string[];
  fieldErrors?: ApiFieldErrors;
  details?: ApiErrorDetails;
  error: string;
  path: string;
  timestamp: string;
  requestId: string;
}

export class ApiResponse {
  static ok<TData>(
    data: TData,
    message = 'Thanh cong.',
    meta?: Record<string, unknown>,
  ): ApiResponsePayload<TData> {
    return this.payload(data, message, meta);
  }

  static created<TData>(
    data: TData,
    message = 'Tao moi thanh cong.',
    meta?: Record<string, unknown>,
  ): ApiResponsePayload<TData> {
    return this.payload(data, message, meta);
  }

  static message(message: string): ApiResponsePayload<null> {
    return this.payload(null, message);
  }

  private static payload<TData>(
    data: TData,
    message: string,
    meta?: Record<string, unknown>,
  ): ApiResponsePayload<TData> {
    return {
      data,
      message,
      meta,
      __apiResponsePayload: true,
    };
  }
}

export function isApiResponsePayload(
  value: unknown,
): value is ApiResponsePayload {
  return (
    value !== null &&
    typeof value === 'object' &&
    '__apiResponsePayload' in value &&
    value.__apiResponsePayload === true
  );
}
