import { normalizePhone } from '../../common/validation';

export type PhoneSource = 'customers' | 'users';

export interface PhoneRecord {
  source: PhoneSource;
  id: string;
  phone: string | null;
}

export interface PhoneChange {
  source: PhoneSource;
  id: string;
  currentPhone: string;
  normalizedPhone: string;
}

export interface PhoneCollision {
  source: PhoneSource;
  ids: string[];
  normalizedPhone: string;
}

export interface PhoneNormalizationPlan {
  changes: PhoneChange[];
  invalidRecords: PhoneRecord[];
  collisions: PhoneCollision[];
}

export function isProductionEnvironment(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'production';
}

export function createPhoneNormalizationPlan(
  records: PhoneRecord[],
): PhoneNormalizationPlan {
  const changes: PhoneChange[] = [];
  const invalidRecords: PhoneRecord[] = [];
  const normalizedGroups = new Map<string, PhoneRecord[]>();

  for (const record of records) {
    if (record.phone === null) {
      continue;
    }

    const normalizedPhone = normalizePhone(record.phone);

    if (normalizedPhone === null) {
      invalidRecords.push(record);
      continue;
    }

    const groupKey = `${record.source}:${normalizedPhone}`;
    const group = normalizedGroups.get(groupKey) ?? [];

    group.push(record);
    normalizedGroups.set(groupKey, group);

    if (record.phone !== normalizedPhone) {
      changes.push({
        source: record.source,
        id: record.id,
        currentPhone: record.phone,
        normalizedPhone,
      });
    }
  }

  const collisions = [...normalizedGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([groupKey, group]) => ({
      source: group[0].source,
      normalizedPhone: groupKey.slice(groupKey.indexOf(':') + 1),
      ids: group.map((record) => record.id),
    }));

  return { changes, invalidRecords, collisions };
}
