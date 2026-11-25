import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker, GreenTimePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Chamber, Department, Doctor, User } from '../types/index.ts';

interface StaffRow extends Omit<User, 'doctor_profile'> {
  doctor_profile: Doctor | null;
  assigned_doctors_count: number;
}

interface StaffListResponse {
  staff: StaffRow[];
  counts: { all: number; doctor: number; receptionist: number; admin: number };
  total: number;
  page: number;
  total_pages: number;
}

interface StaffMetaResponse {
  departments: Department[];
  chambers: Chamber[];
  receptionists: User[];
}

const WEEKDAY_CHOICES = [
  { val: 0, short: 'Mon', name: 'Monday' },
  { val: 1, short: 'Tue', name: 'Tuesday' },
  { val: 2, short: 'Wed', name: 'Wednesday' },
  { val: 3, short: 'Thu', name: 'Thursday' },
  { val: 4, short: 'Fri', name: 'Friday' },
  { val: 5, short: 'Sat', name: 'Saturday' },
  { val: 6, short: 'Sun', name: 'Sunday' },
];

export default function StaffListPage({ initialCreate = false }: { initialCreate?: boolean }) {
  const { user, refreshMe } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const { id: routeEditId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const roleFilter = searchParams.get('role') || '';
  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'name';
  const page = Number(searchParams.get('page') || 1) || 1;

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [meta, setMeta] = useState<StaffMetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Unified Editor Modal State (Create or Edit right on this single page)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editDoctorProfileId, setEditDoctorProfileId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [role, setRole] = useState<'doctor' | 'receptionist' | 'admin'>('doctor');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [nid, setNid] = useState('');
  const [address, setAddress] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [chamberId, setChamberId] = useState('');

  // Live uniqueness indicators
  const [usernameCheck, setUsernameCheck] = useState<{ valid: boolean; message: string } | null>(
    null
  );
  const [emailCheck, setEmailCheck] = useState<{ valid: boolean; message: string } | null>(null);

  // Doctor specific fields
  const [departmentId, setDepartmentId] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [receptionistId, setReceptionistId] = useState('');
  const [designation, setDesignation] = useState('Consultant');
  const [qualifications, setQualifications] = useState('');
  const [consultationDays, setConsultationDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');

  const isAdmin = user?.role === 'admin';

  const loadMeta = useCallback(() => {
    if (!isAdmin) return Promise.resolve();
    return api
      .get<StaffMetaResponse>('/staff/meta')
      .then((res) => setMeta(res.data))
      .catch(() => {});
  }, [isAdmin]);

  const loadStaff = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (roleFilter) params.set('role', roleFilter);
    if (q) params.set('q', q);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));

    api
      .get<StaffListResponse>(`/staff?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load staff roster.'), 'error'))
      .finally(() => setLoading(false));
  }, [roleFilter, q, sort, page, showToast]);

  useEffect(() => {
    loadStaff();
    loadMeta();
  }, [loadStaff, loadMeta]);

  const openCreateModal = useCallback(() => {
    loadMeta();
    setEditUserId(null);
    setEditDoctorProfileId(null);
    setRole('doctor');
    setName('');
    setUsername('');
    setEmail('');
    setPhone('');
    setDob('');
    setNid('');
    setAddress('');
    setIsActive(true);
    setPassword('');
    setChamberId('');
    setDepartmentId('');
    setGender('male');
    setReceptionistId('');
    setDesignation('Consultant');
    setQualifications('');
    setConsultationDays([5, 0, 2]);
    setStartTime('18:00');
    setEndTime('21:00');
    setUsernameCheck(null);
    setEmailCheck(null);
    setEditorOpen(true);
  }, [loadMeta]);

  const openEditModal = useCallback(
    (m: StaffRow) => {
      loadMeta();
      setEditUserId(m.id);
      setEditDoctorProfileId(m.doctor_profile?.id ?? null);
      setRole(m.role as 'doctor' | 'receptionist' | 'admin');
      setName(m.display_name || `${m.first_name} ${m.last_name}`.trim());
      setUsername(m.username);
      setEmail(m.email || '');
      setPhone(m.phone || '');
      setDob(m.dob || '');
      setNid(m.nid || '');
      setAddress(m.address || '');
      setIsActive(m.is_active);
      setPassword('');
      const resolvedChamber = m.doctor_profile?.chamber_id ?? m.chamber_id ?? null;
      setChamberId(resolvedChamber ? String(resolvedChamber) : '');
      setDepartmentId(m.doctor_profile?.department_id ? String(m.doctor_profile.department_id) : '');
      setGender(m.doctor_profile?.gender || 'male');
      setReceptionistId(
        m.doctor_profile?.assigned_receptionist_id
          ? String(m.doctor_profile.assigned_receptionist_id)
          : ''
      );
      setDesignation(m.doctor_profile?.designation || 'Consultant');
      setQualifications(m.doctor_profile?.qualifications || '');

      const weekly = m.doctor_profile?.weekly || [];
      if (weekly.length > 0) {
        setConsultationDays(Array.from(new Set(weekly.map((w) => w.weekday))));
        setStartTime(weekly[0].start_time.slice(0, 5));
        setEndTime(weekly[0].end_time.slice(0, 5));
      } else {
        setConsultationDays(m.doctor_profile?.assigned_days_list || []);
        setStartTime('18:00');
        setEndTime('21:00');
      }
      setUsernameCheck(null);
      setEmailCheck(null);
      setEditorOpen(true);
    },
    [loadMeta]
  );

  // Support deep links /staff/new and /staff/:id in the single unified page
  useEffect(() => {
    if (!isAdmin) return;
    if (initialCreate) {
      openCreateModal();
      return;
    }
    if (routeEditId && /^\d+$/.test(routeEditId)) {
      api
        .get<{ member: StaffRow }>(`/staff/${routeEditId}`)
        .then((res) => openEditModal(res.data.member))
        .catch(() => navigate('/staff', { replace: true }));
    }
  }, [initialCreate, routeEditId, isAdmin, openCreateModal, openEditModal, navigate]);

  // Live debounced Username uniqueness check
  useEffect(() => {
    if (!editorOpen) return;
    const clean = username.trim();
    if (!clean) {
      setUsernameCheck({ valid: false, message: 'Username is required' });
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ valid: boolean; message: string }>(
          `/auth/check-username?username=${encodeURIComponent(clean)}&exclude_id=${editUserId || ''}`
        )
        .then((res) => setUsernameCheck({ valid: res.data.valid, message: res.data.message }))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [username, editUserId, editorOpen]);

  // Live debounced Email uniqueness check
  useEffect(() => {
    if (!editorOpen) return;
    const clean = email.trim();
    if (!clean) {
      setEmailCheck({ valid: false, message: 'Email is required for staff' });
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ valid: boolean; message: string }>(
          `/auth/check-email?email=${encodeURIComponent(clean)}&exclude_id=${editUserId || ''}`
        )
        .then((res) => setEmailCheck({ valid: res.data.valid, message: res.data.message }))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [email, editUserId, editorOpen]);

  const selectedRoom = useMemo(
    () => meta?.chambers.find((c) => String(c.id) === chamberId) || null,
    [meta, chamberId]
  );

  // Other doctors sitting in the chosen room (excluding the doctor currently being edited)
  const otherDoctorsInRoom = useMemo(() => {
    if (!selectedRoom?.doctors) return [];
    return selectedRoom.doctors.filter((d) =>
      editDoctorProfileId ? d.id !== editDoctorProfileId : true
    );
  }, [selectedRoom, editDoctorProfileId]);

  const otherStaffInRoom = useMemo(() => {
    if (!selectedRoom?.staff_users) return [];
    return selectedRoom.staff_users.filter((s) => (editUserId ? s.id !== editUserId : true));
  }, [selectedRoom, editUserId]);

  // Live schedule conflict check when configuring doctor room + days + times
  const liveScheduleConflict = useMemo(() => {
    if (role !== 'doctor' || !chamberId || !isActive || consultationDays.length === 0) return null;
    if (!startTime || !endTime || endTime <= startTime) return null;

    for (const doc of otherDoctorsInRoom) {
      for (const sched of doc.schedules || []) {
        if (!consultationDays.includes(sched.weekday)) continue;
        if (startTime < sched.end_time && endTime > sched.start_time) {
          return `Conflict with ${doc.name} on ${sched.weekday_name} (${sched.start_time_12h} – ${sched.end_time_12h}).`;
        }
      }
    }
    return null;
  }, [role, chamberId, isActive, consultationDays, startTime, endTime, otherDoctorsInRoom]);

  const closeEditor = () => {
    setEditorOpen(false);
    if (initialCreate || routeEditId) {
      navigate('/staff', { replace: true });
    }
  };

  const handleToggleActive = async (m: StaffRow) => {
    if (m.id === user?.id) return;
    const actionVerb = m.is_active ? 'Deactivate' : 'Activate';
    const ok = await confirm({
      title: `${actionVerb} Account`,
      message: m.is_active
        ? `Deactivate ${m.display_name} (@${m.username})? They will no longer be able to sign in${m.role === 'doctor' ? ' or receive public bookings' : ''}.`
        : `Re-activate ${m.display_name} (@${m.username}) so they can sign in cleanly?`,
      confirmText: actionVerb,
      type: m.is_active ? 'danger' : 'info',
    });
    if (!ok) return;
    setTogglingId(m.id);
    try {
      const res = await api.post<{ message: string }>(`/staff/${m.id}/toggle-active`);
      showToast(res.data.message, 'success');
      loadStaff();
      loadMeta();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not change account status.'), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameCheck && !usernameCheck.valid) {
      showToast(usernameCheck.message, 'error');
      return;
    }
    if (emailCheck && !emailCheck.valid) {
      showToast(emailCheck.message, 'error');
      return;
    }
    if (liveScheduleConflict) {
      showToast(liveScheduleConflict, 'error');
      return;
    }
    if (role === 'doctor' && consultationDays.length > 0 && endTime <= startTime) {
      showToast('Consultation end time must be later than start time.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        role,
        name: name.trim(),
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        dob: dob || '',
        nid: nid.trim(),
        address: address.trim(),
        is_active: isActive,
        chamber_id: chamberId || null,
      };
      if (password) payload.new_password = password;

      if (role === 'doctor') {
        payload.department_id = departmentId || null;
        payload.gender = gender;
        payload.assigned_receptionist_id = receptionistId || null;
        payload.designation = designation.trim();
        payload.qualifications = qualifications.trim();
        payload.consultation_days = consultationDays;
        payload.consultation_start_time = startTime;
        payload.consultation_end_time = endTime;
      }

      const res = editUserId
        ? await api.put<{ message: string }>(`/staff/${editUserId}`, payload)
        : await api.post<{ message: string }>('/staff', payload);
      showToast(res.data.message, 'success');
      if (editUserId && user && editUserId === user.id) {
        await refreshMe();
      }
      closeEditor();
      loadStaff();
      loadMeta();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not save staff account.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (d: number) => {
    setConsultationDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in updates)) next.set('page', '1');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Instant live typing search (no Search / Apply / Reset buttons needed)
  useEffect(() => {
    const clean = searchInput.trim();
    if (clean === q) return;
    const timer = window.setTimeout(() => {
      setParam({ q: clean || null });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchInput, q, setParam]);

  const counts = data?.counts || { all: 0, doctor: 0, receptionist: 0, admin: 0 };

  return (
    <AppLayout>
      <div className="staff-directory-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">CLINICAL ROSTER &amp; ACCOUNTS</p>
            <h1>Staff &amp; Doctor Management</h1>
            <p>
              Onboard doctors, receptionists, and administrators, assign rooms without schedule
              conflicts, and control portal access from one unified console.
            </p>
          </div>
          {isAdmin && (
            <div className="heading-actions">
              <button type="button" className="button button-primary" onClick={openCreateModal}>
                <Icon id="ic-plus" /> Onboard Staff / Doctor
              </button>
            </div>
          )}
        </div>

        {/* Instant Role Filter Pills */}
        <div className="filter-tabs" style={{ marginBottom: 14 }}>
          {[
            ['', `All (${counts.all})`],
            ['doctor', `Doctor (${counts.doctor})`],
            ['receptionist', `Receptionist (${counts.receptionist})`],
            ['admin', `Administrator (${counts.admin})`],
          ].map(([val, lbl]) => (
            <button
              key={val || 'all'}
              type="button"
              className={`filter-tab ${roleFilter === val ? 'active' : ''}`}
              onClick={() => setParam({ role: val || null })}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Excel Sheet Roster Panel */}
        <div className="excel-sheet-panel">
          <div className="excel-sheet-header-bar">
            <div className="staff-live-toolbar">
              <div className="staff-live-search-wrap">
                <Icon id="ic-search" className="icon search-ic" />
                <input
                  type="text"
                  className="field-control"
                  placeholder="Type to filter by name, username, room no, email, phone, department..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  autoComplete="off"
                />
                {searchInput && (
                  <button
                    type="button"
                    className="staff-live-search-clear"
                    title="Clear search"
                    onClick={() => setSearchInput('')}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="sheet-indicator">
                  <span className="live-dot-pulse" />
                  <span>
                    Showing <strong>{data?.staff.length ?? 0}</strong> of{' '}
                    <strong>{data?.total ?? 0}</strong> accounts
                  </span>
                </div>
                <select
                  className="field-control"
                  style={{ width: 'auto', paddingTop: 7, paddingBottom: 7 }}
                  value={sort}
                  onChange={(e) => setParam({ sort: e.target.value })}
                  aria-label="Sort staff list"
                >
                  <option value="name">Sort: Name</option>
                  <option value="username">Sort: Username</option>
                  <option value="role">Sort: Role</option>
                  <option value="recent">Sort: Newest</option>
                </select>
              </div>
            </div>
          </div>

          {loading && !data ? (
            <LoadingScreen />
          ) : !data || data.staff.length === 0 ? (
            <div className="empty-state" style={{ padding: 48 }}>
              <h3>No staff accounts matched</h3>
              <p className="muted">Try typing another keyword or selecting All above.</p>
            </div>
          ) : (
            <div className="excel-table-wrap">
              <table className="excel-grid-table">
                <colgroup>
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name &amp; Username</th>
                    <th>Room No</th>
                    <th>Role</th>
                    <th>Contact</th>
                    <th>Clinical Assignment</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((m) => {
                    const roomLabel = m.room_number || m.doctor_profile?.active_room || '';
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="person-name">{m.display_name}</div>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>
                            @{m.username}
                            {m.doctor_profile?.designation
                              ? ` · ${m.doctor_profile.designation}`
                              : ''}
                          </div>
                        </td>
                        <td>
                          {roomLabel ? (
                            <span className="room-chip role-pill-badge">{roomLabel}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className="badge-role role-pill-badge">{m.role_display}</span>
                        </td>
                        <td>
                          <div className="email-link">{m.email || '—'}</div>
                          <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                            {m.phone || '—'}
                          </div>
                        </td>
                        <td>
                          {m.doctor_profile ? (
                            <div className="person-assoc-box">
                              <div className="dept-subtitle">
                                {m.doctor_profile.department?.name || 'No Department'}
                              </div>
                              <div className="muted" style={{ fontSize: '0.78rem' }}>
                                {m.doctor_profile.assigned_days_text || 'Unscheduled'}
                              </div>
                            </div>
                          ) : m.role === 'receptionist' ? (
                            <div className="muted" style={{ fontSize: '0.8rem' }}>
                              Desk Doctors: <strong>{m.assigned_doctors_count}</strong>
                            </div>
                          ) : (
                            <span className="muted">Hospital Admin</span>
                          )}
                        </td>
                        <td>
                          {isAdmin ? (
                            <button
                              type="button"
                              className={`sm-status-toggle ${m.is_active ? 'active' : 'inactive'}`}
                              disabled={m.id === user?.id || togglingId === m.id}
                              title={
                                m.id === user?.id
                                  ? 'Cannot deactivate your own account'
                                  : m.is_active
                                    ? 'Click to deactivate'
                                    : 'Click to activate'
                              }
                              onClick={() => handleToggleActive(m)}
                            >
                              <span>{m.is_active ? '●' : '○'}</span>
                              <span>{m.is_active ? 'Active' : 'Deactivated'}</span>
                            </button>
                          ) : (
                            <span className={`sm-status-toggle ${m.is_active ? 'active' : 'inactive'}`}>
                              {m.is_active ? 'Active' : 'Deactivated'}
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {isAdmin && (
                              <button
                                type="button"
                                className="button button-small button-outline"
                                onClick={() => openEditModal(m)}
                              >
                                Edit
                              </button>
                            )}
                            {m.doctor_profile && (isAdmin || user?.id === m.id) && (
                              <>
                                <Link
                                  className="button button-small button-outline"
                                  to={`/doctors/${m.doctor_profile.id}/rules`}
                                >
                                  Rules
                                </Link>
                                <Link
                                  className="button button-small button-outline"
                                  to={`/schedules?doctor=${m.doctor_profile.id}`}
                                >
                                  Slots
                                </Link>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && data.total_pages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <span className="muted">
                Page {data.page} of {data.total_pages} ({data.total} staff)
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={data.page <= 1}
                  onClick={() => setParam({ page: String(data.page - 1) })}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="button button-small button-outline"
                  disabled={data.page >= data.total_pages}
                  onClick={() => setParam({ page: String(data.page + 1) })}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unified Onboard / Edit Modal Workspace (Same Page) */}
      {editorOpen && isAdmin && (
        <div
          className="sm-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditor();
          }}
        >
          <form className="sm-modal-panel" onSubmit={handleSaveStaff}>
            <div className="sm-modal-header">
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>
                  {editUserId ? 'UPDATE STAFF ACCOUNT' : 'ONBOARD NEW STAFF'}
                </p>
                <h2 style={{ margin: 0 }}>
                  {editUserId ? `Manage: ${name || username}` : 'Create Doctor / Staff Account'}
                </h2>
              </div>
            </div>

            <div className="sm-modal-body">
              {/* Role & Active Status Controls */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: 16,
                  paddingBottom: 16,
                  marginBottom: 18,
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <div>
                  <label className="filter-group-title" style={{ display: 'block', marginBottom: 8 }}>
                    Staff Role
                  </label>
                  <div className="sm-radio-group" role="radiogroup" aria-label="Staff Role">
                    {(['doctor', 'receptionist', 'admin'] as const).map((rVal) => {
                      const label =
                        rVal === 'doctor'
                          ? 'Doctor'
                          : rVal === 'receptionist'
                            ? 'Receptionist'
                            : 'Administrator';
                      const locked = Boolean(editUserId && role !== rVal);
                      return (
                        <button
                          key={rVal}
                          type="button"
                          disabled={locked}
                          style={locked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                          className={`sm-radio-btn ${role === rVal ? 'is-active' : ''}`}
                          onClick={() => !editUserId && setRole(rVal)}
                        >
                          <span>{role === rVal ? '●' : '○'}</span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="filter-group-title" style={{ display: 'block', marginBottom: 8 }}>
                    Account Activity
                  </label>
                  <div className="sm-radio-group" role="radiogroup" aria-label="Account Activity">
                    <button
                      type="button"
                      className={`sm-radio-btn ${isActive ? 'is-active' : ''}`}
                      onClick={() => setIsActive(true)}
                    >
                      <span>{isActive ? '●' : '○'}</span>
                      <span>Active</span>
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(editUserId && user && editUserId === user.id)}
                      className={`sm-radio-btn ${!isActive ? 'is-danger-active' : ''}`}
                      onClick={() => setIsActive(false)}
                    >
                      <span>{!isActive ? '●' : '○'}</span>
                      <span>Deactivated</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Account Credentials & Personal Details */}
              <div className="form-grid two-col" style={{ marginBottom: 20 }}>
                <div className="form-group">
                  <label htmlFor="sm-name">Name *</label>
                  <input
                    id="sm-name"
                    type="text"
                    className="field-control"
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-username">
                    Username *
                    {usernameCheck && (
                      <span
                        className={`sm-live-pill ${usernameCheck.valid ? 'is-ok' : 'is-err'}`}
                      >
                        {usernameCheck.valid ? '✓ OK' : `✕ ${usernameCheck.message}`}
                      </span>
                    )}
                  </label>
                  <input
                    id="sm-username"
                    type="text"
                    className="field-control"
                    placeholder="Unique username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-email">
                    Email Address *
                    {emailCheck && (
                      <span className={`sm-live-pill ${emailCheck.valid ? 'is-ok' : 'is-err'}`}>
                        {emailCheck.valid ? '✓ OK' : `✕ ${emailCheck.message}`}
                      </span>
                    )}
                  </label>
                  <input
                    id="sm-email"
                    type="email"
                    className="field-control"
                    placeholder="Unique staff email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-phone">Phone Number (Optional)</label>
                  <input
                    id="sm-phone"
                    type="tel"
                    className="field-control"
                    placeholder="01XXXXXXXXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-dob">Date of Birth (Optional)</label>
                  <GreenDatePicker
                    id="sm-dob"
                    value={dob}
                    onChange={setDob}
                    isDob
                    placeholder="Optional"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-nid">NID (Optional)</label>
                  <input
                    id="sm-nid"
                    type="text"
                    className="field-control"
                    placeholder="National ID number"
                    value={nid}
                    onChange={(e) => setNid(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-addr">Address (Optional)</label>
                  <input
                    id="sm-addr"
                    type="text"
                    className="field-control"
                    placeholder="Residential or clinic address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sm-pw">
                    {editUserId ? 'Set New Password (Leave blank to keep)' : 'Set Password *'}
                  </label>
                  <input
                    id="sm-pw"
                    type="password"
                    className="field-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={!editUserId}
                    placeholder="Min 6 characters (not all numbers)"
                  />
                </div>
              </div>

              {/* Room Assignment (All Roles) + Live Schedule Occupancy */}
              <div className="sm-room-box" style={{ marginBottom: role === 'doctor' ? 18 : 0 }}>
                <div className="form-grid two-col">
                  <div className="form-group full" style={{ marginBottom: 8 }}>
                    <label htmlFor="sm-room">Room No (Optional — Any Staff Role)</label>
                    <select
                      id="sm-room"
                      className="field-control"
                      value={chamberId}
                      onChange={(e) => setChamberId(e.target.value)}
                    >
                      <option value="">No Room / Leave Blank</option>
                      {meta?.chambers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.room_number}
                          {c.description ? ` — ${c.description}` : ''} · {c.doctors_count ?? 0}{' '}
                          doctor(s)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedRoom && (
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <strong style={{ fontSize: '0.88rem', color: '#0d5c46' }}>
                        Room Occupancy &amp; Schedule ({selectedRoom.room_number})
                      </strong>
                      {selectedRoom.description && (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {selectedRoom.description}
                        </span>
                      )}
                    </div>

                    {otherDoctorsInRoom.length > 0 ? (
                      otherDoctorsInRoom.map((doc) => (
                        <div key={doc.id} className="sm-room-doc-card">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 6,
                            }}
                          >
                            <strong>{doc.name}</strong>
                            <span className="muted" style={{ fontSize: '0.8rem' }}>
                              {doc.department_name || 'General Consultation'}
                            </span>
                          </div>
                          {doc.schedules && doc.schedules.length > 0 ? (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 6,
                                marginTop: 6,
                              }}
                            >
                              {doc.schedules.map((sc) => (
                                <span
                                  key={sc.id}
                                  className="role-pill-badge"
                                  style={{ fontSize: '0.76rem' }}
                                >
                                  {sc.weekday_name}: {sc.start_time_12h} – {sc.end_time_12h}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                              Assigned Days: {doc.assigned_days_text || 'Unscheduled'}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="notice notice-success" style={{ marginTop: 8, padding: 10 }}>
                        No other doctor is currently assigned to {selectedRoom.room_number}.
                      </div>
                    )}

                    {otherStaffInRoom.length > 0 && (
                      <div className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
                        <strong>Other Staff in Room:</strong>{' '}
                        {otherStaffInRoom.map((s) => `${s.name} (${s.role_display})`).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Doctor Clinical Profile & Weekly Schedule */}
              {role === 'doctor' && (
                <div
                  style={{
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: 18,
                  }}
                >
                  <h3 style={{ margin: '0 0 12px' }}>
                    Doctor Profile, Department &amp; Consultation Schedule
                  </h3>
                  <div className="form-grid two-col">
                    <div className="form-group">
                      <label htmlFor="sm-dept">Department (Optional)</label>
                      <select
                        id="sm-dept"
                        className="field-control"
                        value={departmentId}
                        onChange={(e) => setDepartmentId(e.target.value)}
                      >
                        <option value="">No Department / Leave Blank</option>
                        {meta?.departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="sm-gender">Doctor Gender</label>
                      <select
                        id="sm-gender"
                        className="field-control"
                        value={gender}
                        onChange={(e) => setGender(e.target.value as 'male' | 'female' | 'other')}
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="sm-rec">Assigned Receptionist (Optional)</label>
                      <select
                        id="sm-rec"
                        className="field-control"
                        value={receptionistId}
                        onChange={(e) => setReceptionistId(e.target.value)}
                      >
                        <option value="">None / Leave Blank</option>
                        {meta?.receptionists.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.display_name} (@{r.username})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="sm-desig">Designation</label>
                      <input
                        id="sm-desig"
                        type="text"
                        className="field-control"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        placeholder="e.g. Professor & Senior Consultant"
                      />
                    </div>

                    <div className="form-group full">
                      <label htmlFor="sm-qual">Education &amp; Qualifications</label>
                      <textarea
                        id="sm-qual"
                        rows={2}
                        className="field-control"
                        value={qualifications}
                        onChange={(e) => setQualifications(e.target.value)}
                        placeholder="MBBS, FCPS (Medicine), MD..."
                      />
                    </div>

                    <div className="form-group full">
                      <label>Weekly Office Days (Optional)</label>
                      <div className="sm-day-chips" style={{ marginTop: 6 }}>
                        {WEEKDAY_CHOICES.map((w) => {
                          const selected = consultationDays.includes(w.val);
                          return (
                            <button
                              key={w.val}
                              type="button"
                              className={`sm-day-chip ${selected ? 'is-selected' : ''}`}
                              onClick={() => toggleDay(w.val)}
                            >
                              {w.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {consultationDays.length > 0 && (
                      <>
                        <div className="form-group">
                          <label htmlFor="sm-st">Session Start Time</label>
                          <GreenTimePicker
                            id="sm-st"
                            value={startTime}
                            onChange={setStartTime}
                          />
                        </div>

                        <div className="form-group">
                          <label htmlFor="sm-et">Session End Time</label>
                          <GreenTimePicker id="sm-et" value={endTime} onChange={setEndTime} />
                        </div>
                      </>
                    )}

                    {liveScheduleConflict && (
                      <div className="form-group full">
                        <div className="form-errors">
                          <strong>Room Schedule Conflict:</strong> {liveScheduleConflict}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="sm-modal-footer">
              <button type="button" className="button button-outline" onClick={closeEditor}>
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={
                  saving ||
                  Boolean(liveScheduleConflict) ||
                  Boolean(usernameCheck && !usernameCheck.valid) ||
                  Boolean(emailCheck && !emailCheck.valid)
                }
              >
                {saving
                  ? 'Saving Account...'
                  : editUserId
                    ? 'Save Account Changes'
                    : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppLayout>
  );
}
