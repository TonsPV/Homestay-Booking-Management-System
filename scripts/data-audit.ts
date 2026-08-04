import AppDataSource from '../src/database/data-source';
import { runDataAudit } from '../src/database/data-audit';

async function main(): Promise<void> {
  try {
    await AppDataSource.initialize();
    const results = await runDataAudit(AppDataSource);
    const violations = results.filter(
      ({ violationCount }) => violationCount > 0,
    );

    for (const { check, violationCount } of results) {
      const marker = violationCount === 0 ? 'PASS' : 'FAIL';
      console.log(
        `[${marker}] ${check.name}: ${violationCount} violation(s) - ${check.description}`,
      );
    }

    if (violations.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`Data audit failed: ${message}`);
    process.exitCode = 1;
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

void main();
