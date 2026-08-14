import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import ConfirmDialog from './components/ConfirmDialog';
import { STAFF_MEMBERS, TRANSACTION_TYPES } from './lib/constants';
import { calculateAmountPaid } from './lib/payments';
const PaymentModal = ({
  isOpen,
  onClose,
  booking,
  onPaymentComplete,
  defaultTransactionType = 'completion',
  existingTransactions = []
}) => {
  // Stay total = nights * nightly rate (mirrors App.jsx logic).
  const calculateTotalBalance = (b) => {
    if (!b || !b.check_in || !b.check_out || !b.rooms?.room_types?.nightly_rate) return 0;
    const start = new Date(b.check_in + 'T00:00:00');
    const end = new Date(b.check_out + 'T00:00:00');
    const diffNights = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return Number(diffNights) * Number(b.rooms.room_types.nightly_rate);
  };

  // Prefer the stored total_price (reflects live folio subtotals: base + charges +
  // taxes − discounts). Fall back to nights × rate for legacy rows without it.
  const totalAmount = booking?.total_price != null
    ? Number(booking.total_price)
    : Number(calculateTotalBalance(booking));
  // Settled payments only — pre-authorizations never affect the paid/outstanding balance.
  const paidSourceTxns = existingTransactions?.length
    ? existingTransactions
    : (booking?.transactions || []);
  const amountPaid = calculateAmountPaid(paidSourceTxns);
  const outstandingBalance = totalAmount - amountPaid;

  const guestFullName = booking?.guests
    ? `${booking.guests.first_name || ''} ${booking.guests.last_name || ''}`.trim()
    : '';

  const blankForm = {
    transaction_type: defaultTransactionType,
    amount: '',
    payment_method: '',
    staff_member: '',
    cardholder_name: '',
    last4: '',
    auth_code: '',
    reference_number: '',
    e_transfer_reference: '',
    transaction_notes: ''
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [etransferError, setEtransferError] = useState(false);
  const [formData, setFormData] = useState(blankForm);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Dirty when any field diverges from the seeded baseline (type + cardholder prefill).
  const pristine = { ...blankForm, transaction_type: defaultTransactionType, cardholder_name: guestFullName };
  const isDirty = Object.keys(pristine).some(k => String(formData[k] ?? '') !== String(pristine[k] ?? ''));

  // Seed defaults (transaction type + cardholder pre-fill) when the modal opens.
  useEffect(() => {
    if (isOpen && booking) {
      setFormData({
        ...blankForm,
        transaction_type: defaultTransactionType,
        cardholder_name: guestFullName
      });
      setIsProcessing(false);
      setEtransferError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, booking, defaultTransactionType]);

  useEffect(() => {
    if (!isOpen) {
      setFormData(blankForm);
      setIsProcessing(false);
      setEtransferError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isEtransfer = formData.payment_method === 'e_transfer';
  const requiresCardDetails =
    formData.payment_method === 'visa' ||
    formData.payment_method === 'mastercard' ||
    formData.payment_method === 'amex';
  // Auth Code + Reference Number are manual documentation fields transcribed from the
  // physical Moneris terminal receipt. Shown for any terminal-processed card method.
  const showTerminalFields = requiresCardDetails || formData.payment_method === 'interac_debit';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!booking || isProcessing) return;

    const amount = Number(formData.amount);
    if (!amount || amount <= 0 || isNaN(amount)) {
      alert('Please enter a valid amount greater than 0.');
      return;
    }

    if (isEtransfer && !formData.e_transfer_reference.trim()) {
      setEtransferError(true);
      return;
    }

    // transaction_notes stored verbatim (no headers/append).
    const transactionNotes = formData.transaction_notes.trim() ? formData.transaction_notes : null;

    setIsProcessing(true);

    try {
      const payload = {
        booking_id: booking.booking_id,
        transaction_type: formData.transaction_type,
        status: 'completed',
        amount,
        payment_method: formData.payment_method,
        charged_at: new Date().toISOString(),
        staff_member: formData.staff_member || null,
        cardholder_name: requiresCardDetails ? (formData.cardholder_name.trim() || null) : null,
        last4: requiresCardDetails ? (formData.last4.trim() || null) : null,
        auth_code: showTerminalFields ? (formData.auth_code.trim() || null) : null,
        reference_number: showTerminalFields ? (formData.reference_number.trim() || null) : null,
        e_transfer_reference: isEtransfer ? formData.e_transfer_reference.trim() : null,
        transaction_notes: transactionNotes
      };

      // bookings.amount_paid is recomputed by the database trigger on insert
      // (transaction_type aware — handles purchase/refund/void correctly).
      const { error } = await supabase.from('transactions').insert([payload]);
      if (error) throw error;

      onPaymentComplete(`Transaction recorded: ${formData.transaction_type} $${amount.toFixed(2)}`);
      onClose();
    } catch (error) {
      alert(`Transaction failed: ${error.message}`);
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    if (isDirty) { setConfirmOpen(true); return; }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Transaction</h3>
          <button
            onClick={handleClose}
            className="close-drawer-btn"
            disabled={isProcessing}
            style={{ cursor: isProcessing ? 'not-allowed' : 'pointer', opacity: isProcessing ? 0.5 : 1 }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="walkin-form">
          {/* Read-only financial summary */}
          <div className="txn-summary">
            <div className="txn-summary-item">
              <span className="txn-summary-label">Total Amount</span>
              <span className="txn-summary-value">${totalAmount.toFixed(2)}</span>
            </div>
            <div className="txn-summary-item">
              <span className="txn-summary-label">Amount Paid</span>
              <span className="txn-summary-value">${amountPaid.toFixed(2)}</span>
            </div>
            <div className="txn-summary-item">
              <span className="txn-summary-label">Outstanding Balance</span>
              <span className="txn-summary-value" style={{ color: outstandingBalance > 0 ? '#ef4444' : '#10b981' }}>
                ${outstandingBalance.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-group">
              <label>Payment Method *</label>
              <select
                required
                value={formData.payment_method}
                onChange={(e) => {
                  setEtransferError(false);
                  setFormData({
                    ...formData,
                    payment_method: e.target.value,
                    // Reset method-specific fields on switch (keep cardholder pre-fill for cards).
                    last4: '', auth_code: '', reference_number: '', e_transfer_reference: '',
                    cardholder_name: guestFullName
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
              <label>Transaction Type *</label>
              <select
                required
                value={formData.transaction_type}
                onChange={(e) => setFormData({ ...formData, transaction_type: e.target.value })}
                disabled={isProcessing}
              >
                {TRANSACTION_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-group">
              <label>Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                disabled={isProcessing}
              />
            </div>
            <div className="form-group">
              <label>Staff Member</label>
              <select
                value={formData.staff_member}
                onChange={(e) => setFormData({ ...formData, staff_member: e.target.value })}
                disabled={isProcessing}
              >
                <option value="">Select staff member...</option>
                {STAFF_MEMBERS.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Card details + terminal documentation.
              Cardholder / Last 4 apply to Visa / Mastercard / Amex only; Auth Code and
              Reference Number are shown for those plus Interac Debit (manual entry from
              the physical Moneris terminal receipt — both optional). */}
          {showTerminalFields && (
            <>
              <div className="form-section-title" style={{ marginTop: '20px' }}>Card Details</div>
              {requiresCardDetails && (
                <>
                  <div className="form-group">
                    <label>Cardholder Name</label>
                    <input
                      type="text"
                      value={formData.cardholder_name}
                      onChange={(e) => setFormData({ ...formData, cardholder_name: e.target.value })}
                      disabled={isProcessing}
                      placeholder="Name on card"
                    />
                  </div>
                  <div className="form-grid-3">
                    <div className="form-group">
                      <label>Last 4 Digits *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={formData.last4}
                        onChange={(e) => setFormData({ ...formData, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        disabled={isProcessing}
                        placeholder="1234"
                      />
                    </div>
                  </div>
                </>
              )}
              <div className="form-grid-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="form-group">
                  <label>Auth Code</label>
                  <input
                    type="text"
                    value={formData.auth_code}
                    onChange={(e) => setFormData({ ...formData, auth_code: e.target.value })}
                    disabled={isProcessing}
                    placeholder="e.g. 123456"
                  />
                </div>
                <div className="form-group">
                  <label>Reference Number</label>
                  <input
                    type="text"
                    value={formData.reference_number}
                    onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                    disabled={isProcessing}
                    placeholder="e.g. 987654321"
                  />
                </div>
              </div>
            </>
          )}

          {/* E-Transfer reference */}
          {isEtransfer && (
            <div className="form-grid-3" style={{ gridTemplateColumns: '1fr' }}>
              <div className="form-group">
                <label>E-Transfer Reference Number *</label>
                <input
                  type="text"
                  value={formData.e_transfer_reference}
                  onChange={(e) => { setFormData({ ...formData, e_transfer_reference: e.target.value }); setEtransferError(false); }}
                  className={etransferError ? 'input-error' : ''}
                  aria-invalid={etransferError}
                  disabled={isProcessing}
                  placeholder="e.g. ETR-123456"
                />
                {etransferError && <p className="field-error-text">E-Transfer reference number is required.</p>}
              </div>
            </div>
          )}

          {/* Transaction notes */}
          <div className="form-section-title" style={{ marginTop: '20px' }}>Transaction Notes</div>
          <div className="form-group">
            <textarea
              rows={3}
              maxLength={500}
              placeholder="Add any transaction notes here..."
              value={formData.transaction_notes}
              onChange={(e) => setFormData({ ...formData, transaction_notes: e.target.value })}
              disabled={isProcessing}
              style={{ resize: 'vertical', width: '100%' }}
            />
            <p className="field-hint-text">{formData.transaction_notes.length}/500 characters</p>
          </div>

          <button
            type="submit"
            className="tool-btn primary"
            style={{ width: '100%', marginTop: '20px' }}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Save'}
          </button>
        </form>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onYes={() => { setConfirmOpen(false); onClose(); }}
        onNo={() => setConfirmOpen(false)}
      />
    </div>
  );
};

export default PaymentModal;
