import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Complaint } from '../types/index.ts';

export default function ComplaintsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tickets, setTickets] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [sendingId, setSendingId] = useState<number | null>(null);

  const loadTickets = useCallback(() => {
    setLoading(true);
    api
      .get<{ complaints: Complaint[] }>('/complaints')
      .then((res) => setTickets(res.data.complaints || []))
      .catch((err) => showToast(getApiErrorMessage(err, 'Could not load support tickets.'), 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const handleReply = async (ticketId: number) => {
    const text = (replyDrafts[ticketId] || '').trim();
    if (!text) return;
    setSendingId(ticketId);
    try {
      const res = await api.post<{ complaint: Complaint; message: string }>(
        `/complaints/${ticketId}/reply`,
        { message: text }
      );
      setTickets((prev) => prev.map((c) => (c.id === ticketId ? res.data.complaint : c)));
      setReplyDrafts((prev) => ({ ...prev, [ticketId]: '' }));
      showToast(res.data.message, 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not send reply.'), 'error');
    } finally {
      setSendingId(null);
    }
  };

  const isStaffMember = user?.role !== 'patient';

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {isStaffMember ? 'INTERNAL ESCALATION DESK' : 'PATIENT SUPPORT & FEEDBACK'}
          </p>
          <h1>{isStaffMember ? 'Support & Requests' : 'Complaint & Support Desk'}</h1>
          <p>
            Track resolution progress step-by-step and communicate directly with hospital
            administration.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button button-primary" to="/complaints/new">
            <Icon id="ic-plus" /> Submit Request / Complaint
          </Link>
        </div>
      </div>

      {loading ? (
        <LoadingScreen />
      ) : tickets.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 48 }}>
          <h3>No tickets submitted yet</h3>
          <p className="muted">
            Need billing assistance, clinical escalation, or IT support? Create a ticket anytime.
          </p>
          <Link className="button button-primary" to="/complaints/new">
            Open Support Ticket
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {tickets.map((t) => (
            <div key={t.id} className="panel" style={{ padding: 22 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginBottom: 14,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="role-pill-badge">{t.display_code}</span>
                    <span className="status status-confirmed">
                      {t.is_support ? 'Support' : 'Formal Complaint'} · {t.category_display}
                    </span>
                    <StatusPill status={t.status} label={t.step_label} />
                  </div>
                  <h2 style={{ margin: '8px 0 4px' }}>{t.subject}</h2>
                  <div className="muted" style={{ fontSize: '0.84rem' }}>
                    Submitted {formatDateTime(t.created_at)}
                    {t.appointment ? ` · Linked Booking: ${t.appointment.reference}` : ''}
                  </div>
                </div>
              </div>

              {/* 3-Step Resolution Tracker */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 10,
                  marginBottom: 16,
                  padding: 12,
                  background: 'var(--bg)',
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                }}
              >
                {[
                  [1, '1. Ticket Generated'],
                  [2, '2. Under Review & Inquiry'],
                  [3, '3. Issue Solved'],
                ].map(([stepNum, label]) => {
                  const active = t.status_step >= Number(stepNum);
                  return (
                    <div
                      key={stepNum}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontWeight: active ? 700 : 500,
                        color: active ? 'var(--forest)' : 'var(--muted-light)',
                        fontSize: '0.88rem',
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          background: active ? 'var(--forest)' : '#cbd5e1',
                          color: '#fff',
                          fontSize: '0.75rem',
                          flexShrink: 0,
                        }}
                      >
                        {active ? '✓' : stepNum}
                      </span>
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>

              <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{t.message}</p>

              {t.attachment && (
                <div style={{ marginBottom: 12 }}>
                  <a
                    href={t.attachment}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-small button-outline"
                  >
                    📎 Attachment: {t.attachment_name || 'View File'}
                  </a>
                </div>
              )}

              {t.response && (
                <div className="notice notice-success" style={{ marginBottom: 14 }}>
                  <strong>Official Hospital Response{t.updated_by_name ? ` (${t.updated_by_name})` : ''}:</strong>
                  <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{t.response}</p>
                  {t.admin_attachment && (
                    <div style={{ marginTop: 8 }}>
                      <a
                        href={t.admin_attachment}
                        target="_blank"
                        rel="noreferrer"
                        className="button button-small button-outline"
                      >
                        📎 Resolution File: {t.admin_attachment_name || 'Download'}
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Follow-up Thread */}
              {t.messages && t.messages.length > 0 && (
                <div
                  style={{
                    borderTop: '1px solid var(--line)',
                    paddingTop: 12,
                    marginTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {t.messages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#f1f5f9',
                        fontSize: '0.9rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong>
                          {m.author_name} <span className="muted">({m.author_role})</span>
                        </strong>
                        <span className="muted" style={{ fontSize: '0.78rem' }}>
                          {formatDateTime(m.created_at)}
                        </span>
                      </div>
                      <div>{m.message}</div>
                    </div>
                  ))}
                </div>
              )}

              {t.status !== 'resolved' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <input
                    type="text"
                    className="field-control"
                    placeholder="Add a follow-up note or clarification..."
                    value={replyDrafts[t.id] || ''}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="button button-primary button-small"
                    disabled={sendingId === t.id || !(replyDrafts[t.id] || '').trim()}
                    onClick={() => handleReply(t.id)}
                  >
                    {sendingId === t.id ? 'Sending...' : 'Send Reply'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
