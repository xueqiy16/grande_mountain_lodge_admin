import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import ConfirmDialog from './components/ConfirmDialog';
import { STAFF_MEMBERS, TRANSACTION_TYPES, resolveRoomPreset } from './lib/constants';
import { computeStayCost } from './lib/costing';
import {
  isValidStayRange,
  pickAssignableRoom,
  fetchBlockingBookings,
  bookingErrorMessage,
  NO_ROOMS_FOR_DATES_MESSAGE
} from './lib/availability';
// Local calendar date as YYYY-MM-DD. Built from the local getFullYear/Month/Date
// (NOT toISOString(), which is UTC and can jump a day across the midnight boundary).
const getLocalTodayString = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Fresh blank reservation state (check_in defaults to local today each time it's built).
// transaction_type defaults to pre_auth (guest starting a stay); staff can switch
// to purchase when charging the full amount up front.
const getInitialFormData = () => ({
  reservation_type: 'walk_in', // walk_in | phone | online (matches bookings.reservation_type enum)
  first_name: '', last_name: '', email: '', phone: '', address: '', city: '', country: '',
  room_price: '', // editable nightly rate ($ CAD); defaults from the selected room type
  check_in: getLocalTodayString(), // Walk-in arrives TODAY (local date)
  check_out: '', adults: 1, children: 0, pets: 0,
  card_brand: '', card_holder_name: '', last4: '', auth_code: '', reference_number: '',
  etransfer_reference: '', amount_paid: '', staff_member: '', transaction_type: 'pre_auth',
  notes: ''
});

const WalkInModal = ({ isOpen, onClose, onBookingComplete, staffList }) => {
  // Prefer the live active-staff roster; fall back to the hard-coded list.
  const staff = staffList && staffList.length ? staffList : STAFF_MEMBERS;
  const [roomTypes, setRoomTypes] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [roomError, setRoomError] = useState(false);
  const [etransferError, setEtransferError] = useState(false);
  const [checkInError, setCheckInError] = useState(false);
  const [checkOutError, setCheckOutError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState(getInitialFormData());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Dirty when a room is picked or any field diverges from a fresh blank form.
  const pristine = getInitialFormData();
  const isDirty = selectedType !== '' ||
    Object.keys(pristine).some(k => String(formData[k] ?? '') !== String(pristine[k] ?? ''));

  // Wipe the entire form back to a clean slate (used on close + successful booking).
  const resetForm = () => {
    setFormData(getInitialFormData());
    setSelectedType('');
    setRoomError(false);
    setEtransferError(false);
    setCheckInError(false);
    setCheckOutError(false);
    setIsSubmitting(false);
  };

  // Always reset before delegating to the parent's close handler.
  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Close request from the X button: confirm first if there are unsaved changes.
  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty) { setConfirmOpen(true); return; }
    handleClose();
  };

  // Walk-ins are immediate arrivals (checked in + payment collected now); Phone/Online
  // are future reservations (status 'confirmed', no upfront payment or transaction).
  const isWalkIn = formData.reservation_type === 'walk_in';

  // card_brand holds the selected payment_method enum value (visa/mastercard/amex/interac_debit/cash/e_transfer).
  const isEtransfer = formData.card_brand === 'e_transfer';
  // Card metadata only applies to real credit cards (not Cash/Debit/E-transfer/empty).
  const requiresCardDetails =
    formData.card_brand !== '' &&
    formData.card_brand !== 'cash' &&
    formData.card_brand !== 'interac_debit' &&
    !isEtransfer;
  // Auth Code + Reference Number are optional manual fields transcribed from the
  // physical Moneris terminal receipt (Visa / Mastercard / Amex / Interac Debit).
  const showTerminalFields = requiresCardDetails || formData.card_brand === 'interac_debit';

  useEffect(() => {
    const fetchData = async () => {
      const typesRes = await supabase
        .from('room_types')
        .select('*')
        .order('nightly_rate', { ascending: true })
        .order('name', { ascending: true });
      if (typesRes.data) setRoomTypes(typesRes.data);
    };
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Date rules depend on the reservation type:
    //  - Walk-In: check-in MUST be today's local date (immediate arrival).
    //  - Phone/Online: check-in must be today OR a future date (no past dates).
    const today = getLocalTodayString();
    if (isWalkIn ? formData.check_in !== today : formData.check_in < today) {
      setCheckInError(true);
      return;
    }

    if (!isValidStayRange(formData.check_in, formData.check_out)) {
      setCheckOutError(true);
      return;
    }
    setCheckOutError(false);

    // The <select> value is always a string. Trim it defensively in case any
    // label text or whitespace leaks into the value.
    const sanitizedValue = String(selectedType).trim();
    if (!sanitizedValue) {
      setRoomError(true);
      return;
    }

    // Room Price is required and must be a positive number (staff can override the
    // default, but never leave it blank or set it to 0/negative).
    const roomPrice = Number(formData.room_price);
    if (isNaN(roomPrice) || roomPrice <= 0) {
      alert("Please enter a valid room price ($ CAD / night).");
      return;
    }

    // Payment is only collected for Walk-Ins. Phone/Online reservations log no
    // upfront transaction, so all payment validation is skipped for them.
    let amountPaid = 0;
    if (isWalkIn) {
      // Strict validation: E-transfer requires a reference number.
      if (isEtransfer && !formData.etransfer_reference.trim()) {
        setEtransferError(true);
        return;
      }

      // Amount paid is entered by staff; save exactly what they enter (0 allowed for
      // reservations with no deposit). Reject negatives / non-numeric input.
      amountPaid = Number(formData.amount_paid || 0);
      if (isNaN(amountPaid) || amountPaid < 0) {
        alert("Please enter a valid amount paid (0 or greater).");
        return;
      }
    }

    // Guard against duplicate transaction/booking creation on double-submit.
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Live rooms + blocking bookings at submit time. The list loaded when the
    // modal opened is never the final authority. PostgreSQL still enforces overlap.
    const [roomsRes, bookingsRes] = await Promise.all([
      supabase.from('rooms').select('*'),
      fetchBlockingBookings(supabase, formData.check_in, formData.check_out)
    ]);
    if (roomsRes.error || bookingsRes.error) {
      setIsSubmitting(false);
      return alert('Could not verify room availability. Please try again.');
    }
    const liveRooms = roomsRes.data || [];

    const targetRoom = pickAssignableRoom({
      rooms: liveRooms,
      roomTypeId: sanitizedValue,
      checkIn: formData.check_in,
      checkOut: formData.check_out,
      bookings: bookingsRes.data || [],
      today
    });
    if (!targetRoom) {
      setRoomError(true);
      setIsSubmitting(false);
      return;
    }
    setRoomError(false);

    // Walk-Ins arrive now (checked in → room becomes occupied via DB trigger).
    // Phone/Online are future reservations (confirmed → room stays available until
    // check-in). Values must match the booking_status_type enum exactly.
    const finalStatus = isWalkIn ? 'checked_in' : 'confirmed';

    // 1. Create Guest
    const { data: guestData, error: guestError } = await supabase
      .from('guests')
      .insert([{ 
        first_name: formData.first_name, last_name: formData.last_name,
        email: formData.email, phone: formData.phone,
        address: formData.address, city: formData.city, country: formData.country
      }])
      .select().single();

    if (guestError) {
      setIsSubmitting(false);
      return alert("Guest Error: " + guestError.message);
    }

    // Generate clean UUID + reference codes to map to the exact bookings schema.
    // Codes use a 6-char alphanumeric pool (A-Z, 0-9) => 36^6 ≈ 2.1B combinations.
    const generateCode = (prefix) => {
      const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let suffix = '';
      for (let i = 0; i < 6; i++) {
        suffix += pool.charAt(Math.floor(Math.random() * pool.length));
      }
      return `${prefix}-${suffix}`;
    };

    const bookingReference = generateCode('BK');
    // Free-text stay note stored verbatim on bookings.booking_notes (no headers/append).
    const bookingNotes = formData.notes.trim() ? formData.notes : null;
    // E-transfer reference has its own dedicated transactions.e_transfer_reference column.
    const eTransferReference = isEtransfer ? formData.etransfer_reference.trim() : null;

    // Pricing: nights * nightly rate + taxes. Uses the editable Room Price entered
    // by staff. total_price stores the tax-inclusive grand total (base + GST +
    // tourism levy); folio edits later fold in fees/discounts.
    const priced = computeStayCost(roomPrice, formData.check_in, formData.check_out);
    const totalNights = Math.max(1, priced.numberOfNights);
    const totalPrice = Number(priced.totalStayAmount.toFixed(2));

    const cardHolderName = requiresCardDetails
      ? (formData.card_holder_name.trim() ||
         `${formData.first_name} ${formData.last_name}`.trim())
      : null;

    // 2. Create Booking — stay/room details ONLY. Walk-ins carry no guarantee or
    // card fields on the bookings row; all payment data lives on transactions.
    const { data: bookingData, error: bookingError } = await supabase
      .from('bookings')
      .insert([{
        guest_id: guestData.guest_id,
        room_id: targetRoom.room_id,
        reservation_type: formData.reservation_type,
        check_in: formData.check_in,
        check_out: formData.check_out,
        adults: Number(formData.adults) || 0,
        children: Number(formData.children) || 0,
        pets: Number(formData.pets) || 0,
        room_price: roomPrice,
        total_nights: totalNights,
        total_price: totalPrice,
        // amount_paid is owned by the tr_update_amount_paid trigger, which recomputes
        // it from the transactions ledger (type-aware). Seed 0; the transaction insert
        // below fires the trigger and sets the true value.
        amount_paid: 0,
        booking_status: finalStatus,
        booking_reference: bookingReference,
        booking_notes: bookingNotes
      }])
      .select('booking_id')
      .single();

    if (bookingError) {
      setIsSubmitting(false);
      return alert(bookingErrorMessage(bookingError, 'Booking Error'));
    }

    const bookingId = bookingData.booking_id;

    // Room operational status transitions are handled by database
    // room-status triggers. No client-side rooms.status write happens here.

    // 3. Record the collected payment as a transaction whenever money changed hands
    // (full, partial, or deposit). All card/payment details live here, not on bookings.
    // card_brand holds the transactions.payment_method enum value; charged_at is now.
    // Only Walk-Ins collect payment at creation; Phone/Online log no transaction.
    if (isWalkIn && amountPaid > 0) {
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert([{
          booking_id: bookingId,
          transaction_type: formData.transaction_type,
          status: 'completed',
          amount: amountPaid,
          payment_method: formData.card_brand,
          cardholder_name: cardHolderName,
          last4: requiresCardDetails ? formData.last4 : null,
          auth_code: showTerminalFields ? (formData.auth_code.trim() || null) : null,
          reference_number: showTerminalFields ? (formData.reference_number.trim() || null) : null,
          e_transfer_reference: eTransferReference,
          transaction_notes: null,
          staff_member: formData.staff_member,
          charged_at: new Date().toISOString()
        }]);

      if (transactionError) {
        setIsSubmitting(false);
        return alert("Payment recording failed: " + transactionError.message);
      }
    }

    onBookingComplete(
      isWalkIn
        ? `Checked into Room ${targetRoom.room_number}!`
        : `Reservation confirmed for Room ${targetRoom.room_number}!`
    );
    handleClose();
  };

  // Live cost summary: resolve the selected room type, then derive nights/taxes/total.
  // All math uses the editable Room Price (formData.room_price), NOT the raw DB rate.
  const selectedRoomTypeLive = roomTypes.find(
    t => String(t.room_type_id).trim() === String(selectedType).trim()
  );
  const selectedPreset = resolveRoomPreset(selectedRoomTypeLive);
  const cost = computeStayCost(formData.room_price, formData.check_in, formData.check_out);
  const showCostInfo = !!selectedRoomTypeLive && cost.numberOfNights > 0;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content walkin-modal-wide">
        <div className="modal-header">
          <h3>New Reservation</h3>
          <button onClick={requestClose} className="close-drawer-btn">✕</button>
        </div>
        
        <form onSubmit={handleSubmit} className="walkin-form">
          <div className="walkin-form-body">
          <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: '20px' }}>
            <div className="form-group">
              <label>Reservation Type *</label>
              <select
                required
                value={formData.reservation_type}
                onChange={(e) => {
                  const value = e.target.value;
                  // Re-validate the check-in date against the new type's rules.
                  const today = getLocalTodayString();
                  const nextWalkIn = value === 'walk_in';
                  setCheckInError(
                    nextWalkIn ? formData.check_in !== today : formData.check_in < today
                  );
                  setFormData({ ...formData, reservation_type: value });
                }}
              >
                <option value="walk_in">Walk In</option>
                <option value="phone">Phone</option>
                <option value="online">Online</option>
              </select>
            </div>
            <div className="form-group">
              <label>Room Type *</label>
              <select
                required
                value={selectedType}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedType(id);
                  setRoomError(false);
                  // Auto-fill the editable Room Price with this type's standard rate.
                  const rt = roomTypes.find(t => String(t.room_type_id).trim() === String(id).trim());
                  const preset = resolveRoomPreset(rt);
                  setFormData(fd => ({
                    ...fd,
                    room_price: preset.price === '' ? '' : String(preset.price)
                  }));
                }}
                className={roomError ? 'input-error' : ''}
                aria-invalid={roomError}
                aria-describedby={roomError ? 'room-category-error' : undefined}
              >
                <option value="">Select Room Type</option>
                {roomTypes.map(t => (
                  <option key={t.room_type_id} value={t.room_type_id}>{t.name}</option>
                ))}
              </select>
              {roomError && (
                <p id="room-category-error" className="field-error-text">
                  {NO_ROOMS_FOR_DATES_MESSAGE}
                </p>
              )}
            </div>
          </div>

          {/* Room Code (read-only, derived from Room Type) + editable Room Price */}
          <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: '20px' }}>
            <div className="form-group">
              <label>Room Code *</label>
              <input
                type="text"
                value={selectedPreset.code}
                readOnly
                disabled
                placeholder="Select a room type"
              />
            </div>
            <div className="form-group">
              <label>Room Price ($ CAD / night) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formData.room_price}
                required
                onChange={(e) => setFormData({ ...formData, room_price: e.target.value })}
              />
              {selectedPreset.price !== '' && (
                <p className="field-hint-text">
                  Default price: ${Number(selectedPreset.price).toFixed(2)} CAD / night
                </p>
              )}
            </div>
          </div>

          {/* Identity Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>First Name</label><input type="text" required onChange={(e) => setFormData({...formData, first_name: e.target.value})} /></div>
            <div className="form-group"><label>Last Name</label><input type="text" required onChange={(e) => setFormData({...formData, last_name: e.target.value})} /></div>
            <div className="form-group"><label>Email</label><input type="email" required onChange={(e) => setFormData({...formData, email: e.target.value})} /></div>
          </div>

          {/* Schedule Group */}
          <div className="form-grid-3">
            <div className="form-group">
              <label>Check In *</label>
              <input
                type="date"
                value={formData.check_in}
                min={getLocalTodayString()}
                // Walk-ins are locked to today; Phone/Online allow any future date.
                max={isWalkIn ? getLocalTodayString() : undefined}
                required
                className={checkInError ? 'input-error' : ''}
                aria-invalid={checkInError}
                onChange={(e) => {
                  const value = e.target.value;
                  const today = getLocalTodayString();
                  // Walk-in: must be exactly today. Phone/Online: no past dates.
                  setCheckInError(isWalkIn ? value !== today : value < today);
                  setCheckOutError(Boolean(formData.check_out && value && formData.check_out <= value));
                  setFormData({ ...formData, check_in: value });
                }}
              />
              {checkInError && (
                <p className="field-error-text">
                  {isWalkIn ? 'Walk-in check-in date must be today.' : 'Check-in date cannot be in the past.'}
                </p>
              )}
            </div>
            <div className="form-group">
              <label>Check Out *</label>
              <input
                type="date"
                required
                value={formData.check_out}
                min={formData.check_in || undefined}
                className={checkOutError ? 'input-error' : ''}
                aria-invalid={checkOutError}
                onChange={(e) => {
                  const value = e.target.value;
                  setCheckOutError(Boolean(formData.check_in && value && value <= formData.check_in));
                  setFormData({ ...formData, check_out: value });
                }}
              />
              {checkOutError && (
                <p className="field-error-text">Check-out date must be after check-in.</p>
              )}
            </div>
            <div className="form-group"><label>Phone</label><input type="text" required onChange={(e) => setFormData({...formData, phone: e.target.value})} /></div>
          </div>

          {/* Location Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>Address</label><input type="text" onChange={(e) => setFormData({...formData, address: e.target.value})} /></div>
            <div className="form-group"><label>City</label><input type="text" onChange={(e) => setFormData({...formData, city: e.target.value})} /></div>
            <div className="form-group"><label>Country</label><input type="text" onChange={(e) => setFormData({...formData, country: e.target.value})} /></div>
          </div>

          <div className="form-grid-3">
            <div className="form-group">
              <label>Adults *</label>
              <input type="number" min="0" value={formData.adults} required onChange={(e) => setFormData({...formData, adults: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Children</label>
              <input type="number" min="0" value={formData.children} onChange={(e) => setFormData({...formData, children: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Pets</label>
              <input type="number" min="0" value={formData.pets} onChange={(e) => setFormData({...formData, pets: e.target.value})} />
            </div>
          </div>

          {showCostInfo && (
            <div className="cost-info-box">
              <div className="cost-info-title">Cost Information</div>
              <div className="cost-info-row">
                <span>Room Type</span>
                <span>{selectedRoomTypeLive.name}{selectedRoomTypeLive.code ? ` (${selectedRoomTypeLive.code})` : ''}</span>
              </div>
              <div className="cost-info-row">
                <span>Room Cost per Night</span>
                <span>${cost.nightlyRate.toFixed(2)} / night</span>
              </div>
              <div className="cost-info-row">
                <span>Number of Nights</span>
                <span>{cost.numberOfNights} night{cost.numberOfNights !== 1 ? 's' : ''}</span>
              </div>
              <div className="cost-info-row">
                <span>Base Room Charges</span>
                <span>${cost.baseRoomCharge.toFixed(2)}</span>
              </div>
              <div className="cost-info-row">
                <span>GST (5%)</span>
                <span>${cost.gst.toFixed(2)}</span>
              </div>
              {cost.numberOfNights < 28 && (
                <div className="cost-info-row">
                  <span>Alberta Tourism Levy (6%)</span>
                  <span>${cost.tourismLevy.toFixed(2)}</span>
                </div>
              )}
              <div className="cost-info-row cost-info-total">
                <span>Total Stay Amount</span>
                <span>${cost.totalStayAmount.toFixed(2)}</span>
              </div>
            </div>
          )}

          {isWalkIn && (
          <>
          <div className="form-section-title">Payment Details</div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Payment Method *</label>
              <select
                required
                value={formData.card_brand}
                onChange={(e) => {
                  const value = e.target.value;
                  const clearsCard = value !== 'visa' && value !== 'mastercard' && value !== 'amex';
                  // Auth Code / Reference Number apply to card + Interac Debit only.
                  const clearsTerminal = clearsCard && value !== 'interac_debit';
                  const clearsEtransfer = value !== 'e_transfer';
                  setEtransferError(false);
                  setFormData({
                    ...formData,
                    card_brand: value,
                    ...(clearsCard
                      ? { card_holder_name: '', last4: '' }
                      : {}),
                    ...(clearsTerminal ? { auth_code: '', reference_number: '' } : {}),
                    ...(clearsEtransfer ? { etransfer_reference: '' } : {})
                  });
                }}
              >
                <option value="">Select payment method...</option>
                <option value="visa">Visa</option>
                <option value="mastercard">Mastercard</option>
                <option value="amex">Amex</option>
                <option value="interac_debit">Interac Debit</option>
                <option value="cash">Cash</option>
                <option value="e_transfer">E-Transfer</option>
              </select>
            </div>

            <div className="form-group">
              <label>Amount Paid *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formData.amount_paid}
                onChange={(e) => setFormData({...formData, amount_paid: e.target.value})}
                required
              />
              {showCostInfo && (
                <p className="field-hint-text">
                  Stay total: ${cost.totalStayAmount.toFixed(2)} ({cost.numberOfNights} night{cost.numberOfNights !== 1 ? 's' : ''})
                </p>
              )}
            </div>

            <div className="form-group">
              <label>Transaction Type *</label>
              <select
                required
                value={formData.transaction_type}
                onChange={(e) => setFormData({...formData, transaction_type: e.target.value})}
              >
                {TRANSACTION_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Staff Member</label>
              <select
                value={formData.staff_member}
                onChange={(e) => setFormData({...formData, staff_member: e.target.value})}
              >
                <option value="">Select staff member...</option>
                {staff.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            {isEtransfer && (
              <div className="form-group">
                <label>E-Transfer Reference Number *</label>
                <input
                  type="text"
                  placeholder="e.g. ETR-123456"
                  value={formData.etransfer_reference}
                  onChange={(e) => { setFormData({...formData, etransfer_reference: e.target.value}); setEtransferError(false); }}
                  className={etransferError ? 'input-error' : ''}
                  aria-invalid={etransferError}
                />
                {etransferError && (
                  <p className="field-error-text">E-Transfer reference number is required.</p>
                )}
              </div>
            )}

            {requiresCardDetails && (
              <>
                <div className="form-group">
                  <label>Cardholder Name</label>
                  <input
                    type="text"
                    placeholder="Name on card"
                    value={formData.card_holder_name}
                    onChange={(e) => setFormData({...formData, card_holder_name: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Last 4 Digits *</label>
                  <input
                    type="text"
                    maxLength="4"
                    value={formData.last4}
                    onChange={(e) => setFormData({...formData, last4: e.target.value})}
                    required
                  />
                </div>
              </>
            )}

            {showTerminalFields && (
              <>
                <div className="form-group">
                  <label>Auth Code</label>
                  <input
                    type="text"
                    placeholder="e.g. 123456"
                    value={formData.auth_code}
                    onChange={(e) => setFormData({...formData, auth_code: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Reference Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 987654321"
                    value={formData.reference_number}
                    onChange={(e) => setFormData({...formData, reference_number: e.target.value})}
                  />
                </div>
              </>
            )}
          </div>
          </>
          )}

          <div className="form-section-title">Booking Notes</div>
          <div className="form-group">
            <textarea
              rows={3}
              maxLength={500}
              placeholder="Add any payment, arrival, or special request notes here..."
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              style={{ resize: 'vertical', width: '100%' }}
            />
            <p className="field-hint-text">{formData.notes.length}/500 characters</p>
          </div>
          </div>

          <div className="walkin-form-footer">
            <button type="submit" className="tool-btn primary" style={{ width: '100%' }} disabled={isSubmitting}>
              {isSubmitting ? 'Processing...' : 'Complete Reservation'}
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onYes={() => { setConfirmOpen(false); handleClose(); }}
        onNo={() => setConfirmOpen(false)}
      />
    </div>
  );
};

export default WalkInModal;