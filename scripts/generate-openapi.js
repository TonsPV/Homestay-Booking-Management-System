"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const core_1 = require("@nestjs/core");
const app_module_1 = require("../src/app.module");
const http_1 = require("../src/common/http");
const openapi_1 = require("../src/openapi/openapi");
const openapi_contract_1 = require("../src/openapi/openapi-contract");
async function generateOpenApi() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        abortOnError: false,
        bodyParser: false,
        logger: false,
    });
    try {
        (0, http_1.configureApp)(app);
        const outputDirectory = (0, node_path_1.resolve)(process.cwd(), 'openapi');
        const outputPath = (0, node_path_1.resolve)(outputDirectory, 'openapi.json');
        await (0, promises_1.mkdir)(outputDirectory, { recursive: true });
        const document = (0, openapi_1.createOpenApiDocument)(app);
        (0, openapi_contract_1.assertOpenApiResponseSchemas)(document);
        const serializedDocument = `${JSON.stringify(document, null, 2)}\n`;
        if (process.argv.includes('--check')) {
            const committedDocument = await (0, promises_1.readFile)(outputPath, 'utf8');
            if (committedDocument !== serializedDocument) {
                throw new Error('openapi/openapi.json is stale. Run npm run openapi:generate and commit the result.');
            }
            console.log('OpenAPI snapshot is current.');
            return;
        }
        await (0, promises_1.writeFile)(outputPath, serializedDocument, 'utf8');
        console.log(`OpenAPI snapshot written to ${outputPath}`);
    }
    finally {
        await app.close();
    }
}
void generateOpenApi().catch((error) => {
    const message = error instanceof Error ? error.stack : String(error);
    console.error(`OpenAPI generation failed:\n${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=generate-openapi.js.map