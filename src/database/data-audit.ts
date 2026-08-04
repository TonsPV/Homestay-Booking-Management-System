import type { DataSource } from 'typeorm';

export interface DataAuditCheck {
  name: string;
  description: string;
  sql: string;
  parameters?: readonly unknown[];
}

export interface DataAuditResult {
  check: DataAuditCheck;
  violationCount: number;
}

interface ViolationCountRow {
  violationCount: string | number | null;
}

export const DATA_AUDIT_CHECKS: readonly DataAuditCheck[] = [
  {
    name: 'active-booking-calendar',
    description:
      'Active bookings have one RESERVED calendar row per booked night.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM bookings b
      WHERE b.status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN')
        AND (
          SELECT COUNT(*)
          FROM room_calendar rc
          WHERE rc.booking_id = b.id
            AND rc.room_id = b.room_id
            AND rc.status = 'RESERVED'
        ) <> DATEDIFF(b.check_out_date, b.check_in_date)
    `,
  },
  {
    name: 'cancelled-booking-calendar',
    description: 'Cancelled bookings do not retain RESERVED calendar rows.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM bookings b
      WHERE b.status = 'CANCELLED'
        AND EXISTS (
          SELECT 1
          FROM room_calendar rc
          WHERE rc.booking_id = b.id
            AND rc.status = 'RESERVED'
        )
    `,
  },
  {
    name: 'single-success-payment',
    description: 'A booking has at most one SUCCESS payment.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM (
        SELECT booking_id
        FROM payments
        WHERE status = 'SUCCESS'
        GROUP BY booking_id
        HAVING COUNT(*) > 1
      ) duplicate_success
    `,
  },
  {
    name: 'booking-payment-status',
    description:
      'Booking payment status agrees with successful/refunded payments.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM bookings b
      WHERE
        (
          b.payment_status = 'PAID'
          AND NOT EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.booking_id = b.id
              AND (
                p.status = 'SUCCESS'
                OR (
                  p.status = 'REFUND_PENDING'
                  AND p.refund_previous_status = 'SUCCESS'
                )
              )
          )
        )
        OR (
          b.payment_status = 'REFUNDED'
          AND NOT EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.booking_id = b.id
              AND p.status = 'REFUNDED'
          )
        )
        OR (
          b.payment_status = 'UNPAID'
          AND EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.booking_id = b.id
              AND (
                p.status IN ('SUCCESS', 'REFUNDED')
                OR (
                  p.status = 'REFUND_PENDING'
                  AND p.refund_previous_status = 'SUCCESS'
                )
              )
          )
        )
    `,
  },
  {
    name: 'room-occupancy',
    description:
      'OCCUPIED rooms and CHECKED_IN bookings agree in both directions.',
    sql: `
      SELECT
        (
          SELECT COUNT(*)
          FROM rooms r
          WHERE r.deleted_at IS NULL
            AND r.status = 'OCCUPIED'
            AND NOT EXISTS (
              SELECT 1
              FROM bookings b
              WHERE b.room_id = r.id
                AND b.status = 'CHECKED_IN'
            )
        )
        +
        (
          SELECT COUNT(*)
          FROM bookings b
          INNER JOIN rooms r ON r.id = b.room_id
          WHERE b.status = 'CHECKED_IN'
            AND r.status <> 'OCCUPIED'
        ) AS violationCount
    `,
  },
  {
    name: 'room-image-cover',
    description: 'Every room with images has exactly one cover image.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM (
        SELECT room_id
        FROM room_images
        GROUP BY room_id
        HAVING SUM(is_cover = 1) <> 1
      ) invalid_cover
    `,
  },
  {
    name: 'room-type-amenity-orphan',
    description: 'The room type/amenity join table has no orphan rows.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM room_type_amenities rta
      LEFT JOIN room_types rt ON rt.id = rta.room_type_id
      LEFT JOIN amenities a ON a.id = rta.amenity_id
      WHERE rt.id IS NULL OR a.id IS NULL
    `,
  },
  {
    name: 'expired-booking',
    description: 'Expired bookings are not left in PENDING_PAYMENT.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM bookings
      WHERE status = 'PENDING_PAYMENT'
        AND payment_expires_at IS NOT NULL
        AND payment_expires_at < UTC_TIMESTAMP(6)
    `,
  },
  {
    name: 'expired-payment',
    description: 'Expired VNPay payments are not left in PENDING.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM payments
      WHERE status = 'PENDING'
        AND method = 'VNPAY'
        AND expires_at IS NOT NULL
        AND expires_at < UTC_TIMESTAMP(6)
    `,
  },
  {
    name: 'stale-refund',
    description: 'Refunds pending for more than seven days are highlighted.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM payments
      WHERE status = 'REFUND_PENDING'
        AND refund_requested_at IS NOT NULL
        AND refund_requested_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 7 DAY)
    `,
  },
  {
    name: 'customer-claim-single-pending',
    description:
      'A Customer has at most one pending challenge for each claim purpose.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM (
        SELECT customer_id, purpose
        FROM customer_claim_challenges
        WHERE status = 'PENDING'
        GROUP BY customer_id, purpose
        HAVING COUNT(*) > 1
      ) duplicate_pending_claim
    `,
  },
  {
    name: 'customer-claim-state',
    description:
      'Customer claim timestamps and token evidence agree with challenge status.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM customer_claim_challenges
      WHERE
        (
          status = 'PENDING'
          AND (
            verified_at IS NOT NULL
            OR claim_token_hash IS NOT NULL
            OR claim_token_expires_at IS NOT NULL
            OR consumed_at IS NOT NULL
          )
        )
        OR (
          status = 'VERIFIED'
          AND (
            verified_at IS NULL
            OR claim_token_hash IS NULL
            OR claim_token_expires_at IS NULL
            OR consumed_at IS NOT NULL
          )
        )
        OR (
          status = 'CONSUMED'
          AND (
            verified_at IS NULL
            OR claim_token_hash IS NULL
            OR claim_token_expires_at IS NULL
            OR consumed_at IS NULL
          )
        )
        OR (
          status IN ('BLOCKED', 'EXPIRED')
          AND consumed_at IS NOT NULL
        )
    `,
  },
];

export async function runDataAudit(
  dataSource: DataSource,
): Promise<DataAuditResult[]> {
  const results: DataAuditResult[] = [];

  for (const check of DATA_AUDIT_CHECKS) {
    assertReadOnlyQuery(check.sql);
    const rows = await dataSource.query<ViolationCountRow[]>(
      check.sql,
      check.parameters,
    );
    const violationCount = Number(rows[0]?.violationCount ?? 0);

    if (!Number.isFinite(violationCount) || violationCount < 0) {
      throw new Error(`Audit check ${check.name} returned an invalid count.`);
    }

    results.push({ check, violationCount });
  }

  return results;
}

export function assertReadOnlyQuery(sql: string): void {
  const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();

  if (!normalized.startsWith('SELECT ')) {
    throw new Error('Data audit checks must be read-only SELECT statements.');
  }

  if (
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|REPLACE)\b/.test(
      normalized,
    )
  ) {
    throw new Error('Data audit checks must not mutate the database.');
  }
}
