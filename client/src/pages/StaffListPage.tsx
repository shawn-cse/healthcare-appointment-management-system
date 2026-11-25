import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Doctor, User } from '../types/index.ts';

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

export default function StaffListPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const role = searchParams.get('role') || '';
  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'name';
  const page = Number(searchParams.get('page') || 1) || 1;

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStaff = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (q) params.set('q', q);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));

    api
      .get<StaffListResponse>(`/staff?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load staff roster.'), 'error'))
      .finally(() => setLoading(false));
  }, [role, q, sort, page, showToast]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.set('page', '1');
    setSearchParams(next);
  };

  const isAdmin = user?.role === 'admin';
  const counts = data?.counts || { all: 0, doctor: 0, receptionist: 0, admin: 0 };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLINICAL ROSTER &amp; ACCOUNTS</p>
          <h1>Staff &amp; Doctor Directory</h1>
          <p>
            Manage specialist physicians, front-desk receptionists, chamber assignments, and account
            permissions.
          </p>
        </div>
        {isAdmin && (
          <div className="heading-actions">
            <Link className="button button-primary" to="/staff/new">
              <Icon id="ic-plus" /> Onboard Staff / Doctor
            </Link>
          </div>
        )}
      </div>

      {/* Role Filter Tabs */}
      <div className="filter-tabs" style={{ marginBottom: 14 }}>
        {[
          ['', `All Staff (${counts.all})`],
          ['doctor', `Doctors (${counts.doctor})`],
          ['receptionist', `Receptionists (${counts.receptionist})`],
          ['admin', `Administrators (${counts.admin})`],
        ].map(([val, lbl]) => (
          <button
            key={val || 'all'}
            type="button"
            className={`filter-tab ${role === val ? 'active' : ''}`}
            onClick={() => setParam({ role: val || null })}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Search & Sort Bar */}
      <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: searchInput.trim() || null });
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
        >
          <input
            type="search"
            className="field-control"
            style={{ flex: '1 1 240px' }}
            placeholder="Search name, username, phone, department, chamber room..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={sort}
            onChange={(e) => setParam({ sort: e.target.value })}
          >
            <option value="name">Sort by Name</option>
            <option value="username">Sort by Username</option>
            <option value="role">Sort by Role</option>
            <option value="recent">Newest Added</option>
          </select>
          <button type="submit" className="button button-primary button-small">
            <Icon id="ic-search" /> Search
          </button>
          {(role || q) && (
            <button
              type="button"
              className="button button-outline button-small"
              onClick={() => {
                setSearchInput('');
                setSearchParams(new URLSearchParams());
              }}
            >
              Reset
            </button>
          )}
        </form>
      </div>

      <div className="panel">
        {loading ? (
          <LoadingScreen />
        ) : !data || data.staff.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <h3>No staff accounts matched</h3>
            <p className="muted">Try another keyword or clear filters.</p>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  <th>Name &amp; Username</th>
                  <th>Role</th>
                  <th>Contact</th>
                  <th>Clinical Assignment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.display_name}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        @{m.username}
                      </div>
                    </td>
                    <td>
                      <span className="role-pill-badge">{m.role_display}</span>
                    </td>
                    <td>
                      <div>{m.phone || '—'}</div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {m.email}
                      </div>
                    </td>
                    <td>
                      {m.doctor_profile ? (
                        <div>
                          <strong>{m.doctor_profile.department.name}</strong>
                          <div className="muted" style={{ fontSize: '0.8rem' }}>
                            {m.doctor_profile.active_room}
                            {m.doctor_profile.assigned_receptionist_name
                              ? ` · Desk: ${m.doctor_profile.assigned_receptionist_name}`
                              : ''}
                          </div>
                        </div>
                      ) : m.role === 'receptionist' ? (
                        <span className="muted">
                          Assigned Doctors: <strong>{m.assigned_doctors_count}</strong>
                        </span>
                      ) : (
                        <span className="muted">Hospital Administration</span>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        status={m.is_active ? 'confirmed' : 'cancelled'}
                        label={m.is_active ? 'Active' : 'Inactive'}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {isAdmin && (
                          <Link
                            className="button button-small button-outline"
                            to={`/staff/${m.id}`}
                          >
                            Edit Account
                          </Link>
                        )}
                        {m.doctor_profile && (isAdmin || user?.id === m.id) && (
                          <>
                            <Link
                              className="button button-small button-outline"
                              to={`/doctors/${m.doctor_profile.id}/rules`}
                            >
                              Fees &amp; Rules
                            </Link>
                            <Link
                              className="button button-small button-outline"
                              to={`/schedules?doctor=${m.doctor_profile.id}`}
                            >
                              Schedules
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
              padding: '14px 18px',
              borderTop: '1px solid var(--line)',
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
    </AppLayout>
  );
}
