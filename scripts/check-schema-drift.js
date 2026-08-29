"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const data_source_1 = __importDefault(require("../src/database/data-source"));
async function main() {
    try {
        await data_source_1.default.initialize();
        const schemaLog = await data_source_1.default.driver.createSchemaBuilder().log();
        if (schemaLog.upQueries.length > 0) {
            const preview = schemaLog.upQueries
                .slice(0, 10)
                .map(({ query }) => `- ${query}`)
                .join('\n');
            throw new Error(`Entity metadata and migrations have drifted (${schemaLog.upQueries.length} pending schema operation(s)):\n${preview}`);
        }
        console.log('Database schema matches entity metadata.');
    }
    finally {
        if (data_source_1.default.isInitialized) {
            await data_source_1.default.destroy();
        }
    }
}
void main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Schema drift check failed: ${message}`);
    process.exitCode = 1;
});
//# sourceMappingURL=check-schema-drift.js.map