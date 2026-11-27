import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AttachmentLink } from '../components/AttachmentLink.tsx';
import { PageSizeControl, SortableColumn } from '../components/ManagementTable.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { RefundRequest } from '../types/index.ts';

type ReviewRefund = RefundRequest & { review_note: string; evidence_url: string | null; evidence_name: string | null };

interface RefundsResponse {
  refunds: ReviewRefund[];
  total: number;
  page: number;
  total_pages: number;
}

export default function RefundsPage() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [cashRefund, setCashRefund] = useState<RefundRequest | null>(null);
  const [transactionReference, setTransactionReference] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'newest';
  const page = Number(searchParams.get('page') || 1) || 1;
  const size = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 25));

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<RefundsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Reject note modal
  const [rejectTarget, setRejectTarget] = useState<RefundRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const loadRefunds = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));
    params.set('limit', String(size));

    api
      .get<RefundsResponse>(`/refunds?${params.toString()}`)
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load refunds.'), 'error'))
      .finally(() => setLoading(false));
  }, [status, q, sort, page, size, showToast]);

  useEffect(() => {
    loadRefunds();
  }, [loadRefunds]);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.set('page', '1');
    setSearchParams(next);
  };

  const runAction = async (id: number, endpoint: string, body?: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const res = await api.post<{ message: string }>(`/refunds/${id}/${endpoint}`, body);
      showToast(res.data.message, 'success');
      loadRefunds();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Refund action failed.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const [review, setReview] = useState<ReviewRefund | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewDocument, setReviewDocument] = useState<File | null>(null);

  useEffect(() => {
    if (q === searchInput.trim()) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput.trim()) next.set('q', searchInput.trim());
      else next.delete('q');
      next.set('page', '1');
      setSearchParams(next, { replace: true });
    }, 220);
    return () => clearTimeout(timer);
  }, [q, searchInput, searchParams, setSearchParams]);

  async function saveReview(event: React.FormEvent) {
    event.preventDefault();
    if (!review) return;
    const fields = new FormData();
    fields.set('note', reviewNote);
    if (reviewDocument) fields.set('document', reviewDocument);
    setBusyId(review.id);
    try {
      await api.post(`/refunds/${review.id}/evidence`, fields);
      showToast('Refund details saved.', 'success');
      setReview(null);
      loadRefunds();
    } catch (error) { showToast(getApiErrorMessage(error, 'Could not save refund details.'), 'error'); }
    finally { setBusyId(null); }
  }

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    await runAction(rejectTarget.id, 'reject', { note: rejectNote.trim() });
    setRejectTarget(null);
    setRejectNote('');
  };

  const refunds = data?.refunds || [];

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FINANCE &amp; SETTLEMENT DESK</p>
          <h1>Refund Management</h1>
          <p>
            Review cancellation refund queues, authorize payouts, record cash disbursements, and
            submit gateway refunds.
          </p>
        </div>
      </div>

      <div className="panel management-table-tools">
        <input type="search" className="field-control" aria-label="Search refunds" placeholder="Search refunds" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        <select className="field-control" aria-label="Refund status" value={status} onChange={(e) => setParam({ status: e.target.value || null })}>
          <option value="">All statuses</option>{isAdmin && <option value="pending">Pending approval</option>}
          <option value="approved">Approved</option><option value="processing">Processing</option>
          <option value="completed">Completed</option>{isAdmin && <option value="rejected">Rejected</option>}
        </select>
        <select className="field-control" aria-label="Sort refunds" value={sort} onChange={(e) => setParam({ sort: e.target.value })}>
          {sort.includes('.') && <option value={sort}>Column sort</option>}
          <option value="newest">Latest to oldest</option><option value="oldest">Oldest to latest</option>
          <option value="amount_high">Highest amount</option><option value="amount_low">Lowest amount</option>
        </select>
      </div>

      <div className="panel">
        {loading ? (
          <LoadingScreen />
        ) : refunds.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <h3>No refund requests found</h3>
            <p className="muted">Eligible paid cancellations will appear here automatically.</p>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  <SortableColumn name="reference" sort={sort} onChange={(sort) => setParam({ sort })}>Appointment</SortableColumn>
                  <SortableColumn name="patient" sort={sort} onChange={(sort) => setParam({ sort })}>Patient</SortableColumn>
                  <SortableColumn name="doctor" sort={sort} onChange={(sort) => setParam({ sort })}>Specialist</SortableColumn>
                  <SortableColumn name="amount" sort={sort} onChange={(sort) => setParam({ sort })}>Refund Amount</SortableColumn>
                  <SortableColumn name="status" sort={sort} onChange={(sort) => setParam({ sort })}>Status</SortableColumn>
                  <SortableColumn name="date" sort={sort} onChange={(sort) => setParam({ sort })}>Requested</SortableColumn>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.appointment ? (
                        <Link
                          to={`/appointments/${r.appointment.id}`}
                          style={{ fontWeight: 700, color: 'var(--forest)' }}
                        >
                          {r.appointment.reference}
                        </Link>
                      ) : (
                        `#${r.appointment_id}`
                      )}
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        Orig Fee: BDT {r.appointment?.fee.toFixed(0) ?? '—'}
                      </div>
                    </td>
                    <td>
                      <strong>{r.appointment?.patient_name || '—'}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {r.appointment?.guest_phone || ''}
                      </div>
                    </td>
                    <td>{r.appointment?.doctor_name || '—'}</td>
                    <td>
                      <strong>BDT {r.amount.toFixed(2)}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {r.mode_display}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={r.status} label={r.status_display} />
                      {r.internal_note && (
                        <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                          Note: {r.internal_note}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{formatDateTime(r.created_at)}</div>
                      {r.reviewed_by_name && (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>
                          By {r.reviewed_by_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="button button-small button-outline" onClick={() => { setReview(r); setReviewNote(r.review_note); setReviewDocument(null); }}>Notes and document</button>
                        {isAdmin && r.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              className="button button-small button-primary"
                              disabled={busyId === r.id}
                              onClick={() => runAction(r.id, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="button button-small button-outline"
                              style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}
                              disabled={busyId === r.id}
                              onClick={() => {
                                setRejectTarget(r);
                                setRejectNote('');
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && r.mode === 'cash' && (
                          <button
                            type="button"
                            className="button button-small button-primary"
                            disabled={busyId === r.id}
                            onClick={() => { setCashRefund(r); setTransactionReference(''); }}
                          >
                            Mark Cash Paid
                          </button>
                        )}
                        {r.status === 'approved' && r.mode === 'online' && (
                          <button
                            type="button"
                            className="button button-small button-primary"
                            disabled={busyId === r.id}
                            onClick={() => runAction(r.id, 'online')}
                          >
                            Submit Online Refund
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
              padding: '14px 18px',
              borderTop: '1px solid var(--line)',
            }}
          >
            <PageSizeControl size={size} onChange={(next) => setParam({ limit: String(next) })} />
              <span className="muted">
              Page {data.page} of {data.total_pages} ({data.total} total)
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

      {rejectTarget && (
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
            if (e.target === e.currentTarget) setRejectTarget(null);
          }}
        >
          <div className="panel" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>
              Reject Refund ({rejectTarget.appointment?.reference || `#${rejectTarget.id}`})
            </h2>
            <form onSubmit={handleRejectSubmit}>
              <div className="form-group">
                <label htmlFor="rf-rej-note">Internal / Audit Note</label>
                <textarea
                  id="rf-rej-note"
                  rows={3}
                  className="field-control"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Specify reason for rejecting this refund..."
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setRejectTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                >
                  Confirm Reject
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {cashRefund && <div className="modal-backdrop is-open"><form className="panel padded-panel form-grid" onSubmit={async (event) => {
        event.preventDefault();
        await runAction(cashRefund.id, 'cash', { transaction_reference: transactionReference });
        setCashRefund(null);
      }}>
        <h2>Record cash refund</h2>
        <label className="form-group">Transaction reference
          <input className="field-control" value={transactionReference} onChange={(e) => setTransactionReference(e.target.value)} maxLength={90} required />
        </label>
        <button type="button" className="button button-outline" onClick={() => setCashRefund(null)}>Cancel</button>
        <button type="submit" className="button button-primary" disabled={!transactionReference.trim() || busyId === cashRefund.id}>Record payout</button>
      </form></div>}
      {review && <div className="modal-backdrop is-open">
        <form className="panel padded-panel refund-review-form" onSubmit={saveReview}>
          <h2>Refund notes and document</h2>
          {review.evidence_url && <AttachmentLink path={review.evidence_url} filename={review.evidence_name || 'Download refund document'} />}
          <label className="form-group">Note<textarea className="field-control" rows={4} maxLength={3000} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /></label>
          <label className="form-group">Refund document<input className="field-control" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setReviewDocument(e.target.files?.[0] || null)} /></label>
          <div className="consultation-times">
            <button type="button" className="button button-outline" onClick={() => setReview(null)}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={busyId === review.id}>Save details</button>
          </div>
        </form>
      </div>}
    </AppLayout>
  );
}
