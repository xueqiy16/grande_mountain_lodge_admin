import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Password policy: at least 8 characters, and at least one number or special char.
const validatePassword = (pw) => {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[0-9!@#$%^&*(),.?":{}|<>_\-\[\]\\/;'`~+=]/.test(pw)) {
    return 'Password must include at least one number or special character.';
  }
  return '';
};

const labelStyle = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  marginBottom: '8px'
};

const inputStyle = {
  width: '100%',
  padding: '12px 44px 12px 16px',
  borderRadius: '12px',
  border: '1px solid #e2e8f0',
  fontSize: '16px',
  outline: 'none',
  boxSizing: 'border-box'
};

const toggleStyle = {
  position: 'absolute',
  right: '12px',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  color: '#64748b',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer'
};

const ResetPassword = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text }
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  // The Supabase client parses the recovery token from the URL and emits a
  // session on load; confirm one exists so the user knows the link is valid.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) setHasRecoverySession(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) setHasRecoverySession(true);
      if (event === 'PASSWORD_RECOVERY') setHasRecoverySession(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const policyError = newPassword ? validatePassword(newPassword) : '';
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = !policyError && !mismatch && newPassword.length > 0 && confirmPassword.length > 0 && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validatePassword(newPassword);
    if (err) { setFeedback({ type: 'error', text: err }); return; }
    if (newPassword !== confirmPassword) {
      setFeedback({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    // Password is verified here (policy + confirm match). On success, Supabase Auth
    // automatically dispatches the "Password changed" notification email — it is a
    // server-side trigger on the password-change event, so no extra client call is needed.
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setSubmitting(false);
      setFeedback({ type: 'error', text: `Update failed: ${error.message}` });
      return;
    }
    setFeedback({ type: 'success', text: 'Password updated successfully! Redirecting to login...' });
    setTimeout(() => navigate('/login', { replace: true }), 2000);
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f8fafc', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '440px', backgroundColor: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)', border: '1px solid #e2e8f0' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img src="/assets/logo.png" alt="Grande Mountain Lodge" style={{ height: '48px', marginBottom: '16px' }} />
          <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#1e293b', letterSpacing: '-0.025em', margin: 0 }}>Set New Password</h1>
          <p style={{ fontSize: '14px', color: '#64748b', marginTop: '8px' }}>Enter and confirm your new password for LodgeOS.</p>
        </div>

        {feedback && (
          <div style={{
            backgroundColor: feedback.type === 'error' ? '#fef2f2' : '#f0fdf4',
            color: feedback.type === 'error' ? '#991b1b' : '#166534',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '14px'
          }}>
            {feedback.text}
          </div>
        )}

        {!hasRecoverySession && !feedback && (
          <div style={{ backgroundColor: '#fffbeb', color: '#92400e', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px' }}>
            Open this page from the password recovery email link to reset your password.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={inputStyle}
                required
              />
              <button type="button" onClick={() => setShowNew(v => !v)} style={toggleStyle}>
                {showNew ? 'Hide' : 'Show'}
              </button>
            </div>
            {policyError && (
              <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>{policyError}</p>
            )}
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={labelStyle}>Confirm New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
                required
              />
              <button type="button" onClick={() => setShowConfirm(v => !v)} style={toggleStyle}>
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>
            {mismatch && (
              <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>Passwords do not match.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: canSubmit ? '#d97706' : '#e2e8f0',
              color: canSubmit ? 'white' : '#94a3b8',
              border: 'none',
              fontSize: '16px',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'background-color 0.2s'
            }}
          >
            {submitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
