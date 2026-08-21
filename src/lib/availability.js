// Calendar occupancy for physical rooms. Frontend pre-check only —
// PostgreSQL exclusion constraint (SQLSTATE 23P01) is the final invariant.
//
// Half-open stay [check_in, check_out): adjacent dates do not overlap.

export const BLOCKING_BOOKING_STATUSES = ['confirmed', 'checked_in'];

export const NO_ROOMS_FOR_DATES_MESSAGE =
  'No rooms are available for the selected dates.';

export const ROOM_NOT_AVAILABLE_FOR_DATES_MESSAGE =
  'This room is not available for the selected dates.';

export const EXCLUSION_CONFLICT_MESSAGE =
  'This room was just booked for overlapping dates. Please try another room.';

export const ROOM_NOT_READY_FOR_CHECKIN_MESSAGE =
  'This room is not ready for check-in. Please select another room.';

export const toISODate = (value) => {
  if (!value) return '';
  return String(value).slice(0, 10);
};

export const localTodayISO = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const isValidStayRange = (checkIn, checkOut) => {
  const cin = toISODate(checkIn);
  const cout = toISODate(checkOut);
  return Boolean(cin && cout && cout > cin);
};

// existing.check_in < requested.check_out && existing.check_out > requested.check_in
export const datesOverlap = (existingCheckIn, existingCheckOut, requestedCheckIn, requestedCheckOut) => {
  const eIn = toISODate(existingCheckIn);
  const eOut = toISODate(existingCheckOut);
  const rIn = toISODate(requestedCheckIn);
  const rOut = toISODate(requestedCheckOut);
  if (!eIn || !eOut || !rIn || !rOut) return false;
  return eIn < rOut && eOut > rIn;
};

export const isBlockingBookingStatus = (status) =>
  status === 'confirmed' || status === 'checked_in';

export const bookingBlocksRoom = (booking, requestedCheckIn, requestedCheckOut, excludeBookingId) => {
  if (!booking) return false;
  if (excludeBookingId != null && String(booking.booking_id) === String(excludeBookingId)) {
    return false;
  }
  if (!isBlockingBookingStatus(booking.booking_status)) return false;
  return datesOverlap(
    booking.check_in,
    booking.check_out,
    requestedCheckIn,
    requestedCheckOut
  );
};

export const roomHasOverlap = (
  roomId,
  bookings,
  requestedCheckIn,
  requestedCheckOut,
  excludeBookingId
) => bookings.some(
  (b) => String(b.room_id) === String(roomId)
    && bookingBlocksRoom(b, requestedCheckIn, requestedCheckOut, excludeBookingId)
);

export const normalizeRoomStatus = (status) =>
  (status ?? '').toString().toLowerCase().trim();

// Operational rooms.status is independent of future calendar occupancy.
// Fail closed on unknown/null status. Occupied and house-keeping may be used
// only for a strictly future check-in (calendar overlap is checked separately).
export const isOperationallyAssignable = (room, checkIn, today) => {
  const status = normalizeRoomStatus(room?.status);
  const requested = toISODate(checkIn);
  const todayISO = toISODate(today);

  if (!requested || !todayISO) return false;

  if (status === 'available') return true;

  if (
    status === 'occupied'
    || status === 'house-keeping'
    || status === 'housekeeping'
  ) {
    return requested > todayISO;
  }

  if (status === 'out-of-service') return false;

  return false;
};

const byRoomNumber = (a, b) =>
  String(a.room_number ?? '').localeCompare(String(b.room_number ?? ''), undefined, { numeric: true });

export const pickAssignableRoom = ({
  rooms = [],
  roomTypeId,
  checkIn,
  checkOut,
  bookings = [],
  today,
  excludeBookingId
}) => {
  const typeId = String(roomTypeId ?? '').trim();
  if (!typeId || !isValidStayRange(checkIn, checkOut)) return null;

  const candidates = rooms
    .filter((r) => String(r.room_type_id).trim() === typeId)
    .filter((r) => isOperationallyAssignable(r, checkIn, today))
    .filter((r) => !roomHasOverlap(r.room_id, bookings, checkIn, checkOut, excludeBookingId))
    .sort(byRoomNumber);

  return candidates[0] || null;
};

export const isExclusionConflict = (error) => {
  if (!error) return false;
  const code = String(error.code || error.sqlState || error.sqlstate || '');
  if (code === '23P01') return true;
  const blob = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return blob.includes('23P01') || /exclusion[_ ]constraint/i.test(blob);
};

export const bookingErrorMessage = (error, fallback = 'Booking Error') => {
  if (isExclusionConflict(error)) return EXCLUSION_CONFLICT_MESSAGE;
  return error?.message ? `${fallback}: ${error.message}` : fallback;
};

export const fetchBlockingBookings = async (client, checkIn, checkOut) => {
  const cin = toISODate(checkIn);
  const cout = toISODate(checkOut);
  return client
    .from('bookings')
    .select('booking_id, room_id, check_in, check_out, booking_status')
    .in('booking_status', BLOCKING_BOOKING_STATUSES)
    .lt('check_in', cout)
    .gt('check_out', cin);
};
