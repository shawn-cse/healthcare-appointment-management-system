import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { AttachmentLink } from '../components/AttachmentLink.tsx';
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

export default function ComplaintQueuePage({ support = false }: { support?: boolean }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const userType = support ? 'support' : 'patient';
  const status = searchParams.get('status') || '';

  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Read & Update modal state
  const [activeTicket, setActiveTicket] = useState<Complaint | null>(null);
  const [editStatus, setEditStatus] = useState<Complaint['status']>('reviewing');
  const [editResponse, setEditResponse] = useState('');
  const [adminFile, setAdminFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const loadQueue = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('mode', 'queue');
    params.set('user_type', userType);
    if (status) params.set('status', status);

    api
      .get<QueueResponse>(`/complaints?${params.toString()}`)
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Could not load complaint queue.'), 'error'))
      .finally(() => setLoading(false));
  }, [userType, status, showToast]);

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
    setEditStatus(
      c.status === 'submitted' || c.status === 'reviewing' || c.status === 'resolved'
        ? c.status
        : 'reviewing'
    );
    setEditResponse('');
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

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SERVICE QUALITY &amp; RESOLUTION QUEUE</p>
          <h1>{support ? 'Support Management' : 'Complaint Management'}</h1>
          <p>
            Review incoming complaints, inspect patient evidence, and issue audited hospital
            resolutions.
          </p>
        </div>
      </div>

      {user?.role === 'admin' && <nav className="filter-tabs" aria-label="Complaint source">
        <NavLink to="/service/complaints" className={({ isActive }) => `filter-tab ${isActive ? 'active' : ''}`}>Patient complaints</NavLink>
        <NavLink to="/service/support" className={({ isActive }) => `filter-tab ${isActive ? 'active' : ''}`}>Doctor and reception support</NavLink>
      </nav>}
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

      {loading ? <LoadingScreen /> : <ManagementTable rows={complaints} rowKey={(ticket) => ticket.id} dateColumn={5}
        filters={<select className="field-control" aria-label="Request status" value={status} onChange={(e) => setParam({ status: e.target.value || null })}>
          <option value="">All statuses</option><option value="submitted">Generated</option><option value="reviewing">Under Review</option><option value="resolved">Resolved</option>
        </select>} columns={[
          { heading: 'Complaint ID', value: (ticket) => ticket.display_code, cell: (ticket) => <button type="button" className="text-link" onClick={() => openModal(ticket)}>{ticket.display_code}</button> },
          { heading: 'Appointment ID', value: (ticket) => ticket.appointment?.reference || '' },
          { heading: support ? 'Sender' : 'Patient', value: (ticket) => `${ticket.patient.name} ${ticket.patient.phone}`, cell: (ticket) => ticket.patient.name },
          { heading: 'Category', value: (ticket) => `${ticket.category_display} ${ticket.subject}`, cell: (ticket) => <>{ticket.category_display}<br /><small>{ticket.subject}</small></> },
          { heading: 'Status', value: (ticket) => ticket.status_display, cell: (ticket) => <StatusPill status={ticket.status} label={ticket.status_display} /> },
          { heading: 'Date', value: (ticket) => ticket.created_at, cell: (ticket) => formatDateTime(ticket.created_at) },
          { heading: 'Actions', value: () => '', cell: (ticket) => <button type="button" className="button button-small button-outline" onClick={() => openModal(ticket)}>Review</button> },
        ]} />}

      {activeTicket && createPortal(
        <div
          className="sm-modal-backdrop"
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
                  <AttachmentLink path={activeTicket.attachment} filename={activeTicket.attachment_name || 'Download attachment'} />
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
                    setEditStatus(e.target.value as Complaint['status'])
                  }
                >
                  <option value="submitted">Generated</option>
                  <option value="reviewing">Under Review</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="cq-file">Attach Official Response Document</label>
                <input
                  id="cq-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="field-control"
                  onChange={(e) => setAdminFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="form-group full">
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

              <div className="form-group full" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
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
        </div>,
        document.body
      )}
    </AppLayout>
  );
}
