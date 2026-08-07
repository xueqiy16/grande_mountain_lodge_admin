import React from 'react';

// Small yes/no confirmation used by the "unsaved changes" guard across modals.
// Renders above other modals via a high z-index overlay.
const ConfirmDialog = ({
  open,
  message = 'Are you sure you want to quit without saving changes?',
  yesLabel = 'Yes',
  noLabel = 'No',
  onYes,
  onNo
}) => {
  if (!open) return null;
  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog">
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="tool-btn" onClick={onNo}>{noLabel}</button>
          <button type="button" className="tool-btn primary" onClick={onYes}>{yesLabel}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
