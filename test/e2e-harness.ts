import type { DataSource } from 'typeorm';

import { assertSafeE2eEnvironment } from '../src/config/e2e-environment';

type CleanupCallback = () => Promise<void> | void;

/**
 * Shared lifecycle guard for MySQL-backed E2E suites.
 *
 * The harness deliberately keeps the destructive work supplied by the suite
 * callback, while owning the safety assertion and the one-time migration
 * lifecycle. This lets later module suites register scoped cleanup without
 * each suite inventing its own environment checks.
 */
export class E2eHarness {
  private initialized = false;
  private cleanupStarted = false;
  private readonly cleanupCallbacks: CleanupCallback[] = [];

  constructor(
    private readonly migrationDataSource: DataSource,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async initialize(): Promise<void> {
    assertSafeE2eEnvironment(this.environment);

    if (this.initialized) {
      return;
    }

    await this.migrationDataSource.initialize();
    try {
      await this.migrationDataSource.runMigrations();
      this.initialized = true;
    } finally {
      await this.migrationDataSource.destroy();
    }
  }

  registerCleanup(callback: CleanupCallback): void {
    if (this.cleanupStarted) {
      throw new Error('Cannot register E2E cleanup after cleanup has started.');
    }

    this.cleanupCallbacks.unshift(callback);
  }

  async cleanup(legacyCallback?: CleanupCallback): Promise<void> {
    if (this.cleanupStarted) {
      return;
    }

    assertSafeE2eEnvironment(this.environment);
    this.cleanupStarted = true;

    if (legacyCallback !== undefined) {
      await legacyCallback();
    }

    for (const callback of this.cleanupCallbacks) {
      await callback();
    }

    this.cleanupCallbacks.length = 0;
  }

  static createUniqueSuffix(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
