"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const password_hasher_service_1 = require("../src/module/auth/password-hasher.service");
const user_entity_1 = require("../src/module/user/schema/user.entity");
const customer_entity_1 = require("../src/module/customer/schema/customer.entity");
const data_source_1 = __importDefault(require("../src/database/data-source"));
const e2e_environment_1 = require("../src/config/e2e-environment");
const validation_1 = require("../src/common/validation");
function requiredEnvironmentValue(key) {
    const value = process.env[key]?.trim();
    if (!value) {
        throw new Error(`${key} is required.`);
    }
    return value;
}
async function provisionAccount(account, passwordHash) {
    const repository = data_source_1.default.getRepository(user_entity_1.User);
    const existing = await repository.findOne({
        where: { email: account.email },
        withDeleted: true,
    });
    if (existing) {
        existing.deletedAt = null;
        existing.fullName = account.fullName;
        existing.passwordHash = passwordHash;
        existing.phone = null;
        existing.role = account.role;
        existing.status = 'ACTIVE';
        existing.tokenVersion += 1;
        return repository.save(existing);
    }
    return repository.save(repository.create({
        ...account,
        passwordHash,
        phone: null,
        status: 'ACTIVE',
    }));
}
async function provisionCounterCustomer(phone) {
    const repository = data_source_1.default.getRepository(customer_entity_1.Customer);
    const existing = await repository.findOne({
        where: { phone },
        withDeleted: true,
    });
    if (existing) {
        existing.deletedAt = null;
        existing.email = null;
        existing.fullName = 'Live E2E Counter Customer';
        existing.passwordHash = null;
        existing.status = 'ACTIVE';
        existing.tokenVersion += 1;
        return repository.save(existing);
    }
    return repository.save(repository.create({
        email: null,
        fullName: 'Live E2E Counter Customer',
        passwordHash: null,
        phone,
        status: 'ACTIVE',
    }));
}
async function main() {
    (0, e2e_environment_1.assertSafeE2eEnvironment)(process.env);
    const adminEmail = (0, validation_1.requireEmail)(requiredEnvironmentValue('HBMS_LIVE_ADMIN_IDENTIFIER'));
    const staffEmail = (0, validation_1.requireEmail)(requiredEnvironmentValue('HBMS_LIVE_STAFF_IDENTIFIER'));
    const password = (0, validation_1.requirePassword)(requiredEnvironmentValue('HBMS_LIVE_AUTH_PASSWORD'));
    const counterCustomerPhone = (0, validation_1.requiredPhone)(requiredEnvironmentValue('HBMS_LIVE_COUNTER_CUSTOMER_PHONE'));
    const passwordHash = await new password_hasher_service_1.PasswordHasherService().hash(password);
    await data_source_1.default.initialize();
    try {
        const admin = await provisionAccount({
            email: adminEmail,
            fullName: 'Live E2E Administrator',
            role: 'ADMIN',
        }, passwordHash);
        const staff = await provisionAccount({
            email: staffEmail,
            fullName: 'Live E2E Staff',
            role: 'STAFF',
        }, passwordHash);
        const counterCustomer = await provisionCounterCustomer(counterCustomerPhone);
        console.log(`Provisioned live auth fixtures in test DB: ADMIN id=${admin.id}, STAFF id=${staff.id}, counter CUSTOMER id=${counterCustomer.id}.`);
    }
    finally {
        await data_source_1.default.destroy();
    }
}
if (require.main === module) {
    void main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=provision-live-auth-fixtures.js.map