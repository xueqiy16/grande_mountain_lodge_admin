// Exact `staff_member` enum values from the database. The <option> value strings
// must match these verbatim (including spaces, casing, and hyphens).
export const STAFF_MEMBERS = [
  'Roxanne Gueutal',
  'Sydney Fulop-Gueutal',
  'Jadeyn JF Fulop-Gueutal',
  'Wynonna Wanyandie',
  'Lauren Blair',
  'Carmi Punzalan',
  'Nicholas Aki-Akpotha'
];

// Selectable `transaction_type` values. 'void' is intentionally excluded — voiding is
// now a soft-delete via transactions.status = 'voided', not a transaction_type.
// (payment_method = how they paid; transaction_type = what financial operation occurred.)
export const TRANSACTION_TYPES = [
  'pre_auth',
  'completion',
  'purchase',
  'refund',
  'pre_auth_release'
];

// Canonical room-type presets keyed by the exact `room_types.name`. Each entry
// carries the read-only room code shown at booking time and the standard nightly
// rate used to pre-fill the editable Room Price field (staff can override it).
export const ROOM_TYPE_PRESETS = {
  'Standard Queen Non-Smoking':      { code: 'STD-Q-NS',  price: 84.99 },
  'Studio Queen Non-Smoking':        { code: 'STU-Q-NS',  price: 89.99 },
  'Studio Queen Smoking':            { code: 'STU-Q-SM',  price: 89.99 },
  'Studio Double Queen Non-Smoking': { code: 'STU-QQ-NS', price: 99.99 },
  'Studio Double Queen Smoking':     { code: 'STU-QQ-SM', price: 99.99 },
  'Suite King Non-Smoking':          { code: 'STE-K-NS',  price: 104.99 },
  'Suite Queen Non-Smoking':         { code: 'STE-Q-NS',  price: 104.99 }
};

// Resolve the { code, price } preset for a room_types row. Prefers the canonical
// preset (matched on exact name); falls back to the DB code / nightly_rate so
// any room type not covered above still resolves sensibly.
export const resolveRoomPreset = (roomType) => {
  if (!roomType) return { code: '', price: '' };
  const preset = ROOM_TYPE_PRESETS[roomType.name] || {};
  const code = preset.code || roomType.code || '';
  const price = preset.price != null
    ? preset.price
    : (roomType.nightly_rate != null ? Number(roomType.nightly_rate) : '');
  return { code, price };
};
