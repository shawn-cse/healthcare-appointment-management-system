import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { User } from '../types/index.ts';

export default function ProfilePage() {
  const { user, setUserState } = useAuth();
  const { showToast } = useToast();

  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [usernameCheck, setUsernameCheck] = useState<{ valid: boolean; message: string } | null>(null);
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [dob, setDob] = useState(user?.dob || '');
  const [nid, setNid] = useState(user?.nid || '');
  const [address, setAddress] = useState(user?.address || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  // Doctor profile fields
  const [designation, setDesignation] = useState(user?.doctor_profile?.designation || '');
  const [qualifications, setQualifications] = useState(user?.doctor_profile?.qualifications || '');
  const [roomNumber, setRoomNumber] = useState(user?.doctor_profile?.room_number || '');
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const checkUsername = async () => {
    const clean = username.trim();
    if (!clean || clean === user.username) {
      setUsernameCheck(null);
      return;
    }
    try {
      const res = await api.get<{ valid: boolean; message: string }>(
        `/auth/check-username?username=${encodeURIComponent(clean)}&exclude_id=${user.id}`
      );
      setUsernameCheck({ valid: res.data.valid, message: res.data.message });
    } catch {
      setUsernameCheck(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('first_name', firstName.trim());
      formData.append('last_name', lastName.trim());
      formData.append('username', username.trim());
      formData.append('email', email.trim());
      formData.append('phone', phone.trim());
      formData.append('dob', dob);
      formData.append('nid', nid.trim());
      formData.append('address', address.trim());
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }
      if (user.role === 'doctor') {
        formData.append('designation', designation.trim());
        formData.append('qualifications', qualifications.trim());
        formData.append('room_number', roomNumber.trim());
      }

      const res = await api.put<{ user: User; message: string }>('/auth/profile', formData);
      setUserState(res.data.user);
      setAvatarFile(null);
      showToast(res.data.message, 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not update profile.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h1>My Profile</h1>
          <p>Update your personal contact details, portal username, and display photo.</p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to="/profile/password">
            Change Password
          </Link>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 820, padding: 24 }}>
        <form onSubmit={handleSubmit} className="form-grid two-col">
          <div className="form-group">
            <label htmlFor="pr-fname">First Name</label>
            <input
              id="pr-fname"
              type="text"
              className="field-control"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-lname">Last Name</label>
            <input
              id="pr-lname"
              type="text"
              className="field-control"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-user">
              Username{' '}
              {usernameCheck && (
                <small style={{ color: usernameCheck.valid ? 'var(--forest)' : 'var(--red)' }}>
                  ({usernameCheck.message})
                </small>
              )}
            </label>
            <input
              id="pr-user"
              type="text"
              className="field-control"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={checkUsername}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-email">Email</label>
            <input
              id="pr-email"
              type="email"
              className="field-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-phone">Phone Number</label>
            <input
              id="pr-phone"
              type="tel"
              className="field-control"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-dob">Date of Birth</label>
            <GreenDatePicker
              id="pr-dob"
              value={dob}
              onChange={setDob}
              isDob
              required={user.role === 'patient'}
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-nid">NID / Passport</label>
            <input
              id="pr-nid"
              type="text"
              className="field-control"
              value={nid}
              onChange={(e) => setNid(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-avatar">Profile Photo (Optional)</label>
            <input
              id="pr-avatar"
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="field-control"
              onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="form-group full">
            <label htmlFor="pr-addr">Address</label>
            <input
              id="pr-addr"
              type="text"
              className="field-control"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          {user.role === 'doctor' && (
            <>
              <div className="form-group">
                <label htmlFor="pr-desig">Clinical Designation</label>
                <input
                  id="pr-desig"
                  type="text"
                  className="field-control"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="pr-room">Chamber / Room Number</label>
                <input
                  id="pr-room"
                  type="text"
                  className="field-control"
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                />
              </div>
              <div className="form-group full">
                <label htmlFor="pr-qual">Qualifications</label>
                <input
                  id="pr-qual"
                  type="text"
                  className="field-control"
                  value={qualifications}
                  onChange={(e) => setQualifications(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="form-group full" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Saving Profile...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
