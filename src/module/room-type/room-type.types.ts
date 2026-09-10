import type { PaginationMeta } from '../../common/pagination/pagination.types';
import type { BedConfig } from './bed-configuration';

export interface RoomTypeAmenityResponse {
  id: string;
  name: string;
  description: string | null;
}

export interface RoomTypeResponse {
  id: string;
  name: string;
  description: string | null;
  bedType: string | null;
  beds: BedConfig[];
  maxGuests: number;
  basePrice: string;
  amenities: RoomTypeAmenityResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminRoomTypeResponse extends RoomTypeResponse {
  deletedAt: Date | null;
}

export interface RoomTypeListResult<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}
