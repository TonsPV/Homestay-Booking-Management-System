"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const data_source_1 = __importDefault(require("../src/database/data-source"));
const data_audit_1 = require("../src/database/data-audit");
async function main() {
    try {
        await data_source_1.default.initialize();
        const results = await (0, data_audit_1.runDataAudit)(data_source_1.default);
        const violations = results.filter(({ violationCount }) => violationCount > 0);
        for (const { check, violationCount } of results) {
            const marker = violationCount === 0 ? 'PASS' : 'FAIL';
            console.log(`[${marker}] ${check.name}: ${violationCount} violation(s) - ${check.description}`);
        }
        if (violations.length > 0) {
            process.exitCode = 1;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Data audit failed: ${message}`);
        process.exitCode = 1;
    }
    finally {
        if (data_source_1.default.isInitialized) {
            await data_source_1.default.destroy();
        }
    }
}
void main();
//# sourceMappingURL=data-audit.js.map