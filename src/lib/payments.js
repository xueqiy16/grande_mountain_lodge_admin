// Round a currency value to two decimal places, correcting binary floating-point
// drift (e.g. 0.1 + 0.2) so balances never leave a phantom fraction of a cent.
// The single source of truth for currency rounding across the app.
export const roundToCents = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;

// Settled amount paid from a transaction list. Pre-authorizations and holds never
// affect the paid/outstanding balance; only settled purchases/completions count,
// refunds subtract, and voided rows are ignored entirely.
export const calculateAmountPaid = (transactions = []) => {
  return transactions.reduce((total, txn) => {
    // Skip voided transactions (soft-deleted via status = 'voided').
    if (txn?.status === 'voided') return total;

    // Only count settled payments (purchase, completion); subtract refunds.
    if (['purchase', 'completion'].includes(txn?.transaction_type)) {
      return total + (Number(txn?.amount) || 0);
    } else if (txn?.transaction_type === 'refund') {
      return total - (Number(txn?.amount) || 0);
    }

    // Exclude pre_auth / pre_auth_release (and any non-settled types).
    return total;
  }, 0);
};
