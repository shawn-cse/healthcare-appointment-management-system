import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { RefundRequest } from '../types/index.ts';

interface RefundsResponse {
  refunds: RefundRequest[];
  total: number;
  page: number;
  total_pages: number;
}

export default function RefundsPage() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const status = searchParams.get('status') || '';
  const q = searchParams.get('q') || '';
  const sort = searchParams.get('sort') || 'newest';
  const page = Number(searchParams.get('page') || 1) || 1;

  const [searchInput, setSearchInput] = useState(q);
  const [data, setData] = useState<RefundsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
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

    api
      .get<RefundsResponse>(`/refunds?${params.toString()}`)
      .then((res) => {
        setData(res.data);
        setSelectedIds([]);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load refunds.'), 'error'))
      .finally(() => setLoading(false));
  }, [status, q, sort, page, showToast]);

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

  const handleBulkApprove = async () => {
    if (!selectedIds.length) return;
    const ok = await confirm({
      title: 'Bulk Approve Refunds',
      message: `Approve ${selectedIds.length} selected pending refund request(s)?`,
      confirmText: 'Approve Selected',
      type: 'warning',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ message: string }>('/refunds/bulk', { selected: selectedIds });
      showToast(res.data.message, 'success');
      loadRefunds();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Bulk approval failed.'), 'error');
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    await runAction(rejectTarget.id, 'reject', { note: rejectNote.trim() });
    setRejectTarget(null);
    setRejectNote('');
  };

  const refunds = data?.refunds || [];
  const allChecked = refunds.length > 0 && selectedIds.length === refunds.length;

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

      <div className="filter-tabs" style={{ marginBottom: 14 }}>
        {[
          ['', 'All Requests'],
          ['pending', 'Pending Approval'],
          ['approved', 'Approved (Ready for Payout)'],
          ['processing', 'Processing'],
          ['completed', 'Completed'],
          ['rejected', 'Rejected'],
        ].map(([val, lbl]) => (
          <button
            key={val || 'all'}
            type="button"
            className={`filter-tab ${status === val ? 'active' : ''}`}
            onClick={() => setParam({ status: val || null })}
          >
            {lbl}
          </button>
        ))}
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
            placeholder="Search appointment ref, patient, phone, or doctor..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={sort}
            onChange={(e) => setParam({ sort: e.target.value })}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="amount_high">Highest Amount</option>
            <option value="amount_low">Lowest Amount</option>
          </select>
          <button type="submit" className="button button-primary button-small">
            <Icon id="ic-search" /> Apply
          </button>
          {(status || q) && (
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

      {selectedIds.length > 0 && (
        <div
          className="notice notice-info"
          style={{
            marginBottom: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <strong>{selectedIds.length} refund request(s) selected</strong>
          <button type="button" className="button button-small button-primary" onClick={handleBulkApprove}>
            Bulk Approve Pending
          </button>
        </div>
      )}

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
                  <th style={{ width: 38 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? refunds.map((r) => r.id) : [])
                      }
                    />
                  </th>
                  <th>Appointment</th>
                  <th>Patient</th>
                  <th>Specialist</th>
                  <th>Refund Amount</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={(e) =>
                          setSelectedIds((prev) =>
                            e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)
                          )
                        }
                      />
                    </td>
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
                        {r.status === 'pending' && (
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
                            onClick={() => runAction(r.id, 'cash')}
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
    </AppLayout>
  );
}
