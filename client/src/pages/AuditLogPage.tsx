import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatDateTime } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { AuditEvent } from '../types/index.ts';

interface AuditResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  total_pages: number;
  stats: {
    total: number;
    today: number;
    bookings: number;
    finance: number;
  };
}

export default function AuditLogPage() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || 'all';
  const actor = searchParams.get('actor') || 'all';
  const date = searchParams.get('date') || 'all';
  const page = Number(searchParams.get('page') || 1) || 1;

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadAudit = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category && category !== 'all') params.set('category', category);
    if (actor && actor !== 'all') params.set('actor', actor);
    if (date && date !== 'all') params.set('date', date);
    params.set('page', String(page));

    api
      .get<AuditResponse>(`/audit?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load audit log.'), 'error'))
      .finally(() => setLoading(false));
  }, [q, category, actor, date, page, showToast]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v && v !== 'all') next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.set('page', '1');
    setSearchParams(next);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category !== 'all') params.set('category', category);
      if (actor !== 'all') params.set('actor', actor);
      if (date !== 'all') params.set('date', date);
      const res = await api.get(`/audit/csv?${params.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'green_hospital_activity_log.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Audit activity CSV exported.', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'CSV export failed.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const stats = data?.stats || { total: 0, today: 0, bookings: 0, finance: 0 };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">GOVERNANCE &amp; COMPLIANCE TRAIL</p>
          <h1>Hospital Activity &amp; Audit Log</h1>
          <p>Immutable chronological record of clinical bookings, payments, refunds, and admin changes.</p>
        </div>
        <div className="heading-actions no-print">
          <button type="button" className="button button-outline" onClick={() => window.print()}>
            Print Log
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={exporting}
            onClick={handleExportCsv}
          >
            <Icon id="ic-download" /> {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <div className="metric-card">
          <div className="metric-top">
            <span>Total Events</span>
          </div>
          <strong>{stats.total}</strong>
          <small>Recorded ledger actions</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Logged Today</span>
          </div>
          <strong>{stats.today}</strong>
          <small>Current hospital day</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Booking Events</span>
          </div>
          <strong>{stats.bookings}</strong>
          <small>Reservations &amp; state transitions</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Finance Events</span>
          </div>
          <strong>{stats.finance}</strong>
          <small>Payments &amp; refunds</small>
        </div>
      </div>

      <div className="panel no-print" style={{ padding: 16, marginBottom: 16 }}>
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
            style={{ flex: '1 1 220px' }}
            placeholder="Search actor, action, target reference, detail..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={category}
            onChange={(e) => setParam({ category: e.target.value })}
          >
            <option value="all">All Categories</option>
            <option value="booking">Bookings &amp; Status</option>
            <option value="finance">Payments &amp; Refunds</option>
            <option value="schedule">Schedules &amp; Slots</option>
            <option value="account">Accounts &amp; Profiles</option>
            <option value="management">Rooms, Depts &amp; Complaints</option>
          </select>
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={actor}
            onChange={(e) => setParam({ actor: e.target.value })}
          >
            <option value="all">All Actors</option>
            <option value="admin">Administrators</option>
            <option value="doctor">Doctors</option>
            <option value="receptionist">Receptionists</option>
            <option value="patient">Patients</option>
          </select>
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={date}
            onChange={(e) => setParam({ date: e.target.value })}
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
          <button type="submit" className="button button-primary button-small">
            <Icon id="ic-search" /> Filter
          </button>
        </form>
      </div>

      <div className="panel">
        {loading ? (
          <LoadingScreen />
        ) : !data || data.events.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <h3>No audit events matched</h3>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Performer</th>
                  <th>Action</th>
                  <th>Target Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{formatDateTime(ev.created_at)}</td>
                    <td>
                      <strong>{ev.actor_info.name}</strong>
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        {ev.actor_info.role}
                      </div>
                    </td>
                    <td>
                      <span className="role-pill-badge">{ev.action_label}</span>
                    </td>
                    <td>
                      {ev.formatted_target.is_appointment ? (
                        <Link
                          to={`/appointments?q=${encodeURIComponent(ev.formatted_target.ref)}`}
                          style={{ fontWeight: 700, color: 'var(--forest)' }}
                        >
                          {ev.formatted_target.label}
                        </Link>
                      ) : (
                        ev.formatted_target.label
                      )}
                    </td>
                    <td style={{ maxWidth: 360 }}>{ev.clean_detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total_pages > 1 && (
          <div
            className="no-print"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 18px',
              borderTop: '1px solid var(--line)',
            }}
          >
            <span className="muted">
              Page {data.page} of {data.total_pages} ({data.total} matching events)
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
