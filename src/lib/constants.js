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

// Exact `transaction_type` enum values. Both the saved value and the UI label are
// the raw lowercase enum string (payment_method = how they paid; transaction_type
// = what financial operation occurred — kept as separate concepts).
export const TRANSACTION_TYPES = [
  'pre_auth',
  'completion',
  'purchase',
  'refund',
  'pre_auth_release',
  'void'
];
