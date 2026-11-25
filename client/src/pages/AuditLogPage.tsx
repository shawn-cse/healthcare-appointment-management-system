import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
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
}

const CATEGORIES = [
  ['all', 'All Categories'],
  ['bookings', 'Bookings'],
  ['payments', 'Payments'],
  ['refunds', 'Refunds'],
  ['schedules', 'Schedules & Slots'],
  ['staff', 'Staff & Doctors'],
  ['patients', 'Patients & Profiles'],
  ['rooms', 'Rooms'],
  ['departments', 'Departments'],
  ['complaints', 'Complaints & Support'],
  ['reports', 'Reports'],
] as const;

const ACTORS = [
  ['all', 'All Actors'],
  ['admin', 'Administrator'],
  ['doctor', 'Doctor'],
  ['receptionist', 'Receptionist'],
] as const;

const TIME_FILTERS = [
  ['all', 'All Time'],
  ['today', 'Today'],
  ['2d', 'Last 2 Days'],
  ['7d', 'Last 7 Days'],
  ['custom', 'Custom Date'],
] as const;

export default function AuditLogPage() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || 'all';
  const actor = searchParams.get('actor') || 'all';
  const date = searchParams.get('date') || 'all';
  const fromDate = searchParams.get('from') || '';
  const toDate = searchParams.get('to') || '';
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
    if (date === 'custom') {
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
    }
    params.set('page', String(page));

    api
      .get<AuditResponse>(`/audit?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load activity log.'), 'error'))
      .finally(() => setLoading(false));
  }, [q, category, actor, date, fromDate, toDate, page, showToast]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(updates)) {
        if (v && v !== 'all') next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in updates)) next.set('page', '1');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // Instant live typing search (no Filter button needed)
  useEffect(() => {
    const clean = searchInput.trim();
    if (clean === q) return;
    const timer = window.setTimeout(() => {
      setParam({ q: clean || null });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchInput, q, setParam]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category !== 'all') params.set('category', category);
      if (actor !== 'all') params.set('actor', actor);
      if (date !== 'all') params.set('date', date);
      if (date === 'custom') {
        if (fromDate) params.set('from', fromDate);
        if (toDate) params.set('to', toDate);
      }
      const res = await api.get(`/audit/csv?${params.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'green_hospital_activity_log.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Activity log CSV exported.', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'CSV export failed.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppLayout>
      <div className="staff-directory-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">HOSPITAL ACTIVITY</p>
            <h1>Activity Log</h1>
            <p>
              Real-time history across appointments, payments, refunds, schedules, rooms,
              departments, and staff accounts.
            </p>
          </div>
        </div>

        {/* Separated Auto-Filtering Controls */}
        <div className="panel no-print" style={{ padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Row 1: Separated Category Pills */}
            <div className="filter-tabs" role="group" aria-label="Activity Categories">
              {CATEGORIES.map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  className={`filter-tab ${category === val ? 'active' : ''}`}
                  style={{ padding: '6px 12px', fontSize: '12.5px' }}
                  onClick={() => setParam({ category: val })}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {/* Row 2: Actor & Time Filters (Auto-apply cleanly) */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 10,
                borderTop: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '12px', fontWeight: 700, marginRight: 4 }}>
                  ACTOR:
                </span>
                {ACTORS.map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    className={`filter-tab ${actor === val ? 'active' : ''}`}
                    style={{ padding: '5px 11px', fontSize: '12px' }}
                    onClick={() => setParam({ actor: val })}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '12px', fontWeight: 700, marginRight: 4 }}>
                  TIME:
                </span>
                {TIME_FILTERS.map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    className={`filter-tab ${date === val ? 'active' : ''}`}
                    style={{ padding: '5px 11px', fontSize: '12px' }}
                    onClick={() => {
                      if (val !== 'custom') {
                        setParam({ date: val, from: null, to: null });
                      } else {
                        setParam({ date: 'custom' });
                      }
                    }}
                  >
                    {lbl}
                  </button>
                ))}

                {date === 'custom' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 4 }}>
                    <div style={{ width: 150 }}>
                      <GreenDatePicker
                        value={fromDate}
                        onChange={(v) => setParam({ date: 'custom', from: v || null })}
                        maxToday
                        placeholder="From Date"
                      />
                    </div>
                    <span className="muted">to</span>
                    <div style={{ width: 150 }}>
                      <GreenDatePicker
                        value={toDate}
                        onChange={(v) => setParam({ date: 'custom', to: v || null })}
                        maxToday
                        placeholder="To Date"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Excel Sheet Panel: Search + Print Log + Export CSV inside Table Card Header */}
        <div className="excel-sheet-panel">
          <div className="excel-sheet-header-bar no-print">
            <div className="staff-live-toolbar">
              <div className="staff-live-search-wrap">
                <Icon id="ic-search" className="icon search-ic" />
                <input
                  type="text"
                  className="field-control"
                  placeholder="Type to search performer, action, target record, or details..."
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="sheet-indicator">
                  <span className="live-dot-pulse" />
                  <span>
                    Showing <strong>{data?.events.length ?? 0}</strong> of{' '}
                    <strong>{data?.total ?? 0}</strong> events
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-small button-outline"
                  onClick={() => window.print()}
                >
                  Print Log
                </button>
                <button
                  type="button"
                  className="button button-small button-primary"
                  disabled={exporting}
                  onClick={handleExportCsv}
                >
                  <Icon id="ic-download" /> {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
              </div>
            </div>
          </div>

          {loading && !data ? (
            <LoadingScreen />
          ) : !data || data.events.length === 0 ? (
            <div className="empty-state" style={{ padding: 48 }}>
              <h3>No activity events matched</h3>
              <p className="muted">Try choosing another category, actor, or time window.</p>
            </div>
          ) : (
            <div className="excel-table-wrap">
              <table className="excel-grid-table">
                <colgroup>
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '27%' }} />
                </colgroup>
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
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(ev.created_at)}</td>
                      <td>
                        <div className="person-name">{ev.actor_info.name}</div>
                        <span className="role-pill-badge" style={{ marginTop: 2, fontSize: '10.5px' }}>
                          {ev.actor_info.role}
                        </span>
                      </td>
                      <td>
                        <span className="role-pill-badge">{ev.action_label}</span>
                      </td>
                      <td>
                        {ev.formatted_target.is_appointment ? (
                          <Link
                            to={`/appointments?q=${encodeURIComponent(ev.formatted_target.ref)}`}
                            className="person-name-link"
                          >
                            {ev.formatted_target.label}
                          </Link>
                        ) : (
                          <strong>{ev.formatted_target.label || '—'}</strong>
                        )}
                      </td>
                      <td>{ev.clean_detail || '—'}</td>
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
                padding: '12px 16px',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
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
      </div>
    </AppLayout>
  );
}
