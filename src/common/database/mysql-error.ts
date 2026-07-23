import { QueryFailedError } from 'typeorm';

interface MysqlDriverError {
  code?: unknown;
  message?: unknown;
}

export function getMysqlDuplicateKey(error: unknown): string | undefined {
  const driverError = getMysqlDriverError(error);

  if (driverError?.code !== 'ER_DUP_ENTRY') {
    return undefined;
  }

  if (typeof driverError.message !== 'string') {
    return '';
  }

  const match = /for key ['`](?:[^.'`]+[.])?([^'`]+)['`]/i.exec(
    driverError.message,
  );

  return match?.[1] ?? '';
}

function getMysqlDriverError(error: unknown): MysqlDriverError | undefined {
  if (!(error instanceof QueryFailedError)) {
    return undefined;
  }

  if (error.driverError === null || typeof error.driverError !== 'object') {
    return undefined;
  }

  return error.driverError as MysqlDriverError;
}
