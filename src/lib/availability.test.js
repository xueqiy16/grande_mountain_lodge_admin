import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKING_BOOKING_STATUSES,
  datesOverlap,
  isBlockingBookingStatus,
  bookingBlocksRoom,
  roomHasOverlap,
  pickAssignableRoom,
  isOperationallyAssignable
} from './availability.js';

const today = '2026-08-21';
const rooms = [
  { room_id: 'a', room_number: '101', room_type_id: 't1', status: 'available' },
  { room_id: 'b', room_number: '102', room_type_id: 't1', status: 'available' },
  { room_id: 'c', room_number: '103', room_type_id: 't1', status: 'out-of-service' },
  { room_id: 'd', room_number: '104', room_type_id: 't1', status: 'occupied' },
  { room_id: 'e', room_number: '105', room_type_id: 't1', status: 'house-keeping' },
  { room_id: 'f', room_number: '201', room_type_id: 't2', status: 'available' }
];

const stay = (status, roomId = 'a', checkIn = '2026-09-10', checkOut = '2026-09-12', bookingId = 'x') => ({
  booking_id: bookingId,
  room_id: roomId,
  check_in: checkIn,
  check_out: checkOut,
  booking_status: status
});

describe('blocking booking statuses', () => {
  it('defines pending_payment, confirmed, and checked_in as blocking', () => {
    assert.deepEqual(BLOCKING_BOOKING_STATUSES, ['pending_payment', 'confirmed', 'checked_in']);
    assert.equal(isBlockingBookingStatus('pending_payment'), true);
    assert.equal(isBlockingBookingStatus('confirmed'), true);
    assert.equal(isBlockingBookingStatus('checked_in'), true);
  });

  it('does not treat cancelled, no_show, or checked_out as blocking', () => {
    assert.equal(isBlockingBookingStatus('cancelled'), false);
    assert.equal(isBlockingBookingStatus('no_show'), false);
    assert.equal(isBlockingBookingStatus('checked_out'), false);
  });
});

describe('pending_payment inventory blocker', () => {
  it('blocks an overlapping room', () => {
    const existing = [stay('pending_payment')];
    assert.equal(
      bookingBlocksRoom(existing[0], '2026-09-10', '2026-09-12'),
      true
    );
    assert.equal(
      roomHasOverlap('a', existing, '2026-09-10', '2026-09-12'),
      true
    );
    assert.equal(
      pickAssignableRoom({
        rooms, roomTypeId: 't1', checkIn: '2026-09-10', checkOut: '2026-09-12',
        bookings: existing, today
      })?.room_id,
      'b'
    );
  });

  it('confirmed blocks', () => {
    assert.equal(bookingBlocksRoom(stay('confirmed'), '2026-09-10', '2026-09-12'), true);
  });

  it('checked_in blocks', () => {
    assert.equal(bookingBlocksRoom(stay('checked_in'), '2026-09-10', '2026-09-12'), true);
  });

  it('cancelled does not block', () => {
    assert.equal(bookingBlocksRoom(stay('cancelled'), '2026-09-10', '2026-09-12'), false);
    assert.equal(
      pickAssignableRoom({
        rooms, roomTypeId: 't1', checkIn: '2026-09-10', checkOut: '2026-09-12',
        bookings: [stay('cancelled')], today
      })?.room_id,
      'a'
    );
  });

  it('no_show does not block', () => {
    assert.equal(bookingBlocksRoom(stay('no_show'), '2026-09-10', '2026-09-12'), false);
  });

  it('checked_out does not block', () => {
    assert.equal(bookingBlocksRoom(stay('checked_out'), '2026-09-10', '2026-09-12'), false);
  });

  it('non-overlapping pending_payment does not block', () => {
    const existing = [stay('pending_payment', 'a', '2026-09-10', '2026-09-12')];
    assert.equal(datesOverlap('2026-09-10', '2026-09-12', '2026-09-12', '2026-09-14'), false);
    assert.equal(roomHasOverlap('a', existing, '2026-09-12', '2026-09-14'), false);
    assert.equal(
      pickAssignableRoom({
        rooms, roomTypeId: 't1', checkIn: '2026-09-12', checkOut: '2026-09-14',
        bookings: existing, today
      })?.room_id,
      'a'
    );
  });

  it('still picks another room of the same type when one is held by pending_payment', () => {
    const existing = [stay('pending_payment', 'a')];
    const picked = pickAssignableRoom({
      rooms, roomTypeId: 't1', checkIn: '2026-09-10', checkOut: '2026-09-12',
      bookings: existing, today
    });
    assert.equal(picked?.room_id, 'b');
    assert.equal(picked?.room_type_id, 't1');
  });

  it('does not steal a room from another type when the requested type is fully blocked', () => {
    const existing = [
      stay('pending_payment', 'a', '2026-09-10', '2026-09-12', 'p1'),
      stay('confirmed', 'b', '2026-09-10', '2026-09-12', 'p2'),
      stay('checked_in', 'd', '2026-09-10', '2026-09-12', 'p3'),
      stay('pending_payment', 'e', '2026-09-10', '2026-09-12', 'p4')
    ];
    const picked = pickAssignableRoom({
      rooms, roomTypeId: 't1', checkIn: '2026-09-10', checkOut: '2026-09-12',
      bookings: existing, today
    });
    assert.equal(picked, null);
    const otherType = pickAssignableRoom({
      rooms, roomTypeId: 't2', checkIn: '2026-09-10', checkOut: '2026-09-12',
      bookings: existing, today
    });
    assert.equal(otherType?.room_id, 'f');
  });
});

describe('operational status remains independent of pending_payment', () => {
  it('does not treat pending_payment as an operational rooms.status', () => {
    assert.equal(isOperationallyAssignable({ status: 'pending_payment' }, '2026-09-10', today), false);
    assert.equal(isOperationallyAssignable({ status: 'available' }, '2026-09-10', today), true);
  });
});
