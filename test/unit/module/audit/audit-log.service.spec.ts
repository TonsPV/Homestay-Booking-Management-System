import type { EntityManager } from 'typeorm';

import { AuditLogService } from '../../../../src/module/audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  AuditLog,
} from '../../../../src/module/audit/schema/audit-log.entity';

describe('AuditLogService', () => {
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
