import type { PaginationMeta } from '../../common/http';
import type { RoomCalendarStatus } from '../booking/schema/room-calendar.entity';
import type { RoomStatus } from './schema/room.entity';

export enum RoomTodayAvailabilityStatus {
  AVAILABLE = 'AVAILABLE',
  RESERVED = 'RESERVED',
  BLOCKED = 'BLOCKED',
}

export interface RoomImageResponse {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isCover: boolean;
}

export interface RoomResponse {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  name: string;
  description: string | null;
  status: RoomStatus;
  roomType: {
    id: string;
    name: string;
    description: string | null;
    bedType: string | null;
    maxGuests: number;
    basePrice: string;
    amenities: {
      id: string;
      name: string;
      description: string | null;
    }[];
  };
  images: RoomImageResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagementRoomCalendarSummary {
  asOfDate: string;
  todayStatus: RoomTodayAvailabilityStatus;
  nextEvent: {
    stayDate: string;
    status: RoomCalendarStatus;
    reason: string | null;
    booking: {
      id: string;
      bookingCode: string;
      checkInDate: string;
      checkOutDate: string;
    } | null;
  } | null;
}

export interface ManagementRoomResponse extends RoomResponse {
  calendarSummary: ManagementRoomCalendarSummary;
}

export interface PublicRoomResponse {
  id: string;
  roomTypeId: string;
  name: string;
  description: string | null;
  roomType: RoomResponse['roomType'];
  images: RoomImageResponse[];
}

export interface RoomListResult<TItem = RoomResponse> {
  items: TItem[];
  meta: PaginationMeta;
}

export type PublicRoomListResult = RoomListResult<PublicRoomResponse>;
export type ManagementRoomListResult = RoomListResult<ManagementRoomResponse>;
