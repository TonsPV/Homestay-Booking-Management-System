export enum BedType {
  SINGLE = 'SINGLE',
  DOUBLE = 'DOUBLE',
  QUEEN = 'QUEEN',
  KING = 'KING',
  BUNK = 'BUNK',
  SOFA_BED = 'SOFA_BED',
}

export interface BedConfiguration {
  type: BedType;
  quantity: number;
}

export const BED_TYPE_ORDER: readonly BedType[] = [
  BedType.SINGLE,
  BedType.DOUBLE,
  BedType.QUEEN,
  BedType.KING,
  BedType.BUNK,
  BedType.SOFA_BED,
];

export const MAX_BED_TYPES = BED_TYPE_ORDER.length;
export const MAX_BED_QUANTITY = 20;

/**
 * Parses only the explicitly supported legacy phrases. Unknown free text is
 * deliberately returned as null so migration/audit callers can preserve it.
 */
export function parseLegacyBedType(value: string): BedConfiguration[] | null {
  const normalized = normalizeLegacyBedType(value);

  if (normalized.length === 0) {
    return null;
  }

  const segments = normalized.split(/\s+(?:va|and)\s+/g);
  const parsed = segments.map(parseLegacyBedSegment);

  if (parsed.some((configuration) => configuration === null)) {
    return null;
  }

  const merged = new Map<BedType, number>();

  for (const configuration of parsed as BedConfiguration[]) {
    const quantity =
      (merged.get(configuration.type) ?? 0) + configuration.quantity;

    if (quantity > MAX_BED_QUANTITY) {
      return null;
    }

    merged.set(configuration.type, quantity);
  }

  return BED_TYPE_ORDER.filter((type) => merged.has(type)).map((type) => ({
    type,
    quantity: merged.get(type) as number,
  }));
}

export function sortBedConfigurations(
  configurations: BedConfiguration[],
): BedConfiguration[] {
  const order = new Map(BED_TYPE_ORDER.map((type, index) => [type, index]));

  return [...configurations].sort(
    (left, right) =>
      (order.get(left.type) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.type) ?? Number.MAX_SAFE_INTEGER),
  );
}

function normalizeLegacyBedType(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseLegacyBedSegment(value: string): BedConfiguration | null {
  const match = /^(?:(\d+)\s+)?(.+)$/.exec(value);
  const quantity = match?.[1] === undefined ? 1 : Number(match[1]);
  const label = match?.[2] ?? value;

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_BED_QUANTITY
  ) {
    return null;
  }

  switch (label) {
    case 'single':
    case 'don':
    case 'giuong don':
      return { type: BedType.SINGLE, quantity };
    case 'double':
    case 'doi':
    case 'giuong doi':
      return { type: BedType.DOUBLE, quantity };
    case 'queen':
    case 'queen bed':
      return { type: BedType.QUEEN, quantity };
    case 'king':
    case 'king bed':
      return { type: BedType.KING, quantity };
    case 'bunk':
    case 'bunk bed':
    case 'tang':
    case 'giuong tang':
      return { type: BedType.BUNK, quantity };
    case 'sofa':
    case 'sofa bed':
    case 'giuong sofa':
      return { type: BedType.SOFA_BED, quantity };
    default:
      return null;
  }
}
