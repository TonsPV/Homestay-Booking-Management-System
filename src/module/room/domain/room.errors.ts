export class RoomHiddenStatusPermissionError extends Error {
  constructor() {
    super('Chi admin duoc thay doi trang thai HIDDEN.');
    this.name = RoomHiddenStatusPermissionError.name;
  }
}

export class CheckedInRoomMustRemainOccupiedError extends Error {
  constructor() {
    super('Phong co booking dang CHECKED_IN va phai giu trang thai OCCUPIED.');
    this.name = CheckedInRoomMustRemainOccupiedError.name;
  }
}

export class RoomOccupancyRequiresCheckedInBookingError extends Error {
  constructor() {
    super(
      'Chi duoc chuyen phong sang OCCUPIED khi co booking dang CHECKED_IN.',
    );
    this.name = RoomOccupancyRequiresCheckedInBookingError.name;
  }
}
