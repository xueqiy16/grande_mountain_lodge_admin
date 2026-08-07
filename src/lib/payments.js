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
