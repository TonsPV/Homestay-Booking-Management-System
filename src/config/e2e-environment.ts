export function assertSafeE2eEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV !== 'test') {
    throw new Error(
      `Refusing to run E2E tests when NODE_ENV is not test: ${environment.NODE_ENV ?? '<empty>'}`,
    );
  }

  const database = environment.DB_DATABASE?.trim();

  if (database === undefined || database.length === 0) {
    throw new Error('Refusing to run E2E tests without DB_DATABASE.');
  }

  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run E2E tests against non-test database: ${database}`,
    );
  }
}
