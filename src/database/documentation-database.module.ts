import { Global, Module } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';

/**
 * OpenAPI generation only needs controller metadata. This provider satisfies
 * TypeORM injection without connecting to a database or running migrations.
 */
const documentationRepository = new Proxy(
  {},
  {
    get(_target, property) {
      if (
        property === 'then' ||
        property === 'onModuleDestroy' ||
        property === 'onModuleInit' ||
        property === 'onApplicationBootstrap' ||
        property === 'beforeApplicationShutdown' ||
        property === 'onApplicationShutdown'
      ) {
        return undefined;
      }

      return () => {
        throw new Error(
          'Database access is unavailable during OpenAPI generation.',
        );
      };
    },
  },
) as Repository<ObjectLiteral>;

const documentationDataSource = {
  entityMetadatas: [],
  options: { type: 'mysql' },
  getMongoRepository: () => documentationRepository,
  getRepository: () => documentationRepository,
  getTreeRepository: () => documentationRepository,
} as unknown as DataSource;

@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken(),
      useValue: documentationDataSource,
    },
  ],
  exports: [getDataSourceToken()],
})
export class DocumentationDatabaseModule {}
