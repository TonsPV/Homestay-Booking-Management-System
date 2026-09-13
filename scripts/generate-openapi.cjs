// The runner sets this before TypeScript evaluates AppModule. It lets the
// OpenAPI script install its metadata-only database provider instead of
// connecting to or migrating an operational database.
process.env.OPENAPI_GENERATION = 'true';

require('ts-node/register');
require('tsconfig-paths/register');
require('./generate-openapi.ts');
