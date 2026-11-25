import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { useToast } from '../context/ToastContext.tsx';

export default function PasswordChangePage() {
  const { showToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post<{ message: string }>('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      showToast(res.data.message, 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not change password.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNT SECURITY</p>
          <h1>Change Password</h1>
          <p>Use a strong password containing at least 8 characters with letters and digits.</p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to="/profile">
            ← Back to Profile
          </Link>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 520, padding: 24 }}>
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-group">
            <label htmlFor="pw-cur">Current Password</label>
            <input
              id="pw-cur"
              type="password"
              className="field-control"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="pw-new">New Password</label>
            <input
              id="pw-new"
              type="password"
              className="field-control"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="pw-conf">Confirm New Password</label>
            <input
              id="pw-conf"
              type="password"
              className="field-control"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link className="button button-outline" to="/profile">
              Cancel
            </Link>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
