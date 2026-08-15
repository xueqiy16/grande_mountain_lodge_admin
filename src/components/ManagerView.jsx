import React, { useState } from 'react';

const ROLE_OPTIONS = ['Manager', 'Front Desk', 'Housekeeping', 'Maintenance', 'Night Audit'];

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
};

const fullName = (s) => `${s.first_name || ''} ${s.last_name || ''}`.trim();

const blankStaffForm = () => ({ first_name: '', last_name: '', role: 'Front Desk' });

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

  const presentStaff = staffRecords.filter(s => s.is_active);
  const pastStaff = staffRecords.filter(s => !s.is_active);

  const openAdd = () => {
    setEditingStaff(null);
    setStaffForm(blankStaffForm());
    setStaffError('');
    setIsAddOpen(true);
  };

  const openEdit = (staff) => {
    setEditingStaff(staff);
    setStaffForm({ first_name: staff.first_name || '', last_name: staff.last_name || '', role: staff.role || 'Front Desk' });
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
    if (!staffForm.first_name.trim()) {
      setStaffError('First name is required.');
      return;
    }
    setSavingStaff(true);
    setStaffError('');
    const payload = {
      first_name: staffForm.first_name.trim(),
      last_name: staffForm.last_name.trim(),
      role: staffForm.role || 'Front Desk'
    };
    let error;
    if (editingStaff) {
      ({ error } = await supabase.from('staff').update(payload).eq('staff_id', editingStaff.staff_id));
    } else {
      ({ error } = await supabase.from('staff').insert([{ ...payload, is_active: true }]));
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
    const { error } = await supabase.from('staff').update({ is_active: isActive }).eq('staff_id', staff.staff_id);
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
          presentStaff.length > 0 ? (
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
                {presentStaff.map(s => (
                  <tr key={s.staff_id}>
                    <td><strong>{fullName(s)}</strong></td>
                    <td><span style={{ color: '#64748b' }}>{s.role || '—'}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                        <button className="tool-btn" onClick={() => openEdit(s)}>Edit</button>
                        <button className="tool-btn btn-danger" onClick={() => setActive(s, false)}>Deactivate</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-view">No active staff members. Add one to get started.</div>
          )
        ) : (
          pastStaff.length > 0 ? (
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
                {pastStaff.map(s => (
                  <tr key={s.staff_id}>
                    <td><strong style={{ color: '#94a3b8' }}>{fullName(s)}</strong></td>
                    <td><span style={{ color: '#94a3b8' }}>{s.role || '—'}</span></td>
                    <td style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}>{fmtDate(s.created_at)}</td>
                    <td>
                      <button className="tool-btn" onClick={() => setActive(s, true)}>Reactivate</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-view">No archived staff members.</div>
          )
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
                  <label>Last Name</label>
                  <input
                    value={staffForm.last_name}
                    onChange={(e) => setStaffForm({ ...staffForm, last_name: e.target.value })}
                  />
                </div>
              </div>
              <div className="detail-field">
                <label>Role / Position</label>
                <select
                  value={staffForm.role}
                  onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                >
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
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
