import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker, GreenTimePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { PageSizeControl, SortableColumn } from '../components/ManagementTable.tsx';
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
  default_commission: { mode: Doctor['hospital_share_mode']; value: number };
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

  const roleFilter = searchParams.get('role') || 'doctor';
  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'name';
  const page = Number(searchParams.get('page') || 1) || 1;
  const size = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50));

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [meta, setMeta] = useState<StaffMetaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Unified Editor Modal State (Create or Edit right on this single page)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [role, setRole] = useState<'doctor' | 'receptionist' | 'admin'>('doctor');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [professionalExperience, setProfessionalExperience] = useState('');
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
  const [sessions, setSessions] = useState<Array<{ weekday: number; start_time: string; end_time: string }>>([]);
  const [commissionMode, setCommissionMode] = useState<Doctor['hospital_share_mode']>('percent');
  const [commissionValue, setCommissionValue] = useState('10');
  const [sessionsChanged, setSessionsChanged] = useState(false);

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
    params.set('limit', String(size));

    api
      .get<StaffListResponse>(`/staff?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load staff roster.'), 'error'))
      .finally(() => setLoading(false));
  }, [roleFilter, q, sort, page, size, showToast]);

  useEffect(() => {
    loadStaff();
    loadMeta();
  }, [loadStaff, loadMeta]);

  const openCreateModal = useCallback((initialRole: 'doctor' | 'receptionist' = 'doctor') => {
    loadMeta();
    setEditUserId(null);
    setRole(initialRole);
    setName('');
    setUsername('');
    setEmail('');
    setPhone('');
    setAvatar(null);
    setRegistrationNumber('');
    setProfessionalExperience('');
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
    setSessions([]);
    setSessionsChanged(false);
    setCommissionMode('percent');
    setCommissionValue('');
    setUsernameCheck(null);
    setEmailCheck(null);
    setEditorOpen(true);
  }, [loadMeta]);

  const openEditModal = useCallback(
    (m: StaffRow) => {
      loadMeta();
      setEditUserId(m.id);
      setRole(m.role as 'doctor' | 'receptionist' | 'admin');
      setName(m.display_name || `${m.first_name} ${m.last_name}`.trim());
      setUsername(m.username);
      setEmail(m.email || '');
      setPhone(m.phone || '');
      setAvatar(null);
      setRegistrationNumber(m.doctor_profile?.registration_number || '');
      setProfessionalExperience(m.doctor_profile?.professional_experience || '');
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

      setSessions((m.doctor_profile?.weekly || []).filter((w) => w.active).map((w) => ({
        weekday: w.weekday, start_time: w.start_time.slice(0, 5), end_time: w.end_time.slice(0, 5),
      })));
      setSessionsChanged(false);
      setCommissionMode(m.doctor_profile?.hospital_share_mode || 'percent');
      setCommissionValue(String(m.doctor_profile?.hospital_share_value ?? 0));
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
      setUsernameCheck(null);
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
      setEmailCheck(null);
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

  const closeEditor = () => {
    setEditorOpen(false);
    if (initialCreate || routeEditId) {
      navigate('/staff', { replace: true });
    }
  };

  const changeLoginPermission = async (member: StaffRow) => {
    if (!await confirm({ title: member.login_allowed ? 'Block login' : 'Allow login', message: `Change login permission for ${member.display_name}?`, confirmText: 'Confirm', type: 'warning' })) return;
    try {
      const { data } = await api.put<{ message: string }>(`/staff/${member.id}/login-permission`, { login_allowed: !member.login_allowed });
      showToast(data.message, 'success');
      await loadStaff();
    } catch (err) { showToast(getApiErrorMessage(err, 'Could not change login permission.'), 'error'); }
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
    if (role === 'doctor' && sessions.some((session) => !session.start_time || !session.end_time || session.end_time <= session.start_time)) {
      showToast('Enter a start and a later end time for each session.', 'error');
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
        if (registrationNumber.trim()) payload.registration_number = registrationNumber.trim();
        payload.professional_experience = professionalExperience;
        payload.assigned_receptionist_id = receptionistId || null;
        payload.designation = designation.trim();
        payload.qualifications = qualifications.trim();
        if (sessionsChanged || !editUserId) payload.schedule_rules = sessions;
        payload.hospital_share_mode = commissionValue === '' ? meta?.default_commission?.mode || commissionMode : commissionMode;
        payload.hospital_share_value = commissionValue === '' ? meta?.default_commission?.value ?? 10 : commissionValue;
      }

      const body = avatar ? new FormData() : payload;
      if (body instanceof FormData && avatar) { body.append('staff', JSON.stringify(payload)); body.append('avatar', avatar); }
      const res = editUserId
        ? await api.put<{ message: string }>(`/staff/${editUserId}`, body)
        : await api.post<{ message: string }>('/staff', body);
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

  const updateSession = (index: number, change: Partial<(typeof sessions)[number]>) => {
    setSessions((current) => current.map((session, i) => i === index ? { ...session, ...change } : session));
    setSessionsChanged(true);
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
            <h1>{isAdmin ? 'Doctors & Staff Management' : 'Staff and Doctor List'}</h1>
          </div>
          {isAdmin && (
            <div className="heading-actions">
              <button type="button" className="button button-primary" onClick={() => openCreateModal(roleFilter === 'staff' ? 'receptionist' : 'doctor')}>
                <Icon id="ic-plus" /> {roleFilter === 'staff' ? 'Add Staff' : 'Add Doctor'}
              </button>
            </div>
          )}
        </div>

        {/* Instant Role Filter Pills */}
        <div className="filter-tabs" style={{ marginBottom: 14 }}>
          {[
            ['doctor', `Doctors (${counts.doctor})`],
            ['staff', `Staff (${counts.receptionist + counts.admin})`],
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
                  <option value="recent">Newest first</option>
                  <option value="oldest">Oldest first</option>
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
                <thead>
                  <tr>
                    <SortableColumn name="name" sort={sort} onChange={(sort) => setParam({ sort })}>Name &amp; Username</SortableColumn>
                    <SortableColumn name="room" sort={sort} onChange={(sort) => setParam({ sort })}>Room No</SortableColumn>
                    <SortableColumn name="role" sort={sort} onChange={(sort) => setParam({ sort })}>Role</SortableColumn>
                    <SortableColumn name="contact" sort={sort} onChange={(sort) => setParam({ sort })}>Contact</SortableColumn>
                    <SortableColumn name="department" sort={sort} onChange={(sort) => setParam({ sort })}>Clinical Assignment</SortableColumn>
                    {isAdmin && <SortableColumn name="active" sort={sort} onChange={(sort) => setParam({ sort })}>Account Status</SortableColumn>}
                    {isAdmin && <SortableColumn name="login" sort={sort} onChange={(sort) => setParam({ sort })}>Login Permission</SortableColumn>}
                    {isAdmin && <th>Actions</th>}
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
                          {isAdmin && <div className="email-link">{m.email || '—'}</div>}
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
                                {m.doctor_profile.assigned_receptionist_name || 'Unassigned'}
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
                        {isAdmin && (<td>
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
                        </td>)}
                        {isAdmin && <td><button type="button" className={`sm-status-toggle ${m.login_allowed ? 'active' : 'inactive'}`} disabled={m.id === user?.id || !m.is_active} onClick={() => void changeLoginPermission(m)}>
                          {m.login_allowed ? 'Allowed' : 'Blocked'}
                        </button></td>}
                        {isAdmin && <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {isAdmin && (
                              <button
                                type="button"
                                className="button button-small button-outline"
                                onClick={() => openEditModal(m)}
                              >
                                Manage
                              </button>
                            )}
                          </div>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && (
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
              <PageSizeControl size={size} onChange={(next) => setParam({ limit: String(next) })} />
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
              {!editUserId && <label className="form-group">Account role
                <select className="field-control" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="doctor">Doctor</option><option value="receptionist">Receptionist</option><option value="admin">Administrator</option>
                </select>
              </label>}
              <div className="form-grid two-col">
                <label className="form-group">Name<input className="field-control" required value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="form-group">Username<input className="field-control" required value={username} onChange={(e) => { setUsername(e.target.value); setUsernameCheck(null); }} />
                  {usernameCheck && <small aria-live="polite">{usernameCheck.message}</small>}
                </label>
                <label className="form-group">Email address<input className="field-control" type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setEmailCheck(null); }} />
                  {emailCheck && <small aria-live="polite">{emailCheck.message}</small>}
                </label>
                <label className="form-group">Phone number<input className="field-control" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
                <div className="form-group"><label htmlFor="sm-dob">Date of birth</label>
                  <GreenDatePicker id="sm-dob" value={dob} onChange={setDob} isDob maxToday required={role === 'doctor' && !editUserId} />
                </div>
                <label className="form-group">NID<input className="field-control" maxLength={30} value={nid} onChange={(e) => setNid(e.target.value)} /></label>
                <label className="form-group full">Address<textarea className="field-control" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
                {role === 'doctor' && <>
                  <label className="form-group">Gender
                    <select className="field-control" value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
                      <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                    </select>
                  </label>
                  <label className="form-group">Designation<input className="field-control" value={designation} onChange={(e) => setDesignation(e.target.value)} /></label>
                  <label className="form-group">BMDC registration number<input className="field-control" required={!editUserId} value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} /></label>
                </>}
                <label className="form-group">Profile picture<input className="field-control" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setAvatar(e.target.files?.[0] || null)} /></label>
                {role === 'doctor' && <label className="form-group">Department
                  <select className="field-control" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">Unassigned</option>{meta?.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>}
                <label className="form-group">Room number
                  <select className="field-control" value={chamberId} onChange={(e) => setChamberId(e.target.value)}>
                    <option value="">Unassigned</option>{meta?.chambers.map((item) => <option key={item.id} value={item.id}>{item.room_number}</option>)}
                  </select>
                </label>
                {role === 'doctor' && <>
                  <label className="form-group full">Assigned receptionist
                    <select className="field-control" value={receptionistId} onChange={(e) => setReceptionistId(e.target.value)}>
                      <option value="">Unassigned</option>{meta?.receptionists.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
                    </select>
                  </label>
                  <label className="form-group full">Education and qualifications<textarea className="field-control" rows={3} value={qualifications} onChange={(e) => setQualifications(e.target.value)} /></label>
                  <label className="form-group full">Professional experience<textarea className="field-control" rows={3} value={professionalExperience} onChange={(e) => setProfessionalExperience(e.target.value)} /></label>
                  <fieldset className="form-group full staff-sessions">
                    <legend>Weekly consultation sessions</legend>
                    {sessions.map((session, i) => <div className="staff-session-row" key={i}>
                      <label className="form-group">Day<select className="field-control" value={session.weekday} onChange={(e) => updateSession(i, { weekday: Number(e.target.value) })}>{[...WEEKDAY_CHOICES.slice(5), ...WEEKDAY_CHOICES.slice(0, 5)].map((day) => <option key={day.val} value={day.val}>{day.name}</option>)}</select></label>
                      <div className="form-group"><label htmlFor={`staff-session-start-${i}`}>Session start</label><GreenTimePicker id={`staff-session-start-${i}`} value={session.start_time} onChange={(start_time) => updateSession(i, { start_time })} /></div>
                      <div className="form-group"><label htmlFor={`staff-session-end-${i}`}>Session end</label><GreenTimePicker id={`staff-session-end-${i}`} value={session.end_time} onChange={(end_time) => updateSession(i, { end_time })} /></div>
                      <button type="button" className="button button-outline button-small" aria-label={`Remove session ${i + 1}`} onClick={() => { setSessions((current) => current.filter((_, index) => i !== index)); setSessionsChanged(true); }}>Remove</button>
                    </div>)}
                    <button type="button" className="button button-outline button-small" onClick={() => { setSessions((current) => [...current, { weekday: 5, start_time: '', end_time: '' }]); setSessionsChanged(true); }}>Add session</button>
                  </fieldset>
                  <label className="form-group">Hospital commission type
                    <select className="field-control" value={commissionValue === '' ? meta?.default_commission?.mode || commissionMode : commissionMode} onChange={(e) => { setCommissionMode(e.target.value as Doctor['hospital_share_mode']); if (!commissionValue) setCommissionValue('0'); }}>
                      <option value="percent">Percentage per appointment</option><option value="fixed">Fixed amount per appointment</option><option value="monthly">Fixed monthly amount</option>
                    </select>
                  </label>
                  <label className="form-group">Commission {commissionMode === 'percent' ? '(%)' : '(BDT)'}
                    <input className="field-control" type="number" min={0} max={commissionMode === 'percent' ? 100 : 9999999.99} step="0.01" placeholder={String(meta?.default_commission?.value ?? 10)} value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} />
                  </label>
                </>}
                <label className="form-group">{editUserId ? 'Set new password' : 'Set password'}
                  <input className="field-control" type="password" autoComplete="new-password" required={!editUserId} value={password} onChange={(e) => setPassword(e.target.value)} />
                  {editUserId && <small>Leave blank to keep the current password.</small>}
                </label>
                <label className="form-group">Account status
                  <select className="field-control" value={isActive ? 'active' : 'inactive'} disabled={editUserId === user?.id} onChange={(e) => setIsActive(e.target.value === 'active')}>
                    <option value="active">Active</option><option value="inactive">Deactivated</option>
                  </select>
                </label>
              </div>
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
