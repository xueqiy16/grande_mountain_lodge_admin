import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { STAFF_MEMBERS, TRANSACTION_TYPES } from './lib/constants';

// Blank slate used on close; the form is re-populated from the booking on open.
const getBlankFormData = () => ({
  first_name: '', last_name: '', email: '', phone: '', address: '', city: '', country: '',
  check_in: '', check_out: '', adults: 1, children: 0, pets: 0,
  card_brand: '', cardholder_name: '', last4: '', expiry_month: '', expiry_year: '',
  etransfer_reference: '', amount_paid: '', staff_member: '', transaction_type: 'pre_auth',
  notes: ''
});

const CheckInModal = ({ isOpen, onClose, booking, onCheckInComplete }) => {
  const [roomTypes, setRoomTypes] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [roomError, setRoomError] = useState(false);
  const [etransferError, setEtransferError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [formData, setFormData] = useState(getBlankFormData());

  // card_brand holds the selected payment_method enum value (visa/mastercard/amex/interac_debit/cash/e_transfer).
  const isEtransfer = formData.card_brand === 'e_transfer';
  // Card metadata only applies to real credit cards (not Cash/Debit/E-transfer/empty).
  const requiresCardDetails =
    formData.card_brand !== '' &&
    formData.card_brand !== 'cash' &&
    formData.card_brand !== 'interac_debit' &&
    !isEtransfer;

  // Load room categories + rooms (for optional room re-assignment at check-in).
  useEffect(() => {
    const fetchData = async () => {
      const [typesRes, roomsRes] = await Promise.all([
        supabase
          .from('room_types')
          .select('*')
          .order('nightly_rate', { ascending: true })
          .order('name', { ascending: true }),
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

  // Pre-populate the form with the existing booking + guest record on open.
  // Amount Paid defaults to blank (0), NOT the full stay total. Cardholder name
  // defaults to the guest's name but stays editable for third-party cards.
  useEffect(() => {
    if (isOpen && booking) {
      const g = booking.guests || {};
      setSelectedType(String(booking.rooms?.room_type_id ?? ''));
      setFormData({
        first_name: g.first_name || '',
        last_name: g.last_name || '',
        email: g.email || '',
        phone: g.phone || '',
        address: g.address || '',
        city: g.city || '',
        country: g.country || '',
        check_in: booking.check_in || '',
        check_out: booking.check_out || '',
        adults: booking.adults ?? 1,
        children: booking.children ?? 0,
        pets: booking.pets ?? 0,
        card_brand: '',
        cardholder_name: `${g.first_name || ''} ${g.last_name || ''}`.trim(),
        last4: '',
        expiry_month: '',
        expiry_year: '',
        etransfer_reference: '',
        amount_paid: '',
        staff_member: '',
        transaction_type: 'pre_auth',
        notes: booking.booking_notes || ''
      });
    }
  }, [isOpen, booking]);

  // Reset when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setFormData(getBlankFormData());
      setSelectedType('');
      setRoomError(false);
      setEtransferError(false);
      setIsProcessing(false);
    }
  }, [isOpen]);

  const isRoomAvailable = (room) =>
    (room?.status ?? '').toString().toLowerCase().trim() === 'available';

  const handleClose = () => {
    if (isProcessing) return;
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!booking) return;

    const sanitizedValue = String(selectedType).trim();
    const originalTypeId = String(booking.rooms?.room_type_id ?? '').trim();

    // Keep the existing room unless staff picked a different category, in which
    // case reassign to an available room of that category.
    let targetRoomId = booking.room_id;
    let targetRoomNumber = booking.rooms?.room_number;
    if (sanitizedValue !== originalTypeId) {
      const targetRoom = allRooms.find(
        r => String(r.room_type_id).trim() === sanitizedValue && isRoomAvailable(r)
      );
      if (!targetRoom) {
        setRoomError(true);
        return;
      }
      targetRoomId = targetRoom.room_id;
      targetRoomNumber = targetRoom.room_number;
    }

    // Strict validation: E-transfer requires a reference number.
    if (isEtransfer && !formData.etransfer_reference.trim()) {
      setEtransferError(true);
      return;
    }

    // Amount paid is entered by staff; save exactly what they enter (0 allowed).
    const amountPaid = Number(formData.amount_paid || 0);
    if (isNaN(amountPaid) || amountPaid < 0) {
      alert("Please enter a valid amount paid (0 or greater).");
      return;
    }

    if (isProcessing) return;
    setIsProcessing(true);

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

    // Free-text stay note -> bookings.booking_notes (never payment details).
    const bookingNotes = formData.notes.trim() || null;
    // Payment details live on the transactions row.
    const eTransferReference = isEtransfer ? formData.etransfer_reference.trim() : null;
    const cardHolderName = requiresCardDetails
      ? (formData.cardholder_name.trim() || null)
      : null;

    try {
      // 1. Update the guest record with any edited profile details.
      const { error: guestError } = await supabase
        .from('guests')
        .update({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: formData.phone,
          address: formData.address,
          city: formData.city,
          country: formData.country
        })
        .eq('guest_id', booking.guest_id);

      if (guestError) throw guestError;

      // 2. Update the booking with edited stay details + note, and check the guest in.
      // No card/guarantee/payment data is written to bookings here.
      const { error: bookingError } = await supabase
        .from('bookings')
        .update({
          room_id: targetRoomId,
          check_in: formData.check_in,
          check_out: formData.check_out,
          adults: Number(formData.adults) || 0,
          children: Number(formData.children) || 0,
          pets: Number(formData.pets) || 0,
          total_nights: totalNights,
          total_price: totalPrice,
          amount_paid: amountPaid,
          booking_status: 'checked_in',
          booking_notes: bookingNotes
        })
        .eq('booking_id', booking.booking_id);

      if (bookingError) throw bookingError;

      // Room status -> 'occupied' is handled by the DB trigger tr_update_room_status.

      // 3. Record the collected payment as a transaction whenever money changed hands.
      // All card/payment details live here, not on bookings.
      if (amountPaid > 0) {
        const { error: transactionError } = await supabase
          .from('transactions')
          .insert([{
            booking_id: booking.booking_id,
            transaction_type: formData.transaction_type,
            amount: amountPaid,
            payment_method: formData.card_brand,
            cardholder_name: cardHolderName,
            last4: requiresCardDetails ? formData.last4 : null,
            expiry_month: requiresCardDetails ? (parseInt(formData.expiry_month) || null) : null,
            expiry_year: requiresCardDetails ? (parseInt(formData.expiry_year) || null) : null,
            e_transfer_reference: eTransferReference,
            transaction_notes: null,
            staff_member: formData.staff_member,
            charged_at: new Date().toISOString()
          }]);

        if (transactionError) throw transactionError;
      }

      onCheckInComplete(`Checked into Room ${targetRoomNumber}!`);
      onClose();
    } catch (error) {
      alert(`Check-in failed: ${error.message}`);
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content walkin-modal-wide">
        <div className="modal-header">
          <h3>Check In Guest</h3>
          <button onClick={handleClose} className="close-x" disabled={isProcessing}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="walkin-form">
          <div className="form-section" style={{ marginBottom: '20px' }}>
            <label>1. Select Room Category</label>
            <select
              required
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setRoomError(false); }}
              className={`prefilled ${roomError ? 'input-error' : ''}`}
              aria-invalid={roomError}
              aria-describedby={roomError ? 'room-category-error' : undefined}
              disabled={isProcessing}
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
            <div className="form-group"><label>First Name</label><input className="prefilled" type="text" required value={formData.first_name} onChange={(e) => setFormData({...formData, first_name: e.target.value})} disabled={isProcessing} /></div>
            <div className="form-group"><label>Last Name</label><input className="prefilled" type="text" required value={formData.last_name} onChange={(e) => setFormData({...formData, last_name: e.target.value})} disabled={isProcessing} /></div>
            <div className="form-group"><label>Email</label><input className="prefilled" type="email" required value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} disabled={isProcessing} /></div>
          </div>

          {/* Schedule Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>Check-In Date</label><input className="prefilled" type="date" value={formData.check_in} required onChange={(e) => setFormData({...formData, check_in: e.target.value})} disabled={isProcessing} /></div>
            <div className="form-group"><label>Check-Out Date</label><input className="prefilled" type="date" value={formData.check_out} required onChange={(e) => setFormData({...formData, check_out: e.target.value})} disabled={isProcessing} /></div>
            <div className="form-group"><label>Phone</label><input className="prefilled" type="text" required value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} disabled={isProcessing} /></div>
          </div>

          {/* Location Group */}
          <div className="form-grid-3">
            <div className="form-group"><label>Address</label><input className="prefilled" type="text" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} disabled={isProcessing} /></div>
            <div className="form-group"><label>City</label><input className="prefilled" type="text" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} disabled={isProcessing} /></div>
            <div className="form-group"><label>Country</label><input className="prefilled" type="text" value={formData.country} onChange={(e) => setFormData({...formData, country: e.target.value})} disabled={isProcessing} /></div>
          </div>

          <div className="form-grid-3">
            <div className="form-group"><label>Adults/Children/Pets</label>
              <div style={{display:'flex', gap:'5px'}}>
                <input className="prefilled" type="number" placeholder="A" value={formData.adults} onChange={(e) => setFormData({...formData, adults: e.target.value})} disabled={isProcessing} />
                <input className="prefilled" type="number" placeholder="C" value={formData.children} onChange={(e) => setFormData({...formData, children: e.target.value})} disabled={isProcessing} />
                <input className="prefilled" type="number" placeholder="P" value={formData.pets} onChange={(e) => setFormData({...formData, pets: e.target.value})} disabled={isProcessing} />
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
                  const clearsCard = value !== 'visa' && value !== 'mastercard' && value !== 'amex';
                  const clearsEtransfer = value !== 'e_transfer';
                  setEtransferError(false);
                  setFormData({
                    ...formData,
                    card_brand: value,
                    ...(clearsCard
                      ? { last4: '', expiry_month: '', expiry_year: '' }
                      : {}),
                    ...(clearsEtransfer ? { etransfer_reference: '' } : {})
                  });
                }}
                disabled={isProcessing}
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
              <label>Amount Paid ($) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formData.amount_paid}
                onChange={(e) => setFormData({...formData, amount_paid: e.target.value})}
                required
                disabled={isProcessing}
              />
              {(() => {
                const previewType = roomTypes.find(
                  t => String(t.room_type_id).trim() === String(selectedType).trim()
                );
                if (!previewType || !formData.check_in || !formData.check_out) return null;
                const s = new Date(formData.check_in + 'T00:00:00');
                const en = new Date(formData.check_out + 'T00:00:00');
                const nights = Math.ceil((en.getTime() - s.getTime()) / 86400000);
                if (!(nights > 0)) return null;
                const total = (nights * Number(previewType.nightly_rate)).toFixed(2);
                return <p className="field-hint-text">Stay total: ${total} — enter full, partial, or deposit amount.</p>;
              })()}
            </div>

            <div className="form-group">
              <label>Transaction Type *</label>
              <select
                required
                value={formData.transaction_type}
                onChange={(e) => setFormData({...formData, transaction_type: e.target.value})}
                disabled={isProcessing}
              >
                {TRANSACTION_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Staff Member *</label>
              <select
                required
                value={formData.staff_member}
                onChange={(e) => setFormData({...formData, staff_member: e.target.value})}
                disabled={isProcessing}
              >
                <option value="">Select staff member...</option>
                {STAFF_MEMBERS.map(name => (
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
                  disabled={isProcessing}
                />
                {etransferError && (
                  <p className="field-error-text">E-Transfer reference number is required.</p>
                )}
              </div>
            )}

            {requiresCardDetails && (
              <>
                <div className="form-group">
                  <label>Cardholder Name *</label>
                  <input
                    className="prefilled"
                    type="text"
                    placeholder="Name on card"
                    value={formData.cardholder_name}
                    onChange={(e) => setFormData({...formData, cardholder_name: e.target.value})}
                    required
                    disabled={isProcessing}
                  />
                </div>
                <div className="form-group">
                  <label>Last 4 Digits *</label>
                  <input
                    type="text"
                    maxLength="4"
                    value={formData.last4}
                    onChange={(e) => setFormData({...formData, last4: e.target.value.replace(/\D/g, '')})}
                    required
                    disabled={isProcessing}
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
                      disabled={isProcessing}
                    />
                    <input
                      type="number"
                      placeholder="YYYY"
                      value={formData.expiry_year}
                      onChange={(e) => setFormData({...formData, expiry_year: e.target.value})}
                      required
                      disabled={isProcessing}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="form-section-title">Notes</div>
          <div className="form-group">
            <textarea
              className={booking?.booking_notes ? 'prefilled' : ''}
              rows={3}
              maxLength={500}
              placeholder="Add any arrival or special request notes here..."
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              disabled={isProcessing}
              style={{ resize: 'vertical', width: '100%' }}
            />
            <p className="field-hint-text">{formData.notes.length}/500 characters</p>
          </div>

          <button type="submit" className="tool-btn primary" style={{ width: '100%', marginTop: '20px' }} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Complete Check In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CheckInModal;
