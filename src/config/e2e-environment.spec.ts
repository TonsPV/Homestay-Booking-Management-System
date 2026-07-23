import { assertSafeE2eEnvironment } from './e2e-environment';

describe('E2E environment safety', () => {
  it('accepts a dedicated test database', () => {
    expect(() =>
      assertSafeE2eEnvironment({
        NODE_ENV: 'test',
        DB_DATABASE: 'hbms_test',
      }),
    ).not.toThrow();
  });

  it('rejects a non-test NODE_ENV', () => {
    expect(() =>
      assertSafeE2eEnvironment({
        NODE_ENV: 'development',
        DB_DATABASE: 'hbms_test',
      }),
    ).toThrow('NODE_ENV is not test');
  });

  it('rejects an empty database name', () => {
    expect(() =>
      assertSafeE2eEnvironment({
        NODE_ENV: 'test',
        DB_DATABASE: '',
      }),
    ).toThrow('without DB_DATABASE');
  });

  it('rejects a database without the test suffix', () => {
    expect(() =>
      assertSafeE2eEnvironment({
        NODE_ENV: 'test',
        DB_DATABASE: 'hbms_dev',
      }),
    ).toThrow('Refusing to run E2E tests against non-test database: hbms_dev');
  });
});
