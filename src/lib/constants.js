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
