import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker, GreenTimePicker } from '../components/DateTimePickers.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Chamber, Department, Doctor, User } from '../types/index.ts';

interface StaffMetaResponse {
  departments: Department[];
  chambers: Chamber[];
  receptionists: User[];
}

interface StaffMemberResponse {
  member: Omit<User, 'doctor_profile'> & { doctor_profile: Doctor | null };
}

const WEEKDAY_CHOICES = [
  { val: 0, short: 'Mon' },
  { val: 1, short: 'Tue' },
  { val: 2, short: 'Wed' },
  { val: 3, short: 'Thu' },
  { val: 4, short: 'Fri' },
  { val: 5, short: 'Sat' },
  { val: 6, short: 'Sun' },
];

export default function StaffEditPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id && id !== 'new');
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [meta, setMeta] = useState<StaffMetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<'doctor' | 'receptionist' | 'admin'>('doctor');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameCheck, setUsernameCheck] = useState<{ valid: boolean; message: string } | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [nid, setNid] = useState('');
  const [address, setAddress] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [newPassword, setNewPassword] = useState('');

  // Doctor specific
  const [departmentId, setDepartmentId] = useState('');
  const [chamberId, setChamberId] = useState('');
  const [receptionistId, setReceptionistId] = useState('');
  const [designation, setDesignation] = useState('Consultant');
  const [qualifications, setQualifications] = useState('');
  const [consultationDays, setConsultationDays] = useState<number[]>([5, 0, 2]);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');

  useEffect(() => {
    const reqs: Promise<unknown>[] = [
      api.get<StaffMetaResponse>('/staff/meta').then((res) => {
        setMeta(res.data);
        if (!isEdit) {
          if (res.data.departments.length) setDepartmentId(String(res.data.departments[0].id));
          if (res.data.chambers.length) setChamberId(String(res.data.chambers[0].id));
          if (res.data.receptionists.length) {
            setReceptionistId(String(res.data.receptionists[0].id));
          }
        }
      }),
    ];

    if (isEdit) {
      reqs.push(
        api.get<StaffMemberResponse>(`/staff/${id}`).then((res) => {
          const m = res.data.member;
          setRole(m.role as 'doctor' | 'receptionist' | 'admin');
          setFirstName(m.first_name);
          setLastName(m.last_name);
          setUsername(m.username);
          setEmail(m.email);
          setPhone(m.phone);
          setDob(m.dob || '');
          setNid(m.nid);
          setAddress(m.address);
          setIsActive(m.is_active);
          if (m.doctor_profile) {
            setDepartmentId(String(m.doctor_profile.department_id));
            setChamberId(m.doctor_profile.chamber_id ? String(m.doctor_profile.chamber_id) : '');
            setReceptionistId(
              m.doctor_profile.assigned_receptionist_id
                ? String(m.doctor_profile.assigned_receptionist_id)
                : ''
            );
            setDesignation(m.doctor_profile.designation);
            setQualifications(m.doctor_profile.qualifications);
          }
        })
      );
    }

    Promise.all(reqs)
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Failed to load staff form.'), 'error');
        navigate('/staff');
      })
      .finally(() => setLoading(false));
  }, [id, isEdit, navigate, showToast]);

  const checkUsernameAvailability = async () => {
    const clean = username.trim();
    if (!clean) {
      setUsernameCheck(null);
      return;
    }
    try {
      const res = await api.get<{ valid: boolean; message: string }>(
        `/auth/check-username?username=${encodeURIComponent(clean)}&exclude_id=${isEdit ? id : ''}`
      );
      setUsernameCheck({ valid: res.data.valid, message: res.data.message });
    } catch {
      setUsernameCheck(null);
    }
  };

  const toggleDay = (d: number) => {
    setConsultationDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        role,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        dob: dob || undefined,
        nid: nid.trim(),
        address: address.trim(),
        is_active: isActive,
      };
      if (newPassword) payload.new_password = newPassword;

      if (role === 'doctor') {
        payload.department_id = departmentId;
        payload.chamber_id = chamberId || null;
        payload.assigned_receptionist_id = receptionistId || null;
        payload.designation = designation.trim();
        payload.qualifications = qualifications.trim();
        if (!isEdit) {
          payload.consultation_days = consultationDays;
          payload.consultation_start_time = startTime;
          payload.consultation_end_time = endTime;
        }
      }

      const res = isEdit
        ? await api.put<{ message: string }>(`/staff/${id}`, payload)
        : await api.post<{ message: string }>('/staff', payload);
      showToast(res.data.message, 'success');
      navigate('/staff');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not save staff account.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !meta) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  const selectedChamber = meta.chambers.find((c) => String(c.id) === chamberId) || null;

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STAFF &amp; SPECIALIST ACCOUNT</p>
          <h1>{isEdit ? 'Edit Staff Account' : 'Create Staff / Doctor Account'}</h1>
          <p>
            Configure login credentials, access role, and chamber assignments for hospital staff.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to="/staff">
            ← Back to Directory
          </Link>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="content-columns">
        <div className="panel" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Account Credentials &amp; Personal Details</h2>
          <div className="form-grid two-col">
            <div className="form-group">
              <label htmlFor="se-role">Staff Role</label>
              <select
                id="se-role"
                className="field-control"
                value={role}
                disabled={isEdit}
                onChange={(e) => setRole(e.target.value as 'doctor' | 'receptionist' | 'admin')}
              >
                <option value="doctor">Specialist Doctor</option>
                <option value="receptionist">Front-Desk Receptionist</option>
                <option value="admin">System Administrator</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="se-username">
                Username{' '}
                {usernameCheck && (
                  <small
                    style={{
                      color: usernameCheck.valid ? 'var(--forest)' : 'var(--red)',
                      marginLeft: 6,
                    }}
                  >
                    ({usernameCheck.message})
                  </small>
                )}
              </label>
              <input
                id="se-username"
                type="text"
                className="field-control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={checkUsernameAvailability}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="se-fname">First Name</label>
              <input
                id="se-fname"
                type="text"
                className="field-control"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="se-lname">Last Name</label>
              <input
                id="se-lname"
                type="text"
                className="field-control"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="se-email">Email Address</label>
              <input
                id="se-email"
                type="email"
                className="field-control"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="se-phone">Phone Number</label>
              <input
                id="se-phone"
                type="tel"
                className="field-control"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+88017XXXXXXXX"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="se-dob">Date of Birth</label>
              <GreenDatePicker id="se-dob" value={dob} onChange={setDob} isDob placeholder="Optional" />
            </div>

            <div className="form-group">
              <label htmlFor="se-nid">NID / Employee ID</label>
              <input
                id="se-nid"
                type="text"
                className="field-control"
                value={nid}
                onChange={(e) => setNid(e.target.value)}
              />
            </div>

            <div className="form-group full">
              <label htmlFor="se-address">Address</label>
              <input
                id="se-address"
                type="text"
                className="field-control"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="se-pw">
                {isEdit ? 'Reset Password (leave blank to keep)' : 'Initial Password'}
              </label>
              <input
                id="se-pw"
                type="password"
                className="field-control"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required={!isEdit}
                placeholder="Min 8 chars, letters + digits"
              />
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', paddingTop: 26 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Account Active
              </label>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 24, alignSelf: 'start' }}>
          {role === 'doctor' ? (
            <>
              <h2 style={{ marginTop: 0 }}>Doctor Clinical Assignment</h2>
              <div className="form-grid two-col">
                <div className="form-group full">
                  <label htmlFor="se-dept">Department</label>
                  <select
                    id="se-dept"
                    className="field-control"
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    required
                  >
                    {meta.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group full">
                  <label htmlFor="se-chamb">Consultation Chamber / Room</label>
                  <select
                    id="se-chamb"
                    className="field-control"
                    value={chamberId}
                    onChange={(e) => setChamberId(e.target.value)}
                    required
                  >
                    <option value="">Select chamber...</option>
                    {meta.chambers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.room_number} — {c.building} ({c.doctors_count ?? 0} assigned)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedChamber && selectedChamber.doctors && selectedChamber.doctors.length > 0 && (
                  <div className="form-group full">
                    <div className="notice notice-info">
                      <strong>Current Occupancy in {selectedChamber.room_number}:</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {selectedChamber.doctors.map((cd) => (
                          <li key={cd.id}>
                            {cd.name} ({cd.assigned_days_text || 'No fixed days'})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="form-group full">
                  <label htmlFor="se-rec">Assigned Receptionist</label>
                  <select
                    id="se-rec"
                    className="field-control"
                    value={receptionistId}
                    onChange={(e) => setReceptionistId(e.target.value)}
                    required
                  >
                    <option value="">Select receptionist...</option>
                    {meta.receptionists.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.display_name} (@{r.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="se-desig">Designation</label>
                  <input
                    id="se-desig"
                    type="text"
                    className="field-control"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="se-qual">Qualifications</label>
                  <input
                    id="se-qual"
                    type="text"
                    className="field-control"
                    value={qualifications}
                    onChange={(e) => setQualifications(e.target.value)}
                    placeholder="MBBS, FCPS..."
                  />
                </div>

                {!isEdit && (
                  <>
                    <div className="form-group full">
                      <label>Initial Consultation Days</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        {WEEKDAY_CHOICES.map((w) => (
                          <label
                            key={w.val}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '6px 10px',
                              border: '1px solid var(--line)',
                              borderRadius: 8,
                              cursor: 'pointer',
                              background: consultationDays.includes(w.val) ? 'var(--mint)' : '#fff',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={consultationDays.includes(w.val)}
                              onChange={() => toggleDay(w.val)}
                            />
                            {w.short}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label htmlFor="se-st">Session Start</label>
                      <GreenTimePicker id="se-st" value={startTime} onChange={setStartTime} />
                    </div>

                    <div className="form-group">
                      <label htmlFor="se-et">Session End</label>
                      <GreenTimePicker id="se-et" value={endTime} onChange={setEndTime} />
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Role Permissions</h2>
              <p className="muted">
                {role === 'admin'
                  ? 'System Administrators have full clinical governance, staff onboarding, refund sign-off, department, chamber, and audit access.'
                  : 'Receptionists manage patient bookings, cash collection desk, assigned doctor rosters, and cash refund disbursement.'}
              </p>
            </div>
          )}

          <button
            type="submit"
            className="button button-primary full"
            style={{ marginTop: 12 }}
            disabled={saving}
          >
            {saving ? 'Saving Account...' : isEdit ? 'Update Account' : 'Create Staff Account'}
          </button>
        </div>
      </form>
    </AppLayout>
  );
}
