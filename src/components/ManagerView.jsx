import React, { useState } from 'react';

// Position ENUM mapping (label shown in UI -> stored public.staff_member.position value).
const POSITION_OPTIONS = [
  { value: 'manager', label: 'Manager' },
  { value: 'assistant_manager', label: 'Assistant Manager' },
  { value: 'front_desk', label: 'Front Desk' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'housekeeping_part_time', label: 'Housekeeping (Part Time)' },
  { value: 'other', label: 'Other' }
];

// Resolve the human-readable label for a stored position enum value. For 'other'
// the manager-entered custom description takes precedence.
const positionLabel = (value, other) => {
  if (!value) return '—';
  if (value === 'other') return other || 'Other';
  return POSITION_OPTIONS.find(o => o.value === value)?.label || value;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
};

// Canonical staff display name: First [Middle ]Last (e.g. "Jadeyn JF Fulop-Gueutal").
export const staffDisplayName = (s) => {
  if (!s) return '';
  const mid = s.middle_name ? `${s.middle_name} ` : '';
  return `${s.first_name || ''} ${mid}${s.last_name || ''}`.replace(/\s+/g, ' ').trim();
};

const blankStaffForm = () => ({
  first_name: '',
  middle_name: '',
  last_name: '',
  hire_date: '',
  position: '',
  other_position: '',
  second_position: '',
  other_second_position: '',
  hourly_pay: '',
  staff_notes: ''
});

const ManagerView = ({ supabase, staffRecords = [], refreshStaff, websiteDiscount = 0, onSaveDiscount }) => {
  const [staffTab, setStaffTab] = useState('present'); // 'present' | 'past'
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null); // staff row being edited
  const [staffForm, setStaffForm] = useState(blankStaffForm());
  const [savingStaff, setSavingStaff] = useState(false);
  const [staffError, setStaffError] = useState('');

  // Discount editor state
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [discountDraft, setDiscountDraft] = useState(String(websiteDiscount ?? 0));
  const [savingDiscount, setSavingDiscount] = useState(false);

  // Present = active staff (is_active === true); Past = archived (is_active === false).
  const presentStaff = staffRecords.filter(s => s.is_active === true);
  const pastStaff = staffRecords.filter(s => s.is_active === false);

  const openAdd = () => {
    setEditingStaff(null);
    setStaffForm(blankStaffForm());
    setStaffError('');
    setIsAddOpen(true);
  };

  const openEdit = (staff) => {
    setEditingStaff(staff);
    setStaffForm({
      first_name: staff.first_name || '',
      middle_name: staff.middle_name || '',
      last_name: staff.last_name || '',
      hire_date: (staff.hire_date || '').slice(0, 10),
      position: staff.position || '',
      other_position: staff.other_position || '',
      second_position: staff.second_position || '',
      other_second_position: staff.other_second_position || '',
      hourly_pay: staff.hourly_pay != null ? String(staff.hourly_pay) : '',
      staff_notes: staff.staff_notes || ''
    });
    setStaffError('');
    setIsAddOpen(true);
  };

  const closeStaffModal = () => {
    if (savingStaff) return;
    setIsAddOpen(false);
    setEditingStaff(null);
    setStaffForm(blankStaffForm());
    setStaffError('');
  };

  const saveStaff = async () => {
    // Required fields: first_name, last_name, position (all NOT NULL).
    if (!staffForm.first_name.trim() || !staffForm.last_name.trim() || !staffForm.position) {
      setStaffError('First name, last name, and position are required.');
      return;
    }
    // "Other" positions require a custom description.
    if (staffForm.position === 'other' && !staffForm.other_position.trim()) {
      setStaffError('Please describe the position for "Other".');
      return;
    }
    if (staffForm.second_position === 'other' && !staffForm.other_second_position.trim()) {
      setStaffError('Please describe the second position for "Other".');
      return;
    }
    setSavingStaff(true);
    setStaffError('');
    const payload = {
      first_name: staffForm.first_name.trim(),
      middle_name: staffForm.middle_name?.trim() || null,
      last_name: staffForm.last_name.trim(),
      hire_date: staffForm.hire_date || null,
      position: staffForm.position,
      other_position: staffForm.position === 'other' ? staffForm.other_position.trim() : null,
      second_position: staffForm.second_position || null,
      other_second_position: staffForm.second_position === 'other' ? staffForm.other_second_position.trim() : null,
      hourly_pay: staffForm.hourly_pay ? parseFloat(staffForm.hourly_pay) : null,
      staff_notes: staffForm.staff_notes?.trim() || null
    };
    let error;
    if (editingStaff) {
      ({ error } = await supabase.from('staff_member').update(payload).eq('staff_id', editingStaff.staff_id));
    } else {
      ({ error } = await supabase.from('staff_member').insert([{ ...payload, is_active: true }]));
    }
    setSavingStaff(false);
    if (error) {
      setStaffError(error.message || 'Failed to save staff member.');
      return;
    }
    await refreshStaff?.();
    closeStaffModal();
  };

  const setActive = async (staff, isActive) => {
    const { error } = await supabase.from('staff_member').update({ is_active: isActive }).eq('staff_id', staff.staff_id);
    if (error) {
      alert(error.message || 'Failed to update staff member.');
      return;
    }
    await refreshStaff?.();
  };

  const startEditDiscount = () => {
    setDiscountDraft(String(websiteDiscount ?? 0));
    setEditingDiscount(true);
  };

  const saveDiscount = async () => {
    const value = Number(discountDraft);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      alert('Please enter a discount percentage between 0 and 100.');
      return;
    }
    setSavingDiscount(true);
    const ok = await onSaveDiscount?.(value);
    setSavingDiscount(false);
    if (ok !== false) setEditingDiscount(false);
  };

  const renderStaffTable = (rows, past) => (
    <table className="pms-table">
      <thead>
        <tr>
          <th style={{ width: '34%' }}>Staff Name</th>
          <th style={{ width: '26%' }}>Role / Position</th>
          <th style={{ width: '20%' }}>Date Added</th>
          <th style={{ width: '20%', minWidth: '180px' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(s => (
          <tr key={s.staff_id}>
            <td><strong style={past ? { color: '#94a3b8' } : undefined}>{staffDisplayName(s)}</strong></td>
            <td><span style={{ color: past ? '#94a3b8' : '#64748b' }}>
              {positionLabel(s.position, s.other_position)}
              {s.second_position ? ` / ${positionLabel(s.second_position, s.other_second_position)}` : ''}
            </span></td>
            <td style={{ whiteSpace: 'nowrap', color: past ? '#94a3b8' : undefined }}>{fmtDate(s.created_at)}</td>
            <td>
              {past ? (
                <button className="tool-btn" onClick={() => setActive(s, true)}>Reactivate</button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                  <button className="tool-btn" onClick={() => openEdit(s)}>Edit</button>
                  <button className="tool-btn btn-danger" onClick={() => setActive(s, false)}>Deactivate</button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="folio-view manager-view">
      <div className="view-header">
        <h2>Manager</h2>
      </div>

      {/* ============================ STAFF MANAGEMENT ============================ */}
      <section className="manager-section">
        <div className="manager-section-head">
          <h3>Staff Management</h3>
          {staffTab === 'present' && (
            <button className="tool-btn primary" onClick={openAdd}>+ Add Staff Member</button>
          )}
        </div>

        <div className="manager-subtabs">
          <button
            className={`manager-subtab ${staffTab === 'present' ? 'active' : ''}`}
            onClick={() => setStaffTab('present')}
          >
            Present ({presentStaff.length})
          </button>
          <button
            className={`manager-subtab ${staffTab === 'past' ? 'active' : ''}`}
            onClick={() => setStaffTab('past')}
          >
            Past ({pastStaff.length})
          </button>
        </div>

        {staffTab === 'present' ? (
          presentStaff.length > 0
            ? renderStaffTable(presentStaff, false)
            : <div className="empty-view">No active staff members. Add one to get started.</div>
        ) : (
          pastStaff.length > 0
            ? renderStaffTable(pastStaff, true)
            : <div className="empty-view">No archived staff members.</div>
        )}
      </section>

      {/* ============================ DISCOUNT CONFIG ============================ */}
      <section className="manager-section">
        <div className="manager-section-head">
          <h3>Discount</h3>
        </div>
        <div className="discount-config">
          <label className="discount-label" htmlFor="website-discount">Motel website discount:</label>
          <div className="discount-input-wrap">
            <input
              id="website-discount"
              type="number"
              min="0"
              max="100"
              step="1"
              className="discount-input"
              value={editingDiscount ? discountDraft : (websiteDiscount ?? 0)}
              onChange={(e) => setDiscountDraft(e.target.value)}
              readOnly={!editingDiscount}
              disabled={!editingDiscount}
            />
            <span className="discount-suffix">%</span>
          </div>
          {editingDiscount ? (
            <button className="tool-btn discount-save" onClick={saveDiscount} disabled={savingDiscount}>
              {savingDiscount ? 'Saving…' : 'Save'}
            </button>
          ) : (
            <button className="tool-btn" onClick={startEditDiscount}>Edit</button>
          )}
        </div>
        <p className="discount-helper">
          This discount applies to reservations made through the Grande Mountain Lodge Website.
          It is applied as a {Number(websiteDiscount ?? 0)}% discount off of the total taxed room price.
        </p>
      </section>

      {/* ============================ ADD / EDIT STAFF MODAL ============================ */}
      {isAddOpen && (
        <div className="modal-overlay" onClick={closeStaffModal}>
          <div className="modal-content manager-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}</h3>
              <button className="close-drawer-btn" onClick={closeStaffModal} aria-label="Close">✕</button>
            </div>
            <div className="manager-modal-body">
              <div className="detail-grid">
                <div className="detail-field">
                  <label>First Name *</label>
                  <input
                    value={staffForm.first_name}
                    onChange={(e) => setStaffForm({ ...staffForm, first_name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div className="detail-field">
                  <label>Middle Name</label>
                  <input
                    value={staffForm.middle_name}
                    onChange={(e) => setStaffForm({ ...staffForm, middle_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="detail-grid">
                <div className="detail-field">
                  <label>Last Name *</label>
                  <input
                    value={staffForm.last_name}
                    onChange={(e) => setStaffForm({ ...staffForm, last_name: e.target.value })}
                  />
                </div>
                <div className="detail-field">
                  <label>Hire Date</label>
                  <input
                    type="date"
                    value={staffForm.hire_date}
                    onChange={(e) => setStaffForm({ ...staffForm, hire_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="detail-grid">
                <div className="detail-field">
                  <label>Position *</label>
                  <select
                    value={staffForm.position}
                    onChange={(e) => {
                      const position = e.target.value;
                      // Clear the custom description whenever it's no longer "Other".
                      setStaffForm({ ...staffForm, position, other_position: position === 'other' ? staffForm.other_position : '' });
                    }}
                  >
                    <option value="">Select Position</option>
                    {POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="detail-field">
                  <label>Second Position</label>
                  <select
                    value={staffForm.second_position}
                    onChange={(e) => {
                      const second_position = e.target.value;
                      setStaffForm({ ...staffForm, second_position, other_second_position: second_position === 'other' ? staffForm.other_second_position : '' });
                    }}
                  >
                    <option value="">None</option>
                    {POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {(staffForm.position === 'other' || staffForm.second_position === 'other') && (
                <div className="detail-grid">
                  {staffForm.position === 'other' ? (
                    <div className="detail-field">
                      <label>Position Description *</label>
                      <input
                        value={staffForm.other_position}
                        onChange={(e) => setStaffForm({ ...staffForm, other_position: e.target.value })}
                        placeholder="Describe the position"
                      />
                    </div>
                  ) : <div className="detail-field" />}
                  {staffForm.second_position === 'other' && (
                    <div className="detail-field">
                      <label>Second Position Description *</label>
                      <input
                        value={staffForm.other_second_position}
                        onChange={(e) => setStaffForm({ ...staffForm, other_second_position: e.target.value })}
                        placeholder="Describe the second position"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="detail-grid">
                <div className="detail-field">
                  <label>Hourly Pay ($ CAD / hr)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 21.50"
                    value={staffForm.hourly_pay}
                    onChange={(e) => setStaffForm({ ...staffForm, hourly_pay: e.target.value })}
                  />
                </div>
                <div className="detail-field" />
              </div>

              <div className="detail-field full-span">
                <label>Staff Notes</label>
                <textarea
                  rows={3}
                  maxLength={500}
                  placeholder="Add any notes for this staff member..."
                  value={staffForm.staff_notes}
                  onChange={(e) => setStaffForm({ ...staffForm, staff_notes: e.target.value })}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              {staffError && <div className="form-error" style={{ color: '#ef4444', fontSize: '0.85rem' }}>{staffError}</div>}

              <div className="manager-modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button className="tool-btn" onClick={closeStaffModal} disabled={savingStaff}>Cancel</button>
                <button className="tool-btn primary" onClick={saveStaff} disabled={savingStaff}>
                  {savingStaff ? 'Saving…' : (editingStaff ? 'Save Changes' : 'Add Staff Member')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerView;
