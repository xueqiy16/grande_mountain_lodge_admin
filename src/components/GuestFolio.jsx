import React, { useState, useEffect, useMemo } from 'react';
import PaymentModal from '../PaymentModal';
import ConfirmDialog from './ConfirmDialog';
import { STAFF_MEMBERS } from '../lib/constants';
import { calculateAmountPaid } from '../lib/payments';

// Status filter tabs (Checked In default). "all" shows every booking.
const STATUS_TABS = [
  { key: 'checked_in', label: 'Checked In' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'checked_out', label: 'Checked Out' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'no_show', label: 'No Show' },
  { key: 'all', label: 'All' }
];

const BOOKING_STATUS_OPTIONS = ['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

// folio_entries enums (exact DB values).
const ENTRY_TYPES = ['room_charge', 'tax', 'damage', 'fee', 'discount', 'extra_night', 'tip', 'other'];
// Manual charge types staff can pick in the Add Charge modal. Excludes 'room_charge'
// (auto base stay entry) and 'tax' (auto-calculated). 'room_charge'/'tax' remain valid
// folio_entry_type enum values in the DB — they're just hidden from this picker.
const CHARGE_TYPE_OPTIONS = ['damage', 'extra_night', 'fee', 'tip', 'discount', 'other'];
// Everything except discount is a positive charge (debit); discount is a credit.
const isDebitEntry = (type) => type !== 'discount';

// A transaction is voided via status = 'voided' (legacy rows may use type 'void').
const isVoidedTxn = (t) => t?.status === 'voided' || t?.transaction_type === 'void';
// Extra charges layered on top of the base room charge (excludes room_charge, tax, discount).
const ADDITIONAL_CHARGE_TYPES = ['fee', 'damage', 'extra_night', 'tip', 'other'];
const sumEntries = (entries, predicate) =>
  entries.filter(predicate).reduce((a, e) => a + Number(e.amount || 0), 0);

// Auto-calculated taxes computed STRICTLY on the base room charge (nightly_rate × nights).
// Alberta Tourism Levy is exempt for stays >= 28 nights.
const GST_RATE = 0.05;
const TOURISM_LEVY_RATE = 0.06;
const LEVY_EXEMPT_NIGHTS = 28;
const computeTaxes = (baseRoomCharge, nights) => {
  const gst = Number(baseRoomCharge) * GST_RATE;
  const tourismLevy = nights >= LEVY_EXEMPT_NIGHTS ? 0 : Number(baseRoomCharge) * TOURISM_LEVY_RATE;
  return { gst, tourismLevy };
};

// Whole nights between two YYYY-MM-DD dates (0 if invalid/negative).
const nightsBetween = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;
  const s = new Date(checkIn + 'T00:00:00');
  const e = new Date(checkOut + 'T00:00:00');
  const n = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return n > 0 ? n : 0;
};

const formatEntryDate = (d) => {
  if (!d) return 'N/A';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const todayISODate = () => new Date().toISOString().split('T')[0];

// Total Stay Amount = base room charge + additional charges + GST + Tourism Levy − discounts.
// GST/Levy are auto-calculated on the base room charge only (not on extra charges/discounts).
const computeTotalPrice = (baseCharge, entries, nights) => {
  const additional = sumEntries(entries, e => ADDITIONAL_CHARGE_TYPES.includes(e.entry_type));
  const discounts = sumEntries(entries, e => e.entry_type === 'discount');
  const { gst, tourismLevy } = computeTaxes(Number(baseCharge), nights);
  return Number(baseCharge) + additional + gst + tourismLevy - discounts;
};

const formatBookingStatus = (status) => {
  const labels = {
    confirmed: 'Confirmed',
    checked_in: 'Checked In',
    checked_out: 'Checked Out',
    cancelled: 'Cancelled',
    no_show: 'No Show'
  };
  return labels[status] || status || 'N/A';
};

// Stay total = nights * nightly rate.
const calculateTotalBalance = (b) => {
  if (!b || !b.check_in || !b.check_out || !b.rooms?.room_types?.nightly_rate) return 0;
  const start = new Date(b.check_in + 'T00:00:00');
  const end = new Date(b.check_out + 'T00:00:00');
  const nights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  return Number(nights) * Number(b.rooms.room_types.nightly_rate);
};

const calculateOutstandingBalance = (b) => {
  if (!b) return 0;
  // Prefer the stored total_price (kept current by folio/date recalcs); fall back to
  // the derived base room charge for legacy rows without a persisted total.
  const total = b?.total_price != null ? Number(b.total_price) : Number(calculateTotalBalance(b));
  // Settled payments only — pre-authorizations never reduce the outstanding balance.
  const paid = calculateAmountPaid(b?.transactions || []);
  return total - paid;
};

// Green highlight when a draft value diverges from the original (edit feedback).
const editedClass = (draftVal, originalVal) =>
  String(draftVal ?? '') !== String(originalVal ?? '') ? 'input-edited' : '';

const GuestFolio = ({
  bookings = [],
  guests = [],
  rooms = [],
  transactions = [],
  staffList = [],
  refreshData,
  supabase,
  openBookingId = null,
  onDetailClose
}) => {
  const staff = staffList && staffList.length ? staffList : STAFF_MEMBERS;

  const [activeTab, setActiveTab] = useState('checked_in');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [guestDraft, setGuestDraft] = useState({});
  const [bookingDraft, setBookingDraft] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  // Deferred close action awaiting confirmation (null when no prompt is open).
  const [pendingClose, setPendingClose] = useState(null);

  // "New Transaction" modal
  const [payBooking, setPayBooking] = useState(null);
  const [payTxns, setPayTxns] = useState([]);

  // "Edit Transaction" sub-modal
  const [txnDetail, setTxnDetail] = useState(null);
  const [txnDraft, setTxnDraft] = useState({});
  const [savingTxn, setSavingTxn] = useState(false);
  // Transaction pending void confirmation (null when no prompt is open).
  const [voidTarget, setVoidTarget] = useState(null);

  // folio_entries ledger + "+ Add Charge" modal
  const [folioEntries, setFolioEntries] = useState([]);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [savingCharge, setSavingCharge] = useState(false);
  // Edit mode: folio_entry_id being edited (null = add). chargeOriginal drives the
  // green "modified field" highlight by comparing against the pre-populated values.
  const [editingChargeId, setEditingChargeId] = useState(null);
  const [chargeOriginal, setChargeOriginal] = useState(null);
  const blankCharge = {
    entry_type: CHARGE_TYPE_OPTIONS[0],
    amount: '',
    description: '',
    staff_member: '',
    notes: '',
    entry_date: todayISODate()
  };
  const [chargeForm, setChargeForm] = useState(blankCharge);

  // Lock backdrop scroll while the Add Charge modal is open.
  useEffect(() => {
    document.body.style.overflow = addChargeOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [addChargeOpen]);

  // Resolve nested/looked-up relations defensively.
  const resolveGuest = (b) => b?.guests || guests.find(g => g?.guest_id === b?.guest_id) || {};
  const resolveRoom = (b) => b?.rooms || rooms.find(r => r?.room_id === b?.room_id) || {};

  const detailBooking = useMemo(
    () => bookings.find(b => b?.booking_id === detailId) || null,
    [bookings, detailId]
  );

  // Allow a parent tab (e.g. dashboard "View Guest Folio") to open a specific folio.
  useEffect(() => {
    if (openBookingId) setDetailId(openBookingId);
  }, [openBookingId]);

  const closeDetail = () => {
    setDetailId(null);
    setIsEditing(false);
    onDetailClose?.();
  };

  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cleanQueryPhone = q.replace(/\D/g, '');
    return bookings.filter(b => {
      if (activeTab !== 'all' && b?.booking_status !== activeTab) return false;
      if (!q) return true;
      const g = resolveGuest(b);
      const r = resolveRoom(b);

      const firstName = (g?.first_name || '').trim().toLowerCase();
      const lastName = (g?.last_name || '').trim().toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = (g?.email || '').trim().toLowerCase();
      const phone = (g?.phone || '').replace(/\D/g, ''); // digits only for clean phone checks
      const roomNumber = String(r?.room_number ?? '').trim().toLowerCase();
      const roomCode = (r?.code || r?.room_types?.code || '').trim().toLowerCase();
      const checkIn = (b?.check_in || '').trim().toLowerCase();
      const checkOut = (b?.check_out || '').trim().toLowerCase();

      // Date-range matching: when q is a full YYYY-MM-DD, the booking also matches
      // if that date falls within the stay window [check_in, check_out]. YYYY-MM-DD
      // strings compare correctly lexicographically. Partial dates keep prefix rules.
      const ciDate = checkIn.slice(0, 10);
      const coDate = checkOut.slice(0, 10);
      const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(q);
      const dateInRange = isFullDate && ciDate && coDate && q >= ciDate && q <= coDate;

      // Strict prefix matching only — no mid-string (includes) matches anywhere.
      return (
        firstName.startsWith(q) ||
        lastName.startsWith(q) ||
        fullName.startsWith(q) ||
        email.startsWith(q) ||
        (cleanQueryPhone.length > 0 && phone.startsWith(cleanQueryPhone)) ||
        roomNumber.startsWith(q) ||
        roomCode.startsWith(q) ||
        checkIn.startsWith(q) ||
        checkOut.startsWith(q) ||
        dateInRange
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, activeTab, search, guests, rooms]);

  const receivables = bookings.reduce((acc, b) => acc + Number(calculateOutstandingBalance(b)), 0);

  // Prefer transactions embedded on the booking; fall back to the flat prop list.
  const bookingTxns = useMemo(() => {
    if (!detailBooking) return [];
    if (Array.isArray(detailBooking.transactions) && detailBooking.transactions.length) {
      return detailBooking.transactions;
    }
    return transactions.filter(t => t?.booking_id === detailBooking.booking_id);
  }, [transactions, detailBooking]);

  const fetchFolioEntries = async (bookingId) => {
    if (!bookingId) { setFolioEntries([]); return; }
    const { data, error } = await supabase
      .from('folio_entries')
      .select('*')
      .eq('booking_id', bookingId)
      .order('entry_date', { ascending: true });
    if (error) {
      console.error('FOLIO ENTRIES FETCH ERROR:', error);
      setFolioEntries([]);
    } else {
      setFolioEntries(data || []);
    }
  };

  // Load folio entries whenever the open booking changes.
  useEffect(() => {
    fetchFolioEntries(detailId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  // Live pricing. In edit mode the base charge tracks the draft dates so the
  // read-only Total Nights / Total Price reflect the pending change immediately.
  // Resolve nightly_rate strictly through the room relationship: rooms -> room_types.
  const roomType = resolveRoom(detailBooking).room_types || {};
  const nightlyRate = Number(roomType.nightly_rate || 0);
  const effCheckIn = isEditing ? bookingDraft.check_in : detailBooking?.check_in;
  const effCheckOut = isEditing ? bookingDraft.check_out : detailBooking?.check_out;
  // Nights basis: stored booking.total_nights in view mode; live date math while editing.
  const liveNights = isEditing
    ? nightsBetween(effCheckIn, effCheckOut)
    : (Number(detailBooking?.total_nights) || nightsBetween(effCheckIn, effCheckOut));
  // baseRoomCharge = (roomType.nightly_rate || 0) * total_nights. Taxes apply to this only.
  const baseRoomCharge = nightlyRate * liveNights;
  const additionalCharges = sumEntries(folioEntries, e => ADDITIONAL_CHARGE_TYPES.includes(e.entry_type));
  const sumDiscounts = sumEntries(folioEntries, e => e.entry_type === 'discount');
  const { gst: gstAmount, tourismLevy: tourismLevyAmount } = computeTaxes(baseRoomCharge, liveNights);
  const levyExempt = liveNights >= LEVY_EXEMPT_NIGHTS;
  const liveTotalPrice = baseRoomCharge + additionalCharges + gstAmount + tourismLevyAmount - sumDiscounts;
  // Total Payments Paid excludes voided transactions (sum of live, non-voided rows).
  const transactionsPaid = calculateAmountPaid(bookingTxns);
  const liveOutstanding = liveTotalPrice - transactionsPaid;

  const startEdit = () => {
    if (!detailBooking) return;
    const g = resolveGuest(detailBooking);
    setGuestDraft({
      first_name: g.first_name || '',
      last_name: g.last_name || '',
      email: g.email || '',
      phone: g.phone || '',
      address: g.address || '',
      city: g.city || '',
      country: g.country || ''
    });
    setBookingDraft({
      check_in: detailBooking.check_in || '',
      check_out: detailBooking.check_out || '',
      adults: detailBooking.adults ?? 0,
      children: detailBooking.children ?? 0,
      pets: detailBooking.pets ?? 0,
      booking_status: detailBooking.booking_status || '',
      booking_notes: detailBooking.booking_notes || ''
    });
    setIsEditing(true);
  };

  const saveEdits = async () => {
    if (!detailBooking) return;
    setIsSaving(true);
    try {
      const guestId = detailBooking.guest_id || resolveGuest(detailBooking).guest_id;
      if (guestId) {
        const { error: gErr } = await supabase
          .from('guests')
          .update({
            first_name: guestDraft.first_name || null,
            last_name: guestDraft.last_name || null,
            email: guestDraft.email || null,
            phone: guestDraft.phone || null,
            address: guestDraft.address || null,
            city: guestDraft.city || null,
            country: guestDraft.country || null
          })
          .eq('guest_id', guestId);
        if (gErr) throw gErr;
      }

      // Date-driven recalculation: nights = (check_out - check_in), base room
      // charge = nightly_rate * nights, and total_price = base + folio debits - discounts.
      const newNights = Math.max(1, nightsBetween(bookingDraft.check_in, bookingDraft.check_out));
      const newBaseCharge = newNights * nightlyRate;
      const newTotalPrice = Number(computeTotalPrice(newBaseCharge, folioEntries, newNights).toFixed(2));

      const { error: bErr } = await supabase
        .from('bookings')
        .update({
          check_in: bookingDraft.check_in || null,
          check_out: bookingDraft.check_out || null,
          adults: parseInt(bookingDraft.adults, 10) || 0,
          children: parseInt(bookingDraft.children, 10) || 0,
          pets: parseInt(bookingDraft.pets, 10) || 0,
          booking_status: bookingDraft.booking_status || null,
          // Direct overwrite: exact textarea string, no append/concatenation.
          booking_notes: bookingDraft.booking_notes,
          total_nights: newNights,
          total_price: newTotalPrice
        })
        .eq('booking_id', detailBooking.booking_id);
      if (bErr) throw bErr;

      await refreshData?.();
      setIsEditing(false);
    } catch (e) {
      alert('Save failed: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const openPayment = async (b) => {
    setPayBooking(b);
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('booking_id', b.booking_id)
      .order('charged_at', { ascending: true });
    setPayTxns(!error && data ? data : []);
  };

  const openTxn = (t) => {
    setTxnDetail(t);
    setTxnDraft({
      staff_member: t.staff_member || '',
      transaction_notes: t.transaction_notes || '',
      auth_code: t.auth_code || '',
      reference_number: t.reference_number || '',
      cardholder_name: t.cardholder_name || '',
      last4: t.last4 || '',
      expiry_month: t.expiry_month ?? '',
      expiry_year: t.expiry_year ?? '',
      e_transfer_reference: t.e_transfer_reference || ''
    });
  };

  const saveTxn = async () => {
    if (!txnDetail) return;
    setSavingTxn(true);
    try {
      // Amount / payment_method / transaction_type are locked to protect the ledger.
      // Only metadata fields are writable here.
      const { error } = await supabase
        .from('transactions')
        .update({
          staff_member: txnDraft.staff_member || null,
          // Direct overwrite: exact textarea string, no append/concatenation.
          transaction_notes: txnDraft.transaction_notes,
          auth_code: txnDraft.auth_code || null,
          reference_number: txnDraft.reference_number || null,
          cardholder_name: txnDraft.cardholder_name || null,
          last4: txnDraft.last4 || null,
          expiry_month: txnDraft.expiry_month ? Number(txnDraft.expiry_month) : null,
          expiry_year: txnDraft.expiry_year ? Number(txnDraft.expiry_year) : null,
          e_transfer_reference: txnDraft.e_transfer_reference || null
        })
        .eq('transaction_id', txnDetail.transaction_id);
      if (error) throw error;
      await refreshData?.();
      setTxnDetail(null);
    } catch (e) {
      alert('Transaction update failed: ' + e.message);
    } finally {
      setSavingTxn(false);
    }
  };

  // Soft-delete: void a transaction by flagging status = 'voided' (no ledger row deletion).
  const voidTransaction = async (t) => {
    if (!t) return;
    setSavingTxn(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ status: 'voided' })
        .eq('transaction_id', t.transaction_id);
      if (error) throw error;
      await refreshData?.();
      setTxnDetail(null);
    } catch (e) {
      alert('Void failed: ' + e.message);
    } finally {
      setSavingTxn(false);
    }
  };

  const openAddCharge = () => {
    setEditingChargeId(null);
    setChargeOriginal(null);
    setChargeForm({ ...blankCharge, entry_date: todayISODate() });
    setAddChargeOpen(true);
  };

  const openEditCharge = (entry) => {
    const prefilled = {
      entry_type: entry.entry_type || CHARGE_TYPE_OPTIONS[0],
      amount: String(entry.amount ?? ''),
      description: entry.description || '',
      staff_member: entry.staff_member || '',
      notes: entry.notes || '',
      entry_date: (entry.entry_date || '').slice(0, 10) || todayISODate()
    };
    setEditingChargeId(entry.folio_entry_id);
    setChargeOriginal(prefilled);
    setChargeForm(prefilled);
    setAddChargeOpen(true);
  };

  const saveCharge = async () => {
    if (!detailBooking) return;
    if (!chargeForm.entry_type) { alert('Please select a charge type.'); return; }
    const amount = Number(chargeForm.amount);
    if (!amount || amount <= 0 || isNaN(amount)) { alert('Please enter a valid amount greater than 0.'); return; }

    setSavingCharge(true);
    try {
      const fields = {
        entry_type: chargeForm.entry_type,
        tax_type: null,
        amount,
        description: chargeForm.description.trim() || null,
        staff_member: chargeForm.staff_member || null,
        notes: chargeForm.notes.trim() || null,
        entry_date: chargeForm.entry_date || todayISODate()
      };

      let newEntries;
      if (editingChargeId) {
        // Update the existing row in place.
        const { error } = await supabase
          .from('folio_entries')
          .update(fields)
          .eq('folio_entry_id', editingChargeId);
        if (error) throw error;
        newEntries = folioEntries.map(e =>
          e.folio_entry_id === editingChargeId ? { ...e, ...fields } : e
        );
      } else {
        const { data, error } = await supabase
          .from('folio_entries')
          .insert([{ booking_id: detailBooking.booking_id, ...fields }])
          .select();
        if (error) throw error;
        newEntries = [...folioEntries, ...(data && data.length ? data : [fields])];
      }

      // Recalculate total_price = base + Σ(additional) + GST + Levy − Σ(discounts).
      const newTotalPrice = Number(computeTotalPrice(baseRoomCharge, newEntries, liveNights).toFixed(2));
      const { error: bErr } = await supabase
        .from('bookings')
        .update({ total_price: newTotalPrice })
        .eq('booking_id', detailBooking.booking_id);
      if (bErr) throw bErr;

      await fetchFolioEntries(detailBooking.booking_id);
      await refreshData?.();
      setAddChargeOpen(false);
      setEditingChargeId(null);
      setChargeOriginal(null);
    } catch (e) {
      alert((editingChargeId ? 'Edit charge failed: ' : 'Add charge failed: ') + e.message);
    } finally {
      setSavingCharge(false);
    }
  };

  const origGuest = detailBooking ? resolveGuest(detailBooking) : {};
  const origRoom = detailBooking ? resolveRoom(detailBooking) : {};
  const roomCode = origRoom.code || origRoom.room_types?.code || origRoom.room_number || 'N/A';

  // --- Unsaved-changes guard --------------------------------------------------
  const differs = (a, b) => String(a ?? '') !== String(b ?? '');
  const detailsDirty = isEditing && (
    ['first_name', 'last_name', 'email', 'phone', 'address', 'city', 'country']
      .some(k => differs(guestDraft[k], origGuest?.[k])) ||
    differs(bookingDraft.check_in, detailBooking?.check_in) ||
    differs(bookingDraft.check_out, detailBooking?.check_out) ||
    differs(bookingDraft.adults, detailBooking?.adults) ||
    differs(bookingDraft.children, detailBooking?.children) ||
    differs(bookingDraft.pets, detailBooking?.pets) ||
    differs(bookingDraft.booking_status, detailBooking?.booking_status) ||
    differs(bookingDraft.booking_notes, detailBooking?.booking_notes)
  );
  const chargeBaseline = chargeOriginal || blankCharge;
  const chargeDirty = ['entry_type', 'amount', 'description', 'staff_member', 'notes', 'entry_date']
    .some(k => differs(chargeForm[k], chargeBaseline[k]));
  const txnDirty = !!txnDetail && (
    differs(txnDraft.staff_member, txnDetail.staff_member) ||
    differs(txnDraft.transaction_notes, txnDetail.transaction_notes) ||
    differs(txnDraft.auth_code, txnDetail.auth_code) ||
    differs(txnDraft.reference_number, txnDetail.reference_number) ||
    differs(txnDraft.cardholder_name, txnDetail.cardholder_name) ||
    differs(txnDraft.last4, txnDetail.last4) ||
    differs(txnDraft.expiry_month, txnDetail.expiry_month) ||
    differs(txnDraft.expiry_year, txnDetail.expiry_year) ||
    differs(txnDraft.e_transfer_reference, txnDetail.e_transfer_reference)
  );

  // Run closeFn immediately when clean; otherwise defer behind a confirm dialog.
  const guardedClose = (dirty, closeFn) => {
    if (dirty) setPendingClose(() => closeFn);
    else closeFn();
  };

  // Always resolve the payment booking from live state so the New Transaction
  // modal reflects the latest total_price / amount_paid after folio edits.
  const livePayBooking = payBooking
    ? (bookings.find(b => b?.booking_id === payBooking.booking_id) || payBooking)
    : null;

  return (
    <div className="folio-view">
      <div className="view-header">
        <h2>Guest Folios & Ledger</h2>
        <div className="pms-stats">
          <div className="stat-pill">Receivables: <span style={{ color: '#ef4444' }}>${receivables.toFixed(2)}</span></div>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="folio-tabs">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            className={`folio-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Real-time search */}
      <input
        type="text"
        className="folio-search"
        placeholder="Search by name, phone, email, room, or stay date (YYYY-MM-DD)..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <table className="pms-table folio-table">
        <thead>
          <tr>
            <th style={{ width: '150px' }}>Booking Reference</th>
            <th>Guest Name</th>
            <th style={{ width: '80px' }}>Room</th>
            <th style={{ width: '120px' }}>Status</th>
            <th style={{ width: '110px' }}>Balance</th>
            <th style={{ width: '220px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredBookings.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No bookings match this filter.</td></tr>
          ) : filteredBookings.map(b => {
            const g = resolveGuest(b);
            const r = resolveRoom(b);
            return (
              <tr key={b.booking_id}>
                <td className="folio-number">{b?.booking_reference || b?.booking_id || 'N/A'}</td>
                <td><strong>{g?.first_name || 'N/A'} {g?.last_name || ''}</strong></td>
                <td>{r?.room_number || 'N/A'}</td>
                <td><span className={`status-badge status-${b?.booking_status}`}>{formatBookingStatus(b?.booking_status)}</span></td>
                <td className={`balance-cell ${Number(calculateOutstandingBalance(b)) > 0 ? 'unpaid' : 'paid'}`}>
                  ${Number(calculateOutstandingBalance(b)).toFixed(2)}
                </td>
                <td>
                  <div className="folio-row-actions">
                    <button className="tool-btn sm" onClick={() => setDetailId(b.booking_id)}>Details</button>
                    <button className="tool-btn sm primary" onClick={() => openPayment(b)}>New Transaction</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* DETAILS MODAL */}
      {detailBooking && (
        <div className="folio-modal-overlay">
          <div className="folio-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{origGuest?.first_name || 'N/A'} {origGuest?.last_name || ''}</h3>
                <p className="folio-subheader">
                  Booking Reference: <strong>{detailBooking?.booking_reference || detailBooking?.booking_id || 'N/A'}</strong>
                  {' '}· Room {origRoom?.room_number || 'N/A'}
                </p>
              </div>
              <div className="folio-header-actions">
                <button onClick={() => guardedClose(detailsDirty, closeDetail)} className="close-drawer-btn">✕</button>
                {!isEditing ? (
                  <button className="tool-btn sm" onClick={startEdit}>Edit</button>
                ) : (
                  <button className="tool-btn sm primary" onClick={saveEdits} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
              </div>
            </div>

            <div className="folio-detail-body">
              {/* GUEST DETAILS */}
              <div className="detail-section-title">Guest Details</div>
              <div className="detail-grid">
                <div className="detail-field">
                  <label>First Name</label>
                  <input
                    value={isEditing ? guestDraft.first_name : (origGuest?.first_name || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, first_name: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.first_name, origGuest?.first_name) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Last Name</label>
                  <input
                    value={isEditing ? guestDraft.last_name : (origGuest?.last_name || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, last_name: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.last_name, origGuest?.last_name) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Email</label>
                  <input
                    value={isEditing ? guestDraft.email : (origGuest?.email || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, email: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.email, origGuest?.email) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Phone</label>
                  <input
                    value={isEditing ? guestDraft.phone : (origGuest?.phone || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, phone: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.phone, origGuest?.phone) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Address</label>
                  <input
                    value={isEditing ? guestDraft.address : (origGuest?.address || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, address: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.address, origGuest?.address) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>City</label>
                  <input
                    value={isEditing ? guestDraft.city : (origGuest?.city || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, city: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.city, origGuest?.city) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Country</label>
                  <input
                    value={isEditing ? guestDraft.country : (origGuest?.country || '')}
                    onChange={(e) => setGuestDraft({ ...guestDraft, country: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(guestDraft.country, origGuest?.country) : ''}
                  />
                </div>
              </div>

              {/* ROOM & STAY */}
              <div className="detail-section-title">Room &amp; Stay</div>
              <div className="detail-grid">
                <div className="detail-field">
                  <label>Room Code</label>
                  <input value={roomCode} disabled readOnly />
                </div>
                <div className="detail-field">
                  <label>Check-in</label>
                  <input
                    type="date"
                    value={isEditing ? bookingDraft.check_in : (detailBooking?.check_in || '')}
                    onChange={(e) => setBookingDraft({ ...bookingDraft, check_in: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(bookingDraft.check_in, detailBooking?.check_in) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Check-out</label>
                  <input
                    type="date"
                    value={isEditing ? bookingDraft.check_out : (detailBooking?.check_out || '')}
                    onChange={(e) => setBookingDraft({ ...bookingDraft, check_out: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(bookingDraft.check_out, detailBooking?.check_out) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Total Nights {isEditing ? '(auto)' : ''}</label>
                  <input value={liveNights || detailBooking?.total_nights || 0} disabled readOnly />
                </div>
                <div className="detail-field">
                  <label>Total Price {isEditing ? '(auto)' : ''}</label>
                  <input value={`$${Number(liveTotalPrice).toFixed(2)}`} disabled readOnly />
                </div>
                <div className="detail-field">
                  <label>Booking Status</label>
                  <select
                    value={isEditing ? bookingDraft.booking_status : (detailBooking?.booking_status || '')}
                    onChange={(e) => setBookingDraft({ ...bookingDraft, booking_status: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(bookingDraft.booking_status, detailBooking?.booking_status) : ''}
                  >
                    {BOOKING_STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{formatBookingStatus(s)}</option>
                    ))}
                  </select>
                </div>
                <div className="detail-field">
                  <label>Cardholder Name</label>
                  <input value={detailBooking?.card_holder_name || 'N/A'} disabled readOnly />
                </div>
              </div>

              {/* OCCUPANCY */}
              <div className="detail-section-title">Occupancy</div>
              <div className="detail-grid">
                <div className="detail-field">
                  <label>Adults</label>
                  <input
                    type="number"
                    min="0"
                    value={isEditing ? bookingDraft.adults : (detailBooking?.adults ?? 0)}
                    onChange={(e) => setBookingDraft({ ...bookingDraft, adults: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(bookingDraft.adults, detailBooking?.adults ?? 0) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Children</label>
                  <input
                    type="number"
                    min="0"
                    value={isEditing ? bookingDraft.children : (detailBooking?.children ?? 0)}
                    onChange={(e) => setBookingDraft({ ...bookingDraft, children: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(bookingDraft.children, detailBooking?.children ?? 0) : ''}
                  />
                </div>
                <div className="detail-field">
                  <label>Pets</label>
                  <input
                    type="number"
                    min="0"
                    value={isEditing ? bookingDraft.pets : (detailBooking?.pets ?? 0)}
                    onChange={(e) => setBookingDraft({ ...bookingDraft, pets: e.target.value })}
                    disabled={!isEditing}
                    className={isEditing ? editedClass(bookingDraft.pets, detailBooking?.pets ?? 0) : ''}
                  />
                </div>
              </div>

              {/* NOTES */}
              <div className="detail-section-title">Notes</div>
              {isEditing ? (
                <textarea
                  className={`notes-edit ${editedClass(bookingDraft.booking_notes, detailBooking?.booking_notes)}`}
                  rows={5}
                  value={bookingDraft.booking_notes}
                  onChange={(e) => setBookingDraft({ ...bookingDraft, booking_notes: e.target.value })}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              ) : (
                <div className="notes-log">{detailBooking?.booking_notes || 'None'}</div>
              )}

              {/* FOLIO ENTRIES LEDGER */}
              <div className="ledger-card">
                <div className="ledger-card-head">
                  <div className="detail-section-title" style={{ margin: 0, border: 'none' }}>Ledger</div>
                  <button className="tool-btn sm primary" onClick={openAddCharge}>+ Add Charge</button>
                </div>
                <div className="txn-ledger-scroll">
                  <table className="pms-table txn-ledger-table ledger-compact">
                    <thead>
                      <tr>
                        <th style={{ width: '78px' }}>Date</th>
                        <th style={{ width: '92px' }}>Type</th>
                        <th>Description</th>
                        <th style={{ width: '78px' }}>Amount</th>
                        <th style={{ width: '110px' }}>Staff</th>
                        <th>Notes</th>
                        <th style={{ width: '72px', textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Derived base room charge line (nightly_rate × nights) — system row, no edit. */}
                      <tr>
                        <td>{formatEntryDate(effCheckIn)}</td>
                        <td>room_charge</td>
                        <td>Base Room Charge ({liveNights} night{liveNights === 1 ? '' : 's'} × ${nightlyRate.toFixed(2)})</td>
                        <td>${baseRoomCharge.toFixed(2)}</td>
                        <td>-</td>
                        <td>-</td>
                        <td>-</td>
                      </tr>
                      {/* Tax lines are auto-calculated and shown in the summary, not itemized here. */}
                      {folioEntries.filter(e => e.entry_type !== 'tax').map((e, idx) => {
                        const debit = isDebitEntry(e.entry_type);
                        return (
                          <tr key={e.folio_entry_id || idx}>
                            <td>{formatEntryDate(e.entry_date)}</td>
                            <td>{e.entry_type || 'N/A'}</td>
                            <td>{e.description || '-'}</td>
                            <td style={{ color: debit ? '#0f172a' : '#ef4444' }}>
                              {debit ? '' : '-'}${Number(e.amount || 0).toFixed(2)}
                            </td>
                            <td>{e.staff_member || '-'}</td>
                            <td className="notes-cell">{e.notes || '-'}</td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                type="button"
                                className="tool-btn sm"
                                onClick={() => openEditCharge(e)}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Structured cost breakdown:
                    Base + Additional + GST + Levy − Discounts = Total Stay Amount;
                    Total Stay Amount − Payments = Outstanding Balance. */}
                <div className="ledger-summary">
                  <div className="ledger-summary-row"><span>Base Room Charges</span><span>${baseRoomCharge.toFixed(2)}</span></div>
                  {additionalCharges > 0 && (
                    <div className="ledger-summary-row"><span>Additional Charges &amp; Fees</span><span>${additionalCharges.toFixed(2)}</span></div>
                  )}
                  <div className="ledger-summary-row"><span>GST (5%)</span><span>${gstAmount.toFixed(2)}</span></div>
                  <div className="ledger-summary-row">
                    <span>Alberta Tourism Levy (6%)</span>
                    <span>${(levyExempt ? 0 : tourismLevyAmount).toFixed(2)}</span>
                  </div>
                  {sumDiscounts > 0 && (
                    <div className="ledger-summary-row"><span>Discounts &amp; Credits</span><span className="credit">-${sumDiscounts.toFixed(2)}</span></div>
                  )}
                  <div className="ledger-summary-row subtotal"><span>Total Stay Amount</span><span>${liveTotalPrice.toFixed(2)}</span></div>
                  <div className="ledger-summary-row"><span>Total Payments Paid</span><span className="credit">-${transactionsPaid.toFixed(2)}</span></div>
                  <div className="ledger-summary-row total">
                    <span>Outstanding Balance</span>
                    <span className={liveOutstanding > 0 ? 'debt' : 'clear'}>${liveOutstanding.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* TRANSACTION LEDGER */}
              <div className="detail-section-title">Transactions</div>
              <div className="txn-ledger-scroll">
                <table className="pms-table txn-ledger-table ledger-compact">
                  <thead>
                    <tr>
                      <th style={{ width: '90px' }}>Date</th>
                      <th style={{ width: '80px' }}>Amount</th>
                      <th style={{ width: '110px' }}>Transaction Type</th>
                      <th style={{ width: '110px' }}>Payment Method</th>
                      <th>Staff Member</th>
                      <th style={{ width: '72px', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookingTxns.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>No transactions yet.</td></tr>
                    ) : bookingTxns.map(t => {
                      const voided = isVoidedTxn(t);
                      return (
                        <tr key={t.transaction_id} className={voided ? 'txn-voided-row' : ''}>
                          <td>{formatEntryDate(t?.charged_at)}</td>
                          <td className={voided ? 'txn-amount-voided' : ''}>${Number(t?.amount || 0).toFixed(2)}</td>
                          <td>
                            {t?.transaction_type || 'N/A'}
                            {voided && <span className="voided-badge">VOIDED</span>}
                          </td>
                          <td>{t?.payment_method || 'N/A'}</td>
                          <td>{t?.staff_member || 'Unspecified'}</td>
                          <td style={{ textAlign: 'center' }}>
                            {voided ? (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            ) : (
                              <button type="button" className="tool-btn sm" onClick={() => openTxn(t)}>Edit</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRANSACTION "MORE DETAILS" SUB-MODAL */}
      {txnDetail && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Transaction</h3>
              <button onClick={() => guardedClose(txnDirty, () => setTxnDetail(null))} className="close-drawer-btn">✕</button>
            </div>

            <div className="detail-grid">
              {/* Locked core fields — change via void + new transaction only */}
              <div className="detail-field">
                <label>Amount ($) (locked)</label>
                <input value={`$${Number(txnDetail?.amount || 0).toFixed(2)}`} disabled readOnly />
              </div>
              <div className="detail-field">
                <label>Payment Method (locked)</label>
                <input value={txnDetail?.payment_method || 'N/A'} disabled readOnly />
              </div>
              <div className="detail-field">
                <label>Transaction Type (locked)</label>
                <input value={txnDetail?.transaction_type || 'N/A'} disabled readOnly />
              </div>

              {/* Editable metadata */}
              <div className="detail-field">
                <label>Staff Member</label>
                <select
                  value={txnDraft.staff_member}
                  onChange={(e) => setTxnDraft({ ...txnDraft, staff_member: e.target.value })}
                  className={editedClass(txnDraft.staff_member, txnDetail?.staff_member)}
                >
                  <option value="">Unspecified</option>
                  {staff.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="detail-field">
                <label>Cardholder Name</label>
                <input
                  value={txnDraft.cardholder_name}
                  onChange={(e) => setTxnDraft({ ...txnDraft, cardholder_name: e.target.value })}
                  className={editedClass(txnDraft.cardholder_name, txnDetail?.cardholder_name)}
                />
              </div>
              <div className="detail-field">
                <label>Last 4</label>
                <input
                  maxLength={4}
                  value={txnDraft.last4}
                  onChange={(e) => setTxnDraft({ ...txnDraft, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className={editedClass(txnDraft.last4, txnDetail?.last4)}
                />
              </div>
              <div className="detail-field">
                <label>Expiry Month (MM)</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  placeholder="MM"
                  value={txnDraft.expiry_month}
                  onChange={(e) => setTxnDraft({ ...txnDraft, expiry_month: e.target.value })}
                  className={editedClass(txnDraft.expiry_month, txnDetail?.expiry_month)}
                />
              </div>
              <div className="detail-field">
                <label>Expiry Year (YYYY)</label>
                <input
                  type="number"
                  min="2020"
                  max="2100"
                  placeholder="YYYY"
                  value={txnDraft.expiry_year}
                  onChange={(e) => setTxnDraft({ ...txnDraft, expiry_year: e.target.value })}
                  className={editedClass(txnDraft.expiry_year, txnDetail?.expiry_year)}
                />
              </div>
              <div className="detail-field">
                <label>Auth Code</label>
                <input
                  value={txnDraft.auth_code}
                  onChange={(e) => setTxnDraft({ ...txnDraft, auth_code: e.target.value })}
                  className={editedClass(txnDraft.auth_code, txnDetail?.auth_code)}
                />
              </div>
              <div className="detail-field">
                <label>Reference Number</label>
                <input
                  value={txnDraft.reference_number}
                  onChange={(e) => setTxnDraft({ ...txnDraft, reference_number: e.target.value })}
                  className={editedClass(txnDraft.reference_number, txnDetail?.reference_number)}
                />
              </div>
              <div className="detail-field">
                <label>E-Transfer Reference</label>
                <input
                  value={txnDraft.e_transfer_reference}
                  onChange={(e) => setTxnDraft({ ...txnDraft, e_transfer_reference: e.target.value })}
                  className={editedClass(txnDraft.e_transfer_reference, txnDetail?.e_transfer_reference)}
                />
              </div>
            </div>

            <div className="detail-field" style={{ marginTop: '12px' }}>
              <label>Transaction Notes</label>
              <textarea
                rows={4}
                maxLength={500}
                value={txnDraft.transaction_notes}
                onChange={(e) => setTxnDraft({ ...txnDraft, transaction_notes: e.target.value })}
                className={`notes-edit ${editedClass(txnDraft.transaction_notes, txnDetail?.transaction_notes)}`}
                style={{ width: '100%', resize: 'vertical' }}
              />
              <p className="field-hint-text">{(txnDraft.transaction_notes || '').length}/500 characters</p>
            </div>

            <button className="tool-btn primary btn-block-center" style={{ marginTop: '16px' }} onClick={saveTxn} disabled={savingTxn}>
              {savingTxn ? 'Saving...' : 'Save Changes'}
            </button>
            {!isVoidedTxn(txnDetail) && (
              <button
                className="tool-btn btn-block-center btn-danger"
                style={{ marginTop: '10px' }}
                onClick={() => setVoidTarget(txnDetail)}
                disabled={savingTxn}
              >
                Void Transaction
              </button>
            )}

            <p className="field-hint-text" style={{ textAlign: 'center', marginTop: '12px' }}>
              Need to change the amount or payment method? Please void/delete this entry and log a new transaction.
            </p>
          </div>
        </div>
      )}

      {/* + ADD CHARGE SUB-MODAL (folio_entries) */}
      {addChargeOpen && (
        <div className="modal-overlay">
          <div className="modal-content add-charge-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingChargeId ? 'Edit Charge' : 'Add Charge'}</h3>
              <button onClick={() => !savingCharge && guardedClose(chargeDirty, () => setAddChargeOpen(false))} className="close-drawer-btn">✕</button>
            </div>

            <div className="add-charge-body">
            <div className="add-charge-grid">
              {/* Row 1: Charge Type | Amount */}
              <div className="detail-field">
                <label>Charge Type *</label>
                <select
                  value={chargeForm.entry_type}
                  onChange={(e) => setChargeForm({ ...chargeForm, entry_type: e.target.value })}
                  disabled={savingCharge}
                  className={chargeOriginal ? editedClass(chargeForm.entry_type, chargeOriginal.entry_type) : ''}
                >
                  {CHARGE_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="detail-field">
                <label>Amount ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={chargeForm.amount}
                  onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                  disabled={savingCharge}
                  className={chargeOriginal ? editedClass(chargeForm.amount, chargeOriginal.amount) : ''}
                />
              </div>

              {/* Row 2: Entry Date | Staff Member */}
              <div className="detail-field">
                <label>Entry Date</label>
                <input
                  type="date"
                  value={chargeForm.entry_date}
                  onChange={(e) => setChargeForm({ ...chargeForm, entry_date: e.target.value })}
                  disabled={savingCharge}
                  className={chargeOriginal ? editedClass(chargeForm.entry_date, chargeOriginal.entry_date) : ''}
                />
              </div>
              <div className="detail-field">
                <label>Staff Member</label>
                <select
                  value={chargeForm.staff_member}
                  onChange={(e) => setChargeForm({ ...chargeForm, staff_member: e.target.value })}
                  disabled={savingCharge}
                  className={chargeOriginal ? editedClass(chargeForm.staff_member, chargeOriginal.staff_member) : ''}
                >
                  <option value="">Unspecified</option>
                  {staff.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>

              {/* Row 3: Description (full width) */}
              <div className="detail-field full-span">
                <label>Description</label>
                <input
                  type="text"
                  placeholder="e.g. Pet Fee, Late Checkout, GST 5%"
                  value={chargeForm.description}
                  onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                  disabled={savingCharge}
                  className={chargeOriginal ? editedClass(chargeForm.description, chargeOriginal.description) : ''}
                />
              </div>

              {/* Row 4: Notes (full width) */}
              <div className="detail-field full-span">
                <label>Notes</label>
                <textarea
                  rows={3}
                  maxLength={500}
                  placeholder="Add any notes for this charge..."
                  value={chargeForm.notes}
                  onChange={(e) => setChargeForm({ ...chargeForm, notes: e.target.value })}
                  disabled={savingCharge}
                  className={`notes-edit ${chargeOriginal ? editedClass(chargeForm.notes, chargeOriginal.notes) : ''}`}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                <p className="field-hint-text">{(chargeForm.notes || '').length}/500 characters</p>
              </div>
            </div>

            <button className="tool-btn primary" style={{ width: '100%', marginTop: '16px' }} onClick={saveCharge} disabled={savingCharge}>
              {savingCharge ? 'Saving...' : (editingChargeId ? 'Save Changes' : 'Save Charge')}
            </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW TRANSACTION MODAL — booking resolved from live state for a fresh balance */}
      <PaymentModal
        isOpen={!!payBooking}
        onClose={() => { setPayBooking(null); setPayTxns([]); }}
        booking={livePayBooking}
        onPaymentComplete={async () => { await refreshData?.(); setPayBooking(null); setPayTxns([]); }}
        existingTransactions={payTxns}
        defaultTransactionType="completion"
      />

      {/* Unsaved-changes confirmation (shared across folio sub-modals) */}
      <ConfirmDialog
        open={!!pendingClose}
        onYes={() => { if (pendingClose) pendingClose(); setPendingClose(null); }}
        onNo={() => setPendingClose(null)}
      />

      {/* Void transaction confirmation */}
      <ConfirmDialog
        open={!!voidTarget}
        message={`Are you sure you want to void this transaction of $${Number(voidTarget?.amount || 0).toFixed(2)}? This will remove it from the guest's paid balance.`}
        yesLabel="Confirm Void"
        noLabel="Cancel"
        onYes={async () => { const t = voidTarget; setVoidTarget(null); await voidTransaction(t); }}
        onNo={() => setVoidTarget(null)}
      />
    </div>
  );
};

export default GuestFolio;
