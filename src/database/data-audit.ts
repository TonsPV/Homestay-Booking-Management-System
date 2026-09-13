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
    name: 'positive-price',
    description: 'Persisted room and booking prices are strictly positive.',
    sql: `
      SELECT
        (
          SELECT COUNT(*)
          FROM room_types
          WHERE base_price <= 0
        )
        +
        (
          SELECT COUNT(*)
          FROM bookings
          WHERE total_amount <= 0
        ) AS violationCount
    `,
  },
  {
    name: 'payment-lineage',
    description:
      'Each accepted payment lineage is represented by the booking authority pointer.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM bookings b
      WHERE
        (
          b.accepted_payment_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.booking_id = b.id
              AND p.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
          )
        )
        OR (
          b.accepted_payment_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.id = b.accepted_payment_id
              AND p.booking_id = b.id
              AND p.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
          )
        )
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
                   AND EXISTS (
                     SELECT 1
                     FROM payment_refunds pr
                     WHERE pr.payment_id = p.id
                       AND pr.previous_payment_status = 'SUCCESS'
                   )
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
                   AND EXISTS (
                     SELECT 1
                     FROM payment_refunds pr
                     WHERE pr.payment_id = p.id
                       AND pr.previous_payment_status = 'SUCCESS'
                   )
                )
              )
          )
        )
    `,
  },
  {
    name: 'payment-refund-lineage',
    description:
      'Every pending or completed refund payment has one extracted refund operation.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM payments p
      LEFT JOIN payment_refunds pr ON pr.payment_id = p.id
      WHERE p.status IN ('REFUND_PENDING', 'REFUNDED')
        AND pr.id IS NULL
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
      FROM payments p
      INNER JOIN payment_refunds pr ON pr.payment_id = p.id
      WHERE p.status = 'REFUND_PENDING'
        AND pr.requested_at IS NOT NULL
        AND pr.requested_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 7 DAY)
    `,
  },
  {
    name: 'chat-conversation-summary',
    description:
      'Chat conversation sequence and cached last-message fields match committed messages.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM chat_conversations cc
      LEFT JOIN (
        SELECT
          conversation_id,
          COUNT(*) AS message_count,
          MAX(sequence) AS max_sequence
        FROM chat_messages
        GROUP BY conversation_id
      ) cm ON cm.conversation_id = cc.id
      LEFT JOIN chat_messages lm
        ON lm.conversation_id = cc.id
       AND lm.sequence = cc.last_sequence
      WHERE cc.last_sequence <> COALESCE(cm.max_sequence, 0)
        OR COALESCE(cm.message_count, 0) <> cc.last_sequence
        OR (
          cc.last_sequence = 0
          AND (
            cc.last_message_content IS NOT NULL
            OR cc.last_message_actor_type IS NOT NULL
            OR cc.last_message_actor_id IS NOT NULL
            OR cc.last_message_at IS NOT NULL
          )
        )
        OR (
          cc.last_sequence > 0
          AND (
            lm.id IS NULL
            OR cc.last_message_content <> lm.content
            OR cc.last_message_actor_type <> lm.sender_actor_type
            OR cc.last_message_actor_id <> lm.sender_actor_id
            OR cc.last_message_at <> lm.created_at
          )
        )
    `,
  },
  {
    name: 'chat-read-state-bound',
    description:
      'A chat read marker never advances past the last committed message.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM chat_read_states rs
      INNER JOIN chat_conversations cc ON cc.id = rs.conversation_id
      WHERE rs.last_read_sequence > cc.last_sequence
    `,
  },
  {
    name: 'chat-message-sender',
    description:
      'Chat messages come from the booking customer or an existing support user.',
    sql: `
      SELECT COUNT(*) AS violationCount
      FROM chat_messages cm
      INNER JOIN chat_conversations cc ON cc.id = cm.conversation_id
      INNER JOIN bookings b ON b.id = cc.booking_id
      LEFT JOIN customers c ON c.id = cm.sender_actor_id
      LEFT JOIN users u ON u.id = cm.sender_actor_id
      WHERE (
        cm.sender_actor_type = 'customer'
        AND (cm.sender_actor_id <> b.customer_id OR c.id IS NULL)
      )
      OR (
        cm.sender_actor_type = 'user'
        AND (u.id IS NULL OR u.role NOT IN ('STAFF', 'ADMIN'))
      )
      OR cm.sender_actor_type NOT IN ('customer', 'user')
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
