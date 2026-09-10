import type { EntityManager } from 'typeorm';

import { buildAuditInsertInput } from '../../../../src/module/audit/audit-log.mapper';
import { AuditLogService } from '../../../../src/module/audit/audit-log.service';
import { AuditLog } from '../../../../src/module/audit/schema/audit-log.entity';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../../../src/module/audit/domain/audit-log';

describe('AuditLogService', () => {
  it('builds nullable persistence fields without mutating domain input', () => {
    const input = {
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      action: AuditAction.BOOKING_CANCELLED,
      entityType: AuditEntityType.BOOKING,
      entityId: '34',
    };

    expect(buildAuditInsertInput(input)).toEqual({
      ...input,
      requestId: null,
      metadata: null,
    });
    expect(input).not.toHaveProperty('requestId');
    expect(input).not.toHaveProperty('metadata');
  });

  it('writes only the explicit immutable audit fields through the caller transaction', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const getRepository = jest.fn().mockReturnValue({ insert });
    const service = new AuditLogService();

    await service.record({ getRepository } as unknown as EntityManager, {
      actorType: AuditActorType.USER,
      actorId: '12',
      action: AuditAction.ROOM_STATUS_CHANGED,
      entityType: AuditEntityType.ROOM,
      entityId: '34',
      requestId: 'req-1',
      metadata: { fromStatus: 'READY', toStatus: 'MAINTENANCE' },
    });

    expect(getRepository).toHaveBeenCalledWith(AuditLog);
    expect(insert).toHaveBeenCalledWith({
      actorType: AuditActorType.USER,
      actorId: '12',
      action: AuditAction.ROOM_STATUS_CHANGED,
      entityType: AuditEntityType.ROOM,
      entityId: '34',
      requestId: 'req-1',
      metadata: { fromStatus: 'READY', toStatus: 'MAINTENANCE' },
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
