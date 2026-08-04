import AppDataSource from '../src/database/data-source';

async function main(): Promise<void> {
  try {
    await AppDataSource.initialize();
    const schemaLog = await AppDataSource.driver.createSchemaBuilder().log();

    if (schemaLog.upQueries.length > 0) {
      const preview = schemaLog.upQueries
        .slice(0, 10)
        .map(({ query }) => `- ${query}`)
        .join('\n');
      throw new Error(
        `Entity metadata and migrations have drifted (${schemaLog.upQueries.length} pending schema operation(s)):\n${preview}`,
      );
    }

    console.log('Database schema matches entity metadata.');
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';

  console.error(`Schema drift check failed: ${message}`);
  process.exitCode = 1;
});
