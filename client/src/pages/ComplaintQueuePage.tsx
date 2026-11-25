import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Complaint } from '../types/index.ts';

interface QueueResponse {
  complaints: Complaint[];
  counts: {
    all: number;
    submitted: number;
    reviewing: number;
    resolved: number;
    patient: number;
    doctor: number;
    staff: number;
  };
}

export default function ComplaintQueuePage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const userType = searchParams.get('user_type') || 'patient';
  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'newest';

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkStatus, setBulkStatus] = useState('');

  // Read & Update modal state
  const [activeTicket, setActiveTicket] = useState<Complaint | null>(null);
  const [editStatus, setEditStatus] = useState<'submitted' | 'reviewing' | 'resolved'>('reviewing');
  const [editResponse, setEditResponse] = useState('');
  const [adminFile, setAdminFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const loadQueue = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('mode', 'queue');
    params.set('user_type', userType);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (sort) params.set('sort', sort);

    api
      .get<QueueResponse>(`/complaints?${params.toString()}`)
      .then((res) => {
        setData(res.data);
        setSelectedIds([]);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Could not load complaint queue.'), 'error'))
      .finally(() => setLoading(false));
  }, [userType, status, q, sort, showToast]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSearchParams(next);
  };

  const openModal = (c: Complaint) => {
    setActiveTicket(c);
    setEditStatus(c.status);
    setEditResponse(c.response || '');
    setAdminFile(null);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('status', editStatus);
      formData.append('response', editResponse);
      if (adminFile) {
        formData.append('admin_attachment', adminFile);
      }
      const res = await api.put<{ message: string }>(`/complaints/${activeTicket.id}`, formData);
      showToast(res.data.message, 'success');
      setActiveTicket(null);
      loadQueue();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to update ticket.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkStatus || selectedIds.length === 0) return;
    try {
      const res = await api.post<{ message: string }>('/complaints/bulk', {
        selected_complaints: selectedIds,
        bulk_status: bulkStatus,
      });
      showToast(res.data.message, 'success');
      setBulkStatus('');
      loadQueue();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Bulk update failed.'), 'error');
    }
  };

  const counts = data?.counts || {
    all: 0,
    submitted: 0,
    reviewing: 0,
    resolved: 0,
    patient: 0,
    doctor: 0,
    staff: 0,
  };
  const complaints = data?.complaints || [];
  const allChecked = complaints.length > 0 && selectedIds.length === complaints.length;

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SERVICE QUALITY &amp; RESOLUTION QUEUE</p>
          <h1>Complaint &amp; Support Management</h1>
          <p>
            Review incoming complaints, inspect patient evidence, and issue audited hospital
            resolutions.
          </p>
        </div>
      </div>

      {user?.role === 'admin' && (
        <div className="filter-tabs" style={{ marginBottom: 16 }}>
          {[
            ['patient', `Patient Queue (${counts.patient})`],
            ['doctor', `Doctor Tickets (${counts.doctor})`],
            ['staff', `Staff Tickets (${counts.staff})`],
          ].map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              className={`filter-tab ${userType === val ? 'active' : ''}`}
              onClick={() => setParam({ user_type: val, status: null })}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}

      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <div className="metric-card">
          <div className="metric-top">
            <span>Total Tickets</span>
          </div>
          <strong>{counts.all}</strong>
          <small>In selected scope</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Generated / Submitted</span>
          </div>
          <strong>{counts.submitted}</strong>
          <small>Awaiting review</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Under Review</span>
          </div>
          <strong>{counts.reviewing}</strong>
          <small>Active inquiry</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Issue Solved</span>
          </div>
          <strong>{counts.resolved}</strong>
          <small>Closed &amp; resolved</small>
        </div>
      </div>

      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
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
            placeholder="Search ticket code, subject, submitter name, phone..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={status}
            onChange={(e) => setParam({ status: e.target.value || null })}
          >
            <option value="">All Statuses</option>
            <option value="submitted">Generated</option>
            <option value="reviewing">Under Review</option>
            <option value="resolved">Issue Solved</option>
          </select>
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={sort}
            onChange={(e) => setParam({ sort: e.target.value })}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
          <button type="submit" className="button button-primary button-small">
            <Icon id="ic-search" /> Apply
          </button>
        </form>
      </div>

      {selectedIds.length > 0 && (
        <form
          onSubmit={handleBulkSubmit}
          className="notice notice-info"
          style={{
            marginBottom: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <strong>{selectedIds.length} ticket(s) selected</strong>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="field-control"
              style={{ width: 'auto' }}
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              required
            >
              <option value="">Choose new status...</option>
              <option value="submitted">Mark Generated</option>
              <option value="reviewing">Mark Under Review</option>
              <option value="resolved">Mark Issue Solved</option>
            </select>
            <button type="submit" className="button button-primary button-small">
              Update Selected
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        {loading ? (
          <LoadingScreen />
        ) : complaints.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <h3>No complaints in queue</h3>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  <th style={{ width: 38 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? complaints.map((c) => c.id) : [])
                      }
                    />
                  </th>
                  <th>Ticket</th>
                  <th>Submitter</th>
                  <th>Category &amp; Subject</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(c.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) =>
                            e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{c.display_code}</strong>
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        {c.is_support ? 'Support' : 'Complaint'}
                      </div>
                    </td>
                    <td>
                      <strong>{c.patient.name}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {c.patient.phone || c.patient.username}
                      </div>
                    </td>
                    <td>
                      <strong>{c.subject}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {c.category_display}
                        {c.appointment ? ` · ${c.appointment.reference}` : ''}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={c.status} label={c.step_label} />
                    </td>
                    <td>{formatDateTime(c.updated_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-small button-primary"
                        onClick={() => openModal(c)}
                      >
                        Inspect / Respond
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeTicket && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveTicket(null);
          }}
        >
          <div
            className="panel"
            style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span className="role-pill-badge">{activeTicket.display_code}</span>
                <h2 style={{ margin: '6px 0 0' }}>{activeTicket.subject}</h2>
              </div>
              <button
                type="button"
                className="button button-small button-outline"
                onClick={() => setActiveTicket(null)}
              >
                ✕
              </button>
            </div>

            <div className="notice notice-info" style={{ marginBottom: 14 }}>
              <strong>From:</strong> {activeTicket.patient.name} ({activeTicket.patient.role}) ·{' '}
              {activeTicket.patient.phone}
              <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{activeTicket.message}</p>
              {activeTicket.attachment && (
                <div style={{ marginTop: 8 }}>
                  <a
                    href={activeTicket.attachment}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-small button-outline"
                  >
                    📎 Evidence: {activeTicket.attachment_name || 'Download'}
                  </a>
                </div>
              )}
            </div>

            {activeTicket.messages.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <strong style={{ fontSize: '0.85rem' }}>Follow-up Messages:</strong>
                {activeTicket.messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      marginTop: 6,
                      padding: 10,
                      borderRadius: 8,
                      background: '#f1f5f9',
                      fontSize: '0.88rem',
                    }}
                  >
                    <strong>{m.author_name}:</strong> {m.message}
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleUpdate} className="form-grid">
              <div className="form-group">
                <label htmlFor="cq-status">Resolution Status</label>
                <select
                  id="cq-status"
                  className="field-control"
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as 'submitted' | 'reviewing' | 'resolved')
                  }
                >
                  <option value="submitted">1. Generated</option>
                  <option value="reviewing">2. Under Review &amp; Inquiring</option>
                  <option value="resolved">3. Issue Solved</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="cq-resp">Official Resolution Note</label>
                <textarea
                  id="cq-resp"
                  rows={4}
                  className="field-control"
                  value={editResponse}
                  onChange={(e) => setEditResponse(e.target.value)}
                  placeholder="Write official response visible to the submitter..."
                />
              </div>

              <div className="form-group">
                <label htmlFor="cq-file">Attach Official Response Document (Optional)</label>
                <input
                  id="cq-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="field-control"
                  onChange={(e) => setAdminFile(e.target.files?.[0] || null)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setActiveTicket(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Updating...' : 'Save Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
