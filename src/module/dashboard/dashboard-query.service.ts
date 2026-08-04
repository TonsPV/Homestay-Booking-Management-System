import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto';
import {
  BookingStatusCount,
  DashboardSummaryResponse,
  OccupancyMetrics,
  PaymentMetrics,
  RevenueByMethod,
  RoomStatusCount,
} from './dto/dashboard-summary.response';

const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

interface BookingStatusRow {
  pendingPayment: string | number | null;
  confirmed: string | number | null;
  checkedIn: string | number | null;
  checkedOut: string | number | null;
  cancelled: string | number | null;
}

interface RoomStatusRow {
  ready: string | number | null;
  occupied: string | number | null;
  cleaning: string | number | null;
  maintenance: string | number | null;
}

interface RevenueRow {
  vnpay: string | number | null;
  manual: string | number | null;
}

interface CountRow {
  count: string | number | null;
}

interface PaymentMetricsRow {
  requiresReview: string | number | null;
  refundPending: string | number | null;
}

interface OccupancyRow {
  reserved: string | number | null;
  blocked: string | number | null;
  operationalRooms: string | number | null;
}

@Injectable()
export class DashboardQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async getSummary(
    query: DashboardSummaryQueryDto,
  ): Promise<DashboardSummaryResponse> {
    const { fromDate, toDate, inclusiveDays } = this.parseDateRange(query);
    const [bookings, rooms, revenue, refunded, payments, occupancy] =
      await Promise.all([
        this.getBookingStatusCounts(fromDate, toDate),
        this.getRoomStatusCounts(),
        this.getRevenueByMethod(fromDate, toDate),
        this.getTotalRefunded(fromDate, toDate),
        this.getPaymentMetrics(fromDate, toDate),
        this.getOccupancyMetrics(fromDate, toDate, inclusiveDays),
      ]);

    return {
      fromDate,
      toDate,
      bookings,
      rooms,
      revenue,
      totalRefunded: refunded,
      payments,
      occupancy,
      generatedAt: new Date().toISOString(),
    };
  }

  private parseDateRange(query: DashboardSummaryQueryDto): {
    fromDate: string;
    toDate: string;
    inclusiveDays: number;
  } {
    const fromDate = this.requireIsoDate(
      query.from,
      'Ngay bat dau khong hop le.',
    );
    const toDate = this.requireIsoDate(query.to, 'Ngay ket thuc khong hop le.');
    const fromTime = Date.parse(`${fromDate}T00:00:00.000Z`);
    const toTime = Date.parse(`${toDate}T00:00:00.000Z`);

    if (fromTime > toTime) {
      throw new BadRequestException(
        'Ngay bat dau phai truoc hoac bang ngay ket thuc.',
      );
    }

    const inclusiveDays =
      Math.floor((toTime - fromTime) / MILLISECONDS_PER_DAY) + 1;

    if (inclusiveDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        'Khoang ngay khong duoc vuot qua 366 ngay.',
      );
    }

    return { fromDate, toDate, inclusiveDays };
  }

  private requireIsoDate(value: unknown, message: string): string {
    if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
      throw new BadRequestException(message);
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(message);
    }

    return value;
  }

  private async getBookingStatusCounts(
    fromDate: string,
    toDate: string,
  ): Promise<BookingStatusCount> {
    const rows = await this.dataSource.query<BookingStatusRow[]>(
      `
        SELECT
          SUM(status = 'PENDING_PAYMENT') AS pendingPayment,
          SUM(status = 'CONFIRMED') AS confirmed,
          SUM(status = 'CHECKED_IN') AS checkedIn,
          SUM(status = 'CHECKED_OUT') AS checkedOut,
          SUM(status = 'CANCELLED') AS cancelled
        FROM bookings
        WHERE created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+07:00', '+00:00')
          AND created_at < CONVERT_TZ(
            DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY),
            '+07:00',
            '+00:00'
          )
      `,
      [fromDate, toDate],
    );
    const row = rows[0];

    return {
      pendingPayment: this.toNumber(row?.pendingPayment),
      confirmed: this.toNumber(row?.confirmed),
      checkedIn: this.toNumber(row?.checkedIn),
      checkedOut: this.toNumber(row?.checkedOut),
      cancelled: this.toNumber(row?.cancelled),
    };
  }

  private async getRoomStatusCounts(): Promise<RoomStatusCount> {
    const rows = await this.dataSource.query<RoomStatusRow[]>(`
      SELECT
        SUM(status = 'READY') AS ready,
        SUM(status = 'OCCUPIED') AS occupied,
        SUM(status = 'CLEANING') AS cleaning,
        SUM(status = 'MAINTENANCE') AS maintenance
      FROM rooms
      WHERE deleted_at IS NULL
    `);
    const row = rows[0];

    return {
      ready: this.toNumber(row?.ready),
      occupied: this.toNumber(row?.occupied),
      cleaning: this.toNumber(row?.cleaning),
      maintenance: this.toNumber(row?.maintenance),
    };
  }

  private async getRevenueByMethod(
    fromDate: string,
    toDate: string,
  ): Promise<RevenueByMethod> {
    const rows = await this.dataSource.query<RevenueRow[]>(
      `
        SELECT
          SUM(CASE WHEN method = 'VNPAY' THEN amount ELSE 0 END) AS vnpay,
          SUM(
            CASE WHEN method IN ('CASH', 'BANK_TRANSFER') THEN amount ELSE 0 END
          ) AS manual
        FROM payments
        WHERE status = 'SUCCESS'
          AND paid_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+07:00', '+00:00')
          AND paid_at < CONVERT_TZ(
            DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY),
            '+07:00',
            '+00:00'
          )
      `,
      [fromDate, toDate],
    );
    const vnpay = this.toNumber(rows[0]?.vnpay);
    const manual = this.toNumber(rows[0]?.manual);

    return { vnpay, manual, total: vnpay + manual };
  }

  private async getTotalRefunded(
    fromDate: string,
    toDate: string,
  ): Promise<number> {
    const rows = await this.dataSource.query<CountRow[]>(
      `
        SELECT SUM(amount) AS count
        FROM payments
        WHERE status = 'REFUNDED'
          AND refunded_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+07:00', '+00:00')
          AND refunded_at < CONVERT_TZ(
            DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY),
            '+07:00',
            '+00:00'
          )
      `,
      [fromDate, toDate],
    );

    return this.toNumber(rows[0]?.count);
  }

  private async getPaymentMetrics(
    fromDate: string,
    toDate: string,
  ): Promise<PaymentMetrics> {
    const rows = await this.dataSource.query<PaymentMetricsRow[]>(
      `
        SELECT
          SUM(status = 'REQUIRES_REVIEW') AS requiresReview,
          SUM(status = 'REFUND_PENDING') AS refundPending
        FROM payments
        WHERE created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+07:00', '+00:00')
          AND created_at < CONVERT_TZ(
            DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY),
            '+07:00',
            '+00:00'
          )
      `,
      [fromDate, toDate],
    );

    return {
      requiresReview: this.toNumber(rows[0]?.requiresReview),
      refundPending: this.toNumber(rows[0]?.refundPending),
    };
  }

  private async getOccupancyMetrics(
    fromDate: string,
    toDate: string,
    inclusiveDays: number,
  ): Promise<OccupancyMetrics> {
    const rows = await this.dataSource.query<OccupancyRow[]>(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM room_calendar rc
            INNER JOIN bookings b ON b.id = rc.booking_id
            WHERE rc.status = 'RESERVED'
              AND b.status <> 'CANCELLED'
              AND rc.stay_date BETWEEN ? AND ?
          ) AS reserved,
          (
            SELECT COUNT(*)
            FROM room_calendar rc
            INNER JOIN rooms r ON r.id = rc.room_id
            WHERE rc.status = 'BLOCKED'
              AND r.deleted_at IS NULL
              AND r.status <> 'HIDDEN'
              AND rc.stay_date BETWEEN ? AND ?
          ) AS blocked,
          (
            SELECT COUNT(*)
            FROM rooms
            WHERE deleted_at IS NULL
              AND status <> 'HIDDEN'
          ) AS operationalRooms
      `,
      [fromDate, toDate, fromDate, toDate],
    );
    const reserved = this.toNumber(rows[0]?.reserved);
    const blocked = this.toNumber(rows[0]?.blocked);
    const operationalRooms = this.toNumber(rows[0]?.operationalRooms);
    const available = Math.max(0, operationalRooms * inclusiveDays - blocked);

    return {
      roomNightsReserved: reserved,
      roomNightsAvailable: available,
      occupancyRate:
        available === 0
          ? 0
          : Math.min(100, Math.round((reserved / available) * 10_000) / 100),
    };
  }

  private toNumber(value: string | number | null | undefined): number {
    const parsed = Number(value ?? 0);

    return Number.isFinite(parsed) ? parsed : 0;
  }
}
