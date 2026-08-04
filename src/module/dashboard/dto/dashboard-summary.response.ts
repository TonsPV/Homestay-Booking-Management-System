import { ApiProperty } from '@nestjs/swagger';

export class BookingStatusCount {
  @ApiProperty({ minimum: 0 })
  pendingPayment!: number;

  @ApiProperty({ minimum: 0 })
  confirmed!: number;

  @ApiProperty({ minimum: 0 })
  checkedIn!: number;

  @ApiProperty({ minimum: 0 })
  checkedOut!: number;

  @ApiProperty({ minimum: 0 })
  cancelled!: number;
}

export class RoomStatusCount {
  @ApiProperty({ minimum: 0 })
  ready!: number;

  @ApiProperty({ minimum: 0 })
  occupied!: number;

  @ApiProperty({ minimum: 0 })
  cleaning!: number;

  @ApiProperty({ minimum: 0 })
  maintenance!: number;
}

export class RevenueByMethod {
  @ApiProperty({ description: 'Collected VNPay amount in VND.', minimum: 0 })
  vnpay!: number;

  @ApiProperty({
    description: 'Collected CASH and BANK_TRANSFER amount in VND.',
    minimum: 0,
  })
  manual!: number;

  @ApiProperty({ description: 'Gross collected amount in VND.', minimum: 0 })
  total!: number;
}

export class PaymentMetrics {
  @ApiProperty({ minimum: 0 })
  requiresReview!: number;

  @ApiProperty({ minimum: 0 })
  refundPending!: number;
}

export class OccupancyMetrics {
  @ApiProperty({ minimum: 0 })
  roomNightsReserved!: number;

  @ApiProperty({
    description:
      'Operational room-night capacity after blocked nights are excluded.',
    minimum: 0,
  })
  roomNightsAvailable!: number;

  @ApiProperty({ description: 'Percentage from 0 to 100.', maximum: 100 })
  occupancyRate!: number;
}

export class DashboardSummaryResponse {
  @ApiProperty({ format: 'date' })
  fromDate!: string;

  @ApiProperty({ format: 'date' })
  toDate!: string;

  @ApiProperty({ type: BookingStatusCount })
  bookings!: BookingStatusCount;

  @ApiProperty({ type: RoomStatusCount })
  rooms!: RoomStatusCount;

  @ApiProperty({ type: RevenueByMethod })
  revenue!: RevenueByMethod;

  @ApiProperty({
    description: 'Amount with completed REFUNDED status in VND.',
    minimum: 0,
  })
  totalRefunded!: number;

  @ApiProperty({ type: PaymentMetrics })
  payments!: PaymentMetrics;

  @ApiProperty({ type: OccupancyMetrics })
  occupancy!: OccupancyMetrics;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
}
