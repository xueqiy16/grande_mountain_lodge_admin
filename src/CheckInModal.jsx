import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { STAFF_MEMBERS, TRANSACTION_TYPES } from './lib/constants';

const CheckInModal = ({ isOpen, onClose, booking, onCheckInComplete }) => {
  // Helper function to calculate total balance (Stay Total)
  const calculateTotalBalance = (booking) => {
    if (!booking || !booking.check_in || !booking.check_out || !booking.rooms?.room_types?.nightly_rate) return 0;
    const start = new Date(booking.check_in + "T00:00:00");
    const end = new Date(booking.check_out + "T00:00:00");
    const diffInMs = end.getTime() - start.getTime();
    const diffNights = Math.max(1, Math.ceil(diffInMs / (1000 * 60 * 60 * 24))); 
    return Number(diffNights) * Number(booking.rooms.room_types.nightly_rate);
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [etransferError, setEtransferError] = useState(false);
  const [formData, setFormData] = useState({
    card_brand: '',
    cardholder_name: '',
    last4: '',
    expiry_month: '',
    expiry_year: '',
    etransfer_reference: '',
    initial_balance: '0.00',
    staff_member: '',
    transaction_type: 'pre_auth',
    notes: ''
  });

  // Set initial balance to Stay Total when modal opens
  useEffect(() => {
    if (isOpen && booking) {
      const stayTotal = calculateTotalBalance(booking);
      const guestName = `${booking.guests?.first_name || ''} ${booking.guests?.last_name || ''}`.trim();
      setFormData(prev => ({
        ...prev,
        initial_balance: stayTotal.toFixed(2),
        cardholder_name: guestName
      }));
    }
  }, [isOpen, booking]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        card_brand: '',
        cardholder_name: '',
        last4: '',
        expiry_month: '',
        expiry_year: '',
        etransfer_reference: '',
        initial_balance: '0.00',
        staff_member: '',
        transaction_type: 'pre_auth',
        notes: ''
      });
      setIsProcessing(false);
      setEtransferError(false);
    }
  }, [isOpen]);

  // card_brand holds the selected payment_method enum value (visa/mastercard/amex/interac_debit/cash/e_transfer).
  const isEtransfer = formData.card_brand === 'e_transfer';
  const requiresCardDetails =
    formData.card_brand !== '' &&
    formData.card_brand !== 'cash' &&
    formData.card_brand !== 'interac_debit' &&
    !isEtransfer;

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!booking) return;

    if (requiresCardDetails) {
      if (!formData.last4 || formData.last4.length !== 4) {
        alert("Please enter the last 4 digits of the card.");
        return;
      }

      if (!formData.expiry_month || !formData.expiry_year) {
        alert("Please enter the card expiry date.");
        return;
      }
    }

    // Strict validation: E-transfer requires a reference number.
    if (isEtransfer && !formData.etransfer_reference.trim()) {
      setEtransferError(true);
      return;
    }

    const initialBalance = Number(formData.initial_balance);
    if (isNaN(initialBalance) || initialBalance < 0) {
      alert("Please enter a valid initial balance amount.");
      return;
    }

    // Payment is only collected when a method is chosen and a balance is due;
    // amount_paid and the transaction row must stay consistent with each other.
    const paymentCollected = initialBalance > 0 && !!formData.card_brand;

    // Free-text stay note -> bookings.booking_notes (never payment details).
    const bookingNotes = formData.notes.trim() || null;
    // Payment details live on the transactions row, mirroring the Walk-In flow.
    const eTransferReference = isEtransfer ? formData.etransfer_reference.trim() : null;
    const cardHolderName = requiresCardDetails
      ? (formData.cardholder_name.trim() || null)
      : null;

    setIsProcessing(true);

    try {
      // Update booking with stay details only: collected balance, status, and the
      // free-text note. No card/guarantee/payment data is written to bookings here.
      const { error: bookingError } = await supabase
        .from('bookings')
        .update({
          amount_paid: paymentCollected ? initialBalance : 0,
          booking_status: 'checked_in',
          booking_notes: bookingNotes
        })
        .eq('booking_id', booking.booking_id);

      if (bookingError) {
        throw bookingError;
      }

      // Room status -> 'occupied' is handled by the DB trigger tr_update_room_status
      // off the booking_status change; no client-side rooms update needed.

      // Record the collected payment as a transaction. All card/payment details
      // (payment_method, card details, e_transfer_reference) live here, not on bookings.
      if (paymentCollected) {
        const { error: transactionError } = await supabase
          .from('transactions')
          .insert([{
            booking_id: booking.booking_id,
            transaction_type: formData.transaction_type,
            amount: initialBalance,
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

        if (transactionError) {
          throw transactionError;
        }
      }

      // Success
      onCheckInComplete(`Checked in successfully.`);
      onClose();
    } catch (error) {
      alert(`Check-in failed: ${error.message}`);
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Check-In Guest</h3>
          <button 
            onClick={handleClose} 
            className="close-x"
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.5rem',
              fontWeight: 300,
              color: '#64748b',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              padding: 0,
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              opacity: isProcessing ? 0.5 : 1
            }}
          >
            ✕
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="walkin-form">
          {booking && (
            <>
              <div className="form-section" style={{ marginBottom: '20px' }}>
                <label>Guest & Room</label>
                <div style={{ 
                  padding: '10px', 
                  background: '#f1f5f9', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontWeight: 600
                }}>
                  {booking.guests?.first_name} {booking.guests?.last_name} - Room {booking.rooms?.room_number}
                </div>
              </div>
              
              <div className="form-section" style={{ marginBottom: '20px' }}>
                <label>Amount Paid ($)</label>
                <input 
                  type="number" 
                  step="0.01"
                  min="0"
                  required
                  value={formData.initial_balance}
                  onChange={(e) => setFormData({...formData, initial_balance: e.target.value})}
                  disabled={isProcessing}
                  style={{ 
                    padding: '10px', 
                    background: '#f1f5f9', 
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '1.1rem'
                  }}
                />
                <p className="field-hint-text">Stay total: ${calculateTotalBalance(booking).toFixed(2)} — enter full, partial, or deposit amount.</p>
              </div>
            </>
          )}

          <div className="form-section-title">{requiresCardDetails ? 'Card Information' : 'Payment Method'}</div>
          
          <div className="form-grid-3" style={{ gridTemplateColumns: requiresCardDetails ? '1fr 1fr 1fr' : '1fr' }}>
            <div className="form-group">
              <label>Card Brand *</label>
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
                    ...(clearsCard ? { last4: '', expiry_month: '', expiry_year: '' } : {}),
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
            {isEtransfer && (
              <div className="form-group">
                <label>E-Transfer Reference Number *</label>
                <input
                  type="text"
                  value={formData.etransfer_reference}
                  onChange={(e) => { setFormData({...formData, etransfer_reference: e.target.value}); setEtransferError(false); }}
                  className={etransferError ? 'input-error' : ''}
                  aria-invalid={etransferError}
                  disabled={isProcessing}
                  placeholder="e.g. ETR-123456"
                />
                {etransferError && (
                  <p className="field-error-text">E-Transfer reference number is required.</p>
                )}
              </div>
            )}
            {requiresCardDetails && (
              <>
                <div className="form-group">
                  <label>Last 4 Digits *</label>
                  <input 
                    type="text"
                    maxLength="4"
                    required
                    value={formData.last4}
                    onChange={(e) => setFormData({...formData, last4: e.target.value.replace(/\D/g, '')})}
                    disabled={isProcessing}
                    placeholder="1234"
                  />
                </div>
                <div className="form-group">
                  <label>Expiry Month *</label>
                  <input 
                    type="number"
                    min="1"
                    max="12"
                    required
                    value={formData.expiry_month}
                    onChange={(e) => setFormData({...formData, expiry_month: e.target.value})}
                    disabled={isProcessing}
                    placeholder="MM"
                  />
                </div>
              </>
            )}
          </div>

          {requiresCardDetails && (
            <div className="form-grid-3" style={{ gridTemplateColumns: '1fr' }}>
              <div className="form-group">
                <label>Cardholder Name *</label>
                <input
                  type="text"
                  required
                  value={formData.cardholder_name}
                  onChange={(e) => setFormData({...formData, cardholder_name: e.target.value})}
                  disabled={isProcessing}
                  placeholder="Name on card"
                />
              </div>
            </div>
          )}

          {requiresCardDetails && (
            <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 2fr' }}>
              <div className="form-group">
                <label>Expiry Year *</label>
                <input 
                  type="number"
                  min="2024"
                  required
                  value={formData.expiry_year}
                  onChange={(e) => setFormData({...formData, expiry_year: e.target.value})}
                  disabled={isProcessing}
                  placeholder="YYYY"
                />
              </div>
            </div>
          )}

          <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '15px' }}>
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
          </div>

          <div className="form-section-title">Notes</div>
          <div className="form-group">
            <textarea
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

          <button 
            type="submit" 
            className="tool-btn primary" 
            style={{ width: '100%', marginTop: '20px' }}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Complete Check-In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CheckInModal;

