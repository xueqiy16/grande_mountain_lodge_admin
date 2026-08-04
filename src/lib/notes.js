// Shared helpers for building an append-only, staff-attributed note log used by
// bookings.booking_notes and transactions.transaction_notes.

const NOTE_DIVIDER = '----------------------------------';

// Human-readable timestamp, e.g. "Aug 4, 2026, 10:59 AM".
const formatNoteDate = (date = new Date()) =>
  date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

// Build the header tag that prefixes each note entry.
// kind: 'Booking' (new walk-in/reservation) or 'Check-In' (check-in / folio addition).
// Falls back gracefully when no staff member was selected.
export const buildNoteHeader = (kind, staffName) => {
  const date = formatNoteDate();
  const name = (staffName || '').trim();
  if (!name) return `[${date} - Staff: Unspecified]`;
  return `[${date} - ${kind} - Staff: ${name}]`;
};

// Append a new note entry to an existing log without overwriting history.
// Returns the combined string, or the existing value unchanged when no new note.
export const appendNote = (existingNotes, headerTag, newNote) => {
  const note = (newNote || '').trim();
  const existing = (existingNotes || '').trim();
  if (!note) return existing || null;
  const entry = `${headerTag}: ${note}`;
  if (!existing) return entry;
  return `${existing}\n\n${NOTE_DIVIDER}\n${entry}`;
};
