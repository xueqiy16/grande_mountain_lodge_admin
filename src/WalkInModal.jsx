import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

// Fresh blank reservation state (check_in defaults to today each time it's built).
const getInitialFormData = () => ({
  first_name: '', last_name: '', email: '', phone: '', address: '', city: '', country: '',
  check_in: new Date().toISOString().split('T')[0], // Default to today
  check_out: '', adults: 1, children: 0, pets: 0,
  card_brand: '', card_holder_name: '', last4: '', expiry_month: '', expiry_year: '',
  etransfer_reference: ''
});

const WalkInModal = ({ isOpen, onClose, availableRooms, onBookingComplete }) => {
  const [roomTypes, setRoomTypes] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [roomError, setRoomError] = useState(false);
  const [etransferError, setEtransferError] = useState(false);
  const [formData, setFormData] = useState(getInitialFormData());

  // Wipe the entire form back to a clean slate (used on close + successful booking).
  const resetForm = () => {
    setFormData(getInitialFormData());
    setSelectedType('');
    setRoomError(false);
    setEtransferError(false);
  };

  // Always reset before delegating to the parent's close handler.
  const handleClose = () => {
    resetForm();
    onClose();
  };

  const isEtransfer = formData.card_brand === 'E-transfer';
  // Card metadata only applies to real credit cards (not Cash/Debit/E-transfer/empty).
  const requiresCardDetails =
    formData.card_brand !== '' &&
    formData.card_brand !== 'Cash' &&
    formData.card_brand !== 'Debit' &&
    !isEtransfer;

  useEffect(() => {
    const fetchData = async () => {
      const [typesRes, roomsRes] = await Promise.all([
        supabase.from('room_types').select('*'),
        supabase.from('rooms').select('*'),
      ]);
      if (typesRes.data) setRoomTypes(typesRes.data);
      if (roomsRes.data) setAllRooms(roomsRes.data);
    };
    if (isOpen) {
      fetchData();
      setRoomError(false);
      setEtransferError(false);
    }
  }, [isOpen]);

  // Normalize any status string ("Available", " available ", etc.) for comparison.
  const isRoomAvailable = (room) =>
    (room?.status ?? '').toString().toLowerCase().trim() === 'available';

  const handleSubmit = async (e) => {
    e.preventDefault();

    // The <select> value is always a string. Trim it defensively in case any
    // label text or whitespace leaks into the value.
    const sanitizedValue = String(selectedType).trim();

    // Match on the relational id, normalized to strings on BOTH sides so a numeric
    // room_type_id in Supabase still matches the string coming from the dropdown.
    // Availability is read straight from the DB (rooms.status), case/space-insensitive.
    const targetRoom = allRooms.find(
      r => String(r.room_type_id).trim() === sanitizedValue && isRoomAvailable(r)
    );
    if (!targetRoom) {
      setRoomError(true);
      return;
    }

    // Strict validation: E-transfer requires a reference number.
    if (isEtransfer && !formData.etransfer_reference.trim()) {
      setEtransferError(true);
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    // LOGIC: future check-in => 'confirmed' reservation; today => 'checked-in'.
    // Values must match the booking_status_type enum exactly (lowercase/hyphenated).
    const isFutureBooking = formData.check_in > today;
    const finalStatus = isFutureBooking ? 'confirmed' : 'checked-in';

    // 1. Create Guest
    const { data: guestData, error: guestError } = await supabase
      .from('guests')
      .insert([{ 
        first_name: formData.first_name, last_name: formData.last_name,
        email: formData.email, phone: formData.phone,
        address: formData.address, city: formData.city, country: formData.country
      }])
      .select().single();

    if (guestError) return alert("Guest Error: " + guestError.message);

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

    const bookingId = crypto.randomUUID();
    const bookingReference = generateCode('BK');
    // moneris_token is STRICTLY a credit-card gateway token: generate only for real cards.
    const monerisToken = requiresCardDetails ? generateCode('RES') : null;
    // E-transfer reference is stored in the booking's payment_notes column.
    const paymentNotes = isEtransfer ? formData.etransfer_reference.trim() : null;

    // Pricing: nights between check-in/check-out (min 1) * nightly rate of the type.
    const selectedRoomType = roomTypes.find(
      t => String(t.room_type_id).trim() === sanitizedValue
    );
    const start = new Date(formData.check_in + 'T00:00:00');
    const end = new Date(formData.check_out + 'T00:00:00');
    const totalNights = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    );
    const nightlyRate = Number(selectedRoomType?.nightly_rate || 0);
    const totalPrice = Number((totalNights * nightlyRate).toFixed(2));

    const cardHolderName = requiresCardDetails
      ? (formData.card_holder_name.trim() ||
         `${formData.first_name} ${formData.last_name}`.trim())
      : null;

    // 2. Create Booking
    const { error: bookingError } = await supabase
      .from('bookings')
      .insert([{
        booking_id: bookingId,
        guest_id: guestData.guest_id,
        room_id: targetRoom.room_id,
        check_in: formData.check_in,
        check_out: formData.check_out,
        total_nights: totalNights,
        total_price: totalPrice,
        amount_paid: 0,
        adults: Number(formData.adults) || 0,
        children: Number(formData.children) || 0,
        pets: Number(formData.pets) || 0,
        booking_status: finalStatus,
        booking_reference: bookingReference,
        moneris_token: monerisToken,
        payment_notes: paymentNotes,
        card_brand: formData.card_brand,
        card_holder_name: cardHolderName,
        last4: requiresCardDetails ? formData.last4 : null,
        expiry_month: requiresCardDetails ? (parseInt(formData.expiry_month) || null) : null,
        expiry_year: requiresCardDetails ? (parseInt(formData.expiry_year) || null) : null
      }]);

    if (bookingError) return alert("Booking Error: " + bookingError.message);

    // Room status sync (reserved/occupied) is owned by the DB trigger
    // tr_update_room_status, which reads NEW.booking_status on insert.

    onBookingComplete(isFutureBooking ? `Reservation created for Room ${targetRoom.room_number}` : `Checked into Room ${targetRoom.room_number}!`);
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content walkin-modal-wide">
        <div className="modal-header">
          <h3>New Reservation</h3>
          <button onClick={handleClose} className="close-x">✕</button>
        </div>
        
        <form onSubmit={handleSubmit} className="walkin-form">
          <div className="form-section" style={{ marginBottom: '20px' }}>
            <label>1. Select Room Category</label>
            <select
              required
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setRoomError(false); }}
              className={roomError ? 'input-error' : ''}
              aria-invalid={roomError}
              aria-describedby={roomError ? 'room-category-error' : undefined}
            >
              <option value="">Select Room Type...</option>
              {roomTypes.map(t => (
                <option key={t.room_type_id} value={t.room_type_id}>{t.name} (${t.nightly_rate})</option>
              ))}
            </select>
            {roomError && (
              <p id="room-category-error" className="field-error-text">
                No rooms available for this room category.
              </p>
            )}
          </div>

          {/* Identity Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>First Name</label><input type="text" required onChange={(e) => setFormData({...formData, first_name: e.target.value})} /></div>
            <div className="form-group"><label>Last Name</label><input type="text" required onChange={(e) => setFormData({...formData, last_name: e.target.value})} /></div>
            <div className="form-group"><label>Email</label><input type="email" required onChange={(e) => setFormData({...formData, email: e.target.value})} /></div>
          </div>

          {/* Schedule Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>Check-In Date</label><input type="date" value={formData.check_in} required onChange={(e) => setFormData({...formData, check_in: e.target.value})} /></div>
            <div className="form-group"><label>Check-Out Date</label><input type="date" required onChange={(e) => setFormData({...formData, check_out: e.target.value})} /></div>
            <div className="form-group"><label>Phone</label><input type="text" required onChange={(e) => setFormData({...formData, phone: e.target.value})} /></div>
          </div>

          {/* Location Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>Address</label><input type="text" onChange={(e) => setFormData({...formData, address: e.target.value})} /></div>
            <div className="form-group"><label>City</label><input type="text" onChange={(e) => setFormData({...formData, city: e.target.value})} /></div>
            <div className="form-group"><label>Country</label><input type="text" onChange={(e) => setFormData({...formData, country: e.target.value})} /></div>
          </div>

          <div className="form-grid-3">
            <div className="form-group"><label>Adults/Children/Pets</label>
              <div style={{display:'flex', gap:'5px'}}>
                <input type="number" placeholder="A" value={formData.adults} onChange={(e) => setFormData({...formData, adults: e.target.value})} />
                <input type="number" placeholder="C" value={formData.children} onChange={(e) => setFormData({...formData, children: e.target.value})} />
                <input type="number" placeholder="P" value={formData.pets} onChange={(e) => setFormData({...formData, pets: e.target.value})} />
              </div>
            </div>
          </div>

          <div className="form-section-title">Payment Details</div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Payment Method *</label>
              <select
                required
                value={formData.card_brand}
                onChange={(e) => {
                  const value = e.target.value;
                  const clearsCard = value !== 'Visa' && value !== 'Mastercard' && value !== 'Amex';
                  const clearsEtransfer = value !== 'E-transfer';
                  setEtransferError(false);
                  setFormData({
                    ...formData,
                    card_brand: value,
                    ...(clearsCard
                      ? { card_holder_name: '', last4: '', expiry_month: '', expiry_year: '' }
                      : {}),
                    ...(clearsEtransfer ? { etransfer_reference: '' } : {})
                  });
                }}
              >
                <option value="">Select payment method...</option>
                <option value="Visa">Visa</option>
                <option value="Mastercard">Mastercard</option>
                <option value="Amex">Amex</option>
                <option value="Debit">Debit</option>
                <option value="Cash">Cash</option>
                <option value="E-transfer">E-transfer</option>
              </select>
            </div>

            {isEtransfer && (
              <div className="form-group">
                <label>E-transfer Reference Number *</label>
                <input
                  type="text"
                  placeholder="e.g. ETR-123456"
                  value={formData.etransfer_reference}
                  onChange={(e) => { setFormData({...formData, etransfer_reference: e.target.value}); setEtransferError(false); }}
                  className={etransferError ? 'input-error' : ''}
                  aria-invalid={etransferError}
                />
                {etransferError && (
                  <p className="field-error-text">E-transfer reference number is required.</p>
                )}
              </div>
            )}

            {requiresCardDetails && (
              <>
                <div className="form-group">
                  <label>Cardholder Name *</label>
                  <input
                    type="text"
                    placeholder="Name on card"
                    value={formData.card_holder_name}
                    onChange={(e) => setFormData({...formData, card_holder_name: e.target.value})}
                    required
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
                <div className="form-group">
                  <label>Expiry (MM/YYYY) *</label>
                  <div style={{display:'flex', gap:'5px'}}>
                    <input
                      type="number"
                      placeholder="MM"
                      value={formData.expiry_month}
                      onChange={(e) => setFormData({...formData, expiry_month: e.target.value})}
                      required
                    />
                    <input
                      type="number"
                      placeholder="YYYY"
                      value={formData.expiry_year}
                      onChange={(e) => setFormData({...formData, expiry_year: e.target.value})}
                      required
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <button type="submit" className="tool-btn primary" style={{ width: '100%', marginTop: '20px' }}>
            Complete Reservation
          </button>
        </form>
      </div>
    </div>
  );
};

export default WalkInModal;