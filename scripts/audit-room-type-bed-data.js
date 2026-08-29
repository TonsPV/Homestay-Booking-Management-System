"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const data_source_1 = __importDefault(require("../src/database/data-source"));
const bed_configuration_1 = require("../src/module/room-type/bed-configuration");
const room_type_bed_entity_1 = require("../src/module/room-type/schema/room-type-bed.entity");
async function run() {
    const apply = process.argv.includes('--apply');
    assertApplyIsNotProduction(apply);
    await data_source_1.default.initialize();
    try {
        const rawRows = (await data_source_1.default.query(`
      SELECT
        roomType.id,
        roomType.bed_type,
        COUNT(roomTypeBed.id) AS beds_count
      FROM room_types roomType
      LEFT JOIN room_type_beds roomTypeBed
        ON roomTypeBed.room_type_id = roomType.id
      GROUP BY roomType.id, roomType.bed_type
      ORDER BY roomType.id ASC
    `));
        const rows = parseAuditRows(rawRows);
        const pendingBackfill = [];
        const unparseable = [];
        for (const row of rows) {
            const legacyValue = row.bed_type?.trim() ?? '';
            if (legacyValue.length === 0) {
                continue;
            }
            const configurations = (0, bed_configuration_1.parseLegacyBedType)(legacyValue);
            if (configurations === null) {
                unparseable.push({ id: row.id, bedType: legacyValue });
                continue;
            }
            if (Number(row.beds_count) === 0) {
                pendingBackfill.push({ id: row.id, configurations });
            }
        }
        let appliedRows = 0;
        if (apply && pendingBackfill.length > 0) {
            await data_source_1.default.manager.transaction(async (manager) => {
                for (const pending of pendingBackfill) {
                    const existingCount = await manager
                        .getRepository(room_type_bed_entity_1.RoomTypeBed)
                        .createQueryBuilder('roomTypeBed')
                        .where('roomTypeBed.roomTypeId = :roomTypeId', {
                        roomTypeId: pending.id,
                    })
                        .getCount();
                    if (existingCount > 0) {
                        continue;
                    }
                    for (const configuration of pending.configurations) {
                        await manager.query(`
                INSERT INTO room_type_beds (room_type_id, bed_type, quantity)
                VALUES (?, ?, ?)
              `, [pending.id, configuration.type, configuration.quantity]);
                    }
                    appliedRows += pending.configurations.length;
                }
            });
        }
        console.log(JSON.stringify({
            mode: apply ? 'apply' : 'dry-run',
            totalRoomTypes: rows.length,
            legacyBedTypeNull: rows.filter((row) => row.bed_type === null || row.bed_type.trim() === '').length,
            parseableLegacy: rows.filter((row) => {
                const value = row.bed_type?.trim() ?? '';
                return value.length > 0 && (0, bed_configuration_1.parseLegacyBedType)(value) !== null;
            }).length,
            roomTypesWithBeds: rows.filter((row) => Number(row.beds_count) > 0)
                .length,
            pendingBackfill: pendingBackfill.length,
            appliedRows,
            unparseable,
        }, null, 2));
    }
    finally {
        await data_source_1.default.destroy();
    }
}
function assertApplyIsNotProduction(apply) {
    if (!apply) {
        return;
    }
    const environment = process.env.NODE_ENV?.trim().toLowerCase();
    const database = process.env.DB_DATABASE?.trim().toLowerCase() ?? '';
    if (environment === 'production' ||
        /(^|[_-])prod(uction)?($|[_-])/.test(database)) {
        throw new Error('Refusing to apply RoomType bed backfill on production.');
    }
}
void run().catch((error) => {
    const message = error instanceof Error ? error.stack : String(error);
    console.error(message);
    process.exitCode = 1;
});
function parseAuditRows(value) {
    if (!Array.isArray(value)) {
        throw new Error('RoomType bed audit query returned an invalid result.');
    }
    return value.map((row) => {
        if (!isRecord(row)) {
            throw new Error('RoomType bed audit query returned an invalid row.');
        }
        const id = row.id;
        const bedType = row.bed_type;
        const bedsCount = row.beds_count;
        if (typeof id !== 'string' &&
            typeof id !== 'number' &&
            typeof id !== 'bigint') {
            throw new Error('RoomType bed audit query returned an invalid id.');
        }
        if (bedType !== null && typeof bedType !== 'string') {
            throw new Error('RoomType bed audit query returned an invalid legacy value.');
        }
        if (typeof bedsCount !== 'number' && typeof bedsCount !== 'string') {
            throw new Error('RoomType bed audit query returned an invalid bed count.');
        }
        return {
            id: String(id),
            bed_type: bedType,
            beds_count: bedsCount,
        };
    });
}
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
//# sourceMappingURL=audit-room-type-bed-data.js.map