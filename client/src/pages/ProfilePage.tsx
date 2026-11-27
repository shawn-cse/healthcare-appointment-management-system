import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { User } from '../types/index.ts';

export default function ProfilePage() {
  const { user, setUserState, refreshMe } = useAuth();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState(user?.display_name || '');
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
  const [registration, setRegistration] = useState(user?.doctor_profile?.registration_number || '');
  const [experience, setExperience] = useState(user?.doctor_profile?.professional_experience || '');
  const [gender, setGender] = useState(user?.gender || '');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
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
      formData.append('full_name', fullName.trim());
      formData.append('username', username.trim());
      formData.append('email', email.trim());
      formData.append('phone', phone.trim());
      formData.append('dob', dob);
      formData.append('gender', gender);
      formData.append('nid', nid.trim());
      formData.append('address', address.trim());
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }
      if (user.role === 'doctor') {
        formData.append('designation', designation.trim());
        if (registration.trim()) formData.append('registration_number', registration.trim());
        formData.append('qualifications', qualifications.trim());
        formData.append('professional_experience', experience.trim());
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
          {user.age !== null && <p>Age {user.age}</p>}
          <p>Update your personal contact details, portal username, and display photo.</p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to="/profile/password">
            Change Password
          </Link>
        </div>
      </div>

      {user.role === 'patient' && <section className="panel padded-panel">
        <h2>Phone verification</h2>
        <p>{user.phone_verified ? 'Your phone is verified.' : 'Verify your saved phone number to link eligible past appointments.'}</p>
        {!user.phone_verified && <button className="button button-outline" type="button" onClick={async () => {
          try { await api.post('/auth/phone/send-code'); setCodeSent(true); showToast('Verification code sent.', 'success'); }
          catch (err) { showToast(getApiErrorMessage(err, 'Could not send the verification code.'), 'error'); }
        }}>Send verification code</button>}
        {codeSent && !user.phone_verified && <form className="form-grid" onSubmit={async (event) => {
          event.preventDefault();
          try {
            const { data } = await api.post<{ linked: number }>('/auth/phone/verify', { code });
            await refreshMe(); setCodeSent(false); showToast(`Phone verified. ${data.linked} historical appointments linked.`, 'success');
          } catch (err) { showToast(getApiErrorMessage(err, 'Could not verify the code.'), 'error'); }
        }}>
          <label className="form-group">Verification code<input className="field-control" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button className="button button-primary">Verify phone</button>
        </form>}
      </section>}
      <div className="panel" style={{ maxWidth: 820, padding: 24 }}>
        <form onSubmit={handleSubmit} className="form-grid two-col">
          <h2 className="form-group full">Personal Information</h2>
          <label className="form-group">Full Name
            <input className="field-control" required maxLength={150} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>

          <label className="form-group">Gender<select className="field-control" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Select gender</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
          </select></label>
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
            <label htmlFor="pr-email">
              Email {user.role !== 'patient' ? '' : '(Optional)'}
            </label>
            <input
              id="pr-email"
              type="email"
              className="field-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required={user.role !== 'patient'}
            />
          </div>

          <div className="form-group">
            <label htmlFor="pr-phone">
              Phone Number {user.role !== 'patient' ? '(Optional)' : ''}
            </label>
            <input
              id="pr-phone"
              type="tel"
              className="field-control"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required={user.role === 'patient'}
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
            <label htmlFor="pr-nid">NID</label>
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
              <h2 className="form-group full">Professional Information</h2>
              <label className="form-group">BMDC registration number
                <input className="field-control" maxLength={100} value={registration} onChange={(e) => setRegistration(e.target.value)} />
              </label>
              <div className="form-group"><span>Department</span><strong>{user.doctor_profile?.department_name || 'Unassigned'}</strong></div>
              <div className="form-group"><span>Assigned receptionist</span><strong>{user.doctor_profile?.receptionist_name || 'Unassigned'}</strong></div>
              <div className="form-group">
                <label htmlFor="pr-desig">Designation</label>
                <input
                  id="pr-desig"
                  type="text"
                  className="field-control"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="pr-room">Room No</label>
                <input
                  id="pr-room"
                  type="text"
                  className="field-control"
                  value={user.doctor_profile?.room_number || user.room_number || ''}
                  readOnly
                />
              </div>
              <h2 className="form-group full">Educational Qualifications &amp; Professional Experience</h2>
              <label className="form-group full">Professional experience
                <textarea className="field-control" rows={3} value={experience} onChange={(e) => setExperience(e.target.value)} />
              </label>
              <div className="form-group full">
                <label htmlFor="pr-qual">Education &amp; Qualifications</label>
                <textarea
                  id="pr-qual"
                  rows={3}
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
