import React, { useState, useEffect } from 'react';
import { ROOM_TYPE_PRESETS } from '../lib/constants';
import { calculateAmountPaid, roundToCents } from '../lib/payments';

// Tax rules mirror the rest of the app: computed strictly on the base room
// charge. Alberta Tourism Levy is exempt for long stays (>= 28 nights, i.e. the
// levy line only shows for stays of 27 days or less).
const GST_RATE = 0.05;
const TOURISM_LEVY_RATE = 0.06;
const LEVY_MAX_NIGHTS = 27;

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const moneySigned = (n) => (Number(n) < 0 ? `-$${Math.abs(Number(n)).toFixed(2)}` : money(n));

// snake_case / enum -> Title Case ("room_charge" -> "Room Charge",
// "pre_auth" -> "Pre Auth", "interac_debit" -> "Interac Debit").
const titleCase = (s) =>
  String(s || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'N/A';

const nightsBetween = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;
  const s = new Date(checkIn.slice(0, 10) + 'T00:00:00');
  const e = new Date(checkOut.slice(0, 10) + 'T00:00:00');
  const n = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return n > 0 ? n : 0;
};

const PrintableFolioModal = ({ booking, supabase, onClose }) => {
  // Seed from the embedded relations so the receipt renders instantly, then
  // refresh from the DB to guarantee the latest ledger + transactions.
  const [folioEntries, setFolioEntries] = useState(booking?.folio_entries || []);
  const [transactions, setTransactions] = useState(booking?.transactions || []);

  useEffect(() => {
    // State is seeded from the embedded relations via useState; this effect only
    // refreshes from the DB (async setState is fine). The modal remounts per
    // booking, so no synchronous re-seed is needed here.
    if (!booking || !supabase) return;
    let cancelled = false;
    (async () => {
      const [feRes, txRes] = await Promise.all([
        supabase.from('folio_entries').select('*').eq('booking_id', booking.booking_id).order('entry_date', { ascending: true }),
        supabase.from('transactions').select('*').eq('booking_id', booking.booking_id)
      ]);
      if (cancelled) return;
      if (feRes.data) setFolioEntries(feRes.data);
      if (txRes.data) setTransactions(txRes.data);
    })();
    return () => { cancelled = true; };
  }, [booking, supabase]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!booking) return null;

  const guest = booking.guests || {};
  const room = booking.rooms || {};
  const roomType = room.room_types || {};
  const roomCode = roomType.code || ROOM_TYPE_PRESETS[roomType.name]?.code || roomType.name || 'N/A';

  const checkIn = (booking.check_in || '').slice(0, 10);
  const checkOut = (booking.check_out || '').slice(0, 10);
  const nights = nightsBetween(checkIn, checkOut);

  // Base room charge uses the saved editable price, else the room type default.
  const rate = booking.room_price != null && booking.room_price !== ''
    ? Number(booking.room_price)
    : Number(roomType.nightly_rate || 0);
  const baseCharge = nights * rate;

  // Charge rows: derived base room charge first, then ledger items (tax entries
  // are excluded — GST/Levy are shown as summary lines below).
  const chargeRows = [
    { type: 'room_charge', description: `${nights} night${nights === 1 ? '' : 's'} x ${money(rate)}`, amount: baseCharge },
    ...folioEntries
      .filter((e) => e.entry_type !== 'tax')
      .map((e) => ({
        type: e.entry_type,
        description: e.description || '-',
        amount: e.entry_type === 'discount' ? -Number(e.amount || 0) : Number(e.amount || 0)
      }))
  ];

  const subtotal = roundToCents(chargeRows.reduce((a, r) => a + Number(r.amount || 0), 0));
  const gst = roundToCents(baseCharge * GST_RATE);
  const showLevy = nights > 0 && nights <= LEVY_MAX_NIGHTS;
  const tourismLevy = showLevy ? roundToCents(baseCharge * TOURISM_LEVY_RATE) : 0;
  const total = roundToCents(subtotal + gst + tourismLevy);

  // List non-voided transactions; Total Payment counts settled money only.
  const activeTxns = transactions.filter((t) => t.status !== 'voided' && t.transaction_type !== 'void');
  const totalPayment = roundToCents(calculateAmountPaid(transactions));
  const balance = roundToCents(total - totalPayment);

  return (
    <div className="print-folio-overlay" onClick={onClose}>
      <div className="print-folio" onClick={(e) => e.stopPropagation()}>
        {/* UI controls (hidden when printing) */}
        <div className="print-folio-toolbar print-no-print">
          <button type="button" className="tool-btn primary" onClick={() => window.print()}>Print Receipt</button>
          <button type="button" className="tool-btn" onClick={onClose}>Close</button>
        </div>

        <div className="print-doc">
          {/* Document header */}
          <div className="print-head">
            <h1>Grande Mountain Lodge</h1>
            <p>PO Box 628</p>
            <p>Grande Cache, Alberta</p>
            <p>T0E 0Y0</p>
            <p>Phone: 780-827-2007</p>
            <p>Email: reception@grandemountainlodge.com</p>
            <p>Website: https://grandemountainlodge.com</p>
          </div>
          <hr className="print-rule" />

          {/* Guest Folio info */}
          <h2 className="print-section-title">Guest Folio</h2>
          <div className="print-info-grid">
            <div><span className="print-k">Guest Name:</span> {`${guest.first_name || ''} ${guest.last_name || ''}`.trim() || 'N/A'}</div>
            <div><span className="print-k">Arrival Date:</span> {checkIn || 'N/A'}</div>
            <div><span className="print-k">Departure Date:</span> {checkOut || 'N/A'}</div>
            <div><span className="print-k">Room #:</span> {room.room_number ?? 'N/A'}</div>
            <div><span className="print-k">Room Type:</span> {roomCode}</div>
            <div><span className="print-k">Booking Ref:</span> {booking.booking_reference || booking.booking_id || 'N/A'}</div>
          </div>

          {/* Charges table */}
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Type</th>
                <th>Description</th>
                <th className="print-amt" style={{ width: '18%' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {chargeRows.map((r, i) => (
                <tr key={i}>
                  <td>{titleCase(r.type)}</td>
                  <td>{r.description}</td>
                  <td className="print-amt">{moneySigned(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <hr className="print-rule" />
          <div className="print-summary">
            <div className="print-summary-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="print-summary-row"><span>GST (5%)</span><span>{money(gst)}</span></div>
            {showLevy && (
              <div className="print-summary-row"><span>Alberta Tourism Levy (6%)</span><span>{money(tourismLevy)}</span></div>
            )}
            <hr className="print-rule" />
            <div className="print-summary-row print-total"><span>Total</span><span>{money(total)}</span></div>
          </div>

          {/* Transactions table */}
          <h2 className="print-section-title">Transactions</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Transaction Type</th>
                <th>Payment Method</th>
                <th className="print-amt" style={{ width: '18%' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {activeTxns.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center' }}>No transactions recorded.</td></tr>
              ) : activeTxns.map((t) => (
                <tr key={t.transaction_id || `${t.transaction_type}-${t.charged_at}`}>
                  <td>{titleCase(t.transaction_type)}</td>
                  <td>{titleCase(t.payment_method)}</td>
                  <td className="print-amt">{money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <hr className="print-rule" />
          <div className="print-summary">
            <div className="print-summary-row"><span>Total Payment</span><span>{money(totalPayment)}</span></div>
            <div className="print-summary-row print-total"><span>Balance</span><span>{money(balance)}</span></div>
          </div>

          {/* Footer */}
          <div className="print-signature">
            Signature: <span className="print-sign-line">&nbsp;</span>
          </div>
          <p className="print-slogan">
            Thank you for choosing Grande Mountain Lodge. Relax, we&apos;ve got you covered.
          </p>
          <div className="print-logo-wrap">
            <img src="/assets/logo.png" alt="Grande Mountain Lodge" className="print-logo" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintableFolioModal;
