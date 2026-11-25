import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDisplayDate } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Appointment, Doctor } from '../types/index.ts';

interface ApptsResponse {
  appointments: Appointment[];
  total: number;
  page: number;
  total_pages: number;
  active_sort: string;
  doctor_options: Doctor[];
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<ApptsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters synced to URL search params
  const status = searchParams.get('status') || '';
  const payment = searchParams.get('payment') || '';
  const q = searchParams.get('q') || '';
  const datePreset = searchParams.get('date_preset') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const doctor = searchParams.get('doctor') || '';
  const sort = searchParams.get('sort') || 'newest_date';
  const page = Number(searchParams.get('page') || 1) || 1;

  const [searchInput, setSearchInput] = useState(q);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState('');

  // Quick update modal state (Staff)
  const [quickTarget, setQuickTarget] = useState<Appointment | null>(null);
  const [qVisitType, setQVisitType] = useState<'first' | 'followup' | 'report'>('first');
  const [qFee, setQFee] = useState('');
  const [qFeeManual, setQFeeManual] = useState(false);
  const [qStatus, setQStatus] = useState('confirmed');
  const [qCollectCash, setQCollectCash] = useState(false);
  const [qCancelReason, setQCancelReason] = useState('');
  const [qNotes, setQNotes] = useState('');
  const [qSaving, setQSaving] = useState(false);

  // Cancel modal state (Patient)
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const isPatient = user?.role === 'patient';

  const fetchList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (payment) params.set('payment', payment);
    if (q) params.set('q', q);
    if (datePreset) params.set('date_preset', datePreset);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (doctor) params.set('doctor', doctor);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));

    api
      .get<ApptsResponse>(`/appointments?${params.toString()}`)
      .then((res) => {
        setData(res.data);
        setSelectedIds([]);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load appointments.'), 'error'))
      .finally(() => setLoading(false));
  }, [status, payment, q, datePreset, dateFrom, dateTo, doctor, sort, page, showToast]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (searchParams.get('payment') === 'cancelled') {
      showToast('Online payment gateway session was cancelled or failed.', 'warning');
    }
  }, [searchParams, showToast]);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.set('page', '1');
    setSearchParams(next);
  };

  const openQuickModal = (ap: Appointment) => {
    setQuickTarget(ap);
    setQVisitType(ap.visit_type);
    setQFee(String(ap.fee));
    setQFeeManual(false);
    setQStatus(ap.status);
    setQCollectCash(false);
    setQCancelReason(ap.cancellation_reason || '');
    setQNotes(ap.notes || '');
  };

  const handleQuickVisitChange = (vt: 'first' | 'followup' | 'report') => {
    setQVisitType(vt);
    if (!qFeeManual && quickTarget) {
      const feeMap = {
        first: quickTarget.doctor.initial_fee,
        followup: quickTarget.doctor.followup_fee,
        report: quickTarget.doctor.report_fee,
      };
      setQFee(String(feeMap[vt]));
    }
  };

  const submitQuickUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTarget) return;
    setQSaving(true);
    try {
      const res = await api.post<{ message: string; appointment: Appointment }>(
        `/appointments/${quickTarget.id}/quick-update`,
        {
          visit_type: qVisitType,
          fee: qFee,
          status: qStatus,
          cancellation_reason: qStatus === 'cancelled' ? qCancelReason : undefined,
          notes: qNotes,
          collect_cash: qCollectCash,
        }
      );
      showToast(res.data.message || 'Appointment updated.', 'success');
      setQuickTarget(null);
      fetchList();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save update.'), 'error');
    } finally {
      setQSaving(false);
    }
  };

  const submitPatientCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await api.post<{ message: string }>(`/appointments/${cancelTarget.id}/cancel`, {
        reason: cancelReason,
      });
      showToast(res.data.message || 'Appointment cancelled.', 'success');
      setCancelTarget(null);
      setCancelReason('');
      fetchList();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not cancel appointment.'), 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handlePayOnline = async (id: number) => {
    try {
      const res = await api.post<{ gateway_url: string }>(`/appointments/${id}/pay-online`);
      if (res.data.gateway_url) {
        window.location.href = res.data.gateway_url;
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Online payment gateway unavailable.'), 'error');
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkAction || selectedIds.length === 0) return;
    const labels: Record<string, string> = {
      cash: 'record cash payment',
      completed: 'mark as completed',
      no_show: 'mark as no-show',
      doctor_cancel: 'cancel by doctor & queue full refunds',
    };
    const ok = await confirm({
      title: 'Confirm Bulk Update',
      message: `Apply "${labels[bulkAction] || bulkAction}" to ${selectedIds.length} selected appointment(s)?`,
      confirmText: 'Proceed',
      type: bulkAction === 'doctor_cancel' ? 'danger' : 'warning',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ message: string }>('/appointments/bulk', {
        selected: selectedIds,
        action: bulkAction,
      });
      showToast(res.data.message || 'Bulk update completed.', 'success');
      setBulkAction('');
      fetchList();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Bulk update failed.'), 'error');
    }
  };

  const appts = data?.appointments || [];
  const allChecked = appts.length > 0 && selectedIds.length === appts.length;

  const statusTabs = isPatient
    ? [
        ['', 'All Bookings'],
        ['pending', 'Pending'],
        ['confirmed', 'Confirmed'],
        ['completed', 'Completed'],
        ['cancelled', 'Cancelled'],
      ]
    : [
        ['', 'All'],
        ['pending', 'Pending'],
        ['confirmed', 'Confirmed'],
        ['completed', 'Completed'],
        ['cancelled', 'Cancelled'],
        ['no_show', 'No Show'],
        ['expired', 'Expired'],
      ];

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{isPatient ? 'MY CONSULTATIONS' : 'CLINICAL SCHEDULING'}</p>
          <h1>{isPatient ? 'My Appointments' : 'Appointments Desk'}</h1>
          <p>
            {isPatient
              ? 'View your booking serials, consultation timings, online payments, and visit status.'
              : 'Real-time consultation queue, cash collection desk, bulk updates, and patient check-ins.'}
          </p>
        </div>
        <div className="heading-actions no-print">
          {!isPatient && (
            <button
              type="button"
              className="button button-outline"
              onClick={() => window.print()}
            >
              Print List
            </button>
          )}
          <Link
            className="button button-primary"
            to={isPatient ? '/doctors' : user?.role === 'doctor' ? '/schedules' : '/reception/book'}
          >
            <Icon id="ic-plus" />{' '}
            {isPatient
              ? 'Book Appointment'
              : user?.role === 'doctor'
                ? 'Manage My Slots'
                : 'Register Booking'}
          </Link>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="filter-tabs no-print" style={{ marginBottom: 14 }}>
        {statusTabs.map(([val, lbl]) => (
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

      {/* Filter toolbar */}
      <div className="panel no-print" style={{ padding: 16, marginBottom: 18 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: searchInput.trim() || null });
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
        >
          <div style={{ flex: '1 1 240px', position: 'relative' }}>
            <input
              type="search"
              className="field-control"
              placeholder={
                isPatient
                  ? 'Search reference or doctor...'
                  : 'Search ref, patient name, phone, doctor...'
              }
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          {!isPatient && (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  ['', 'Any Date'],
                  ['today', 'Today'],
                  ['upcoming', 'Upcoming'],
                  ['week', '7 Days'],
                ].map(([val, lbl]) => (
                  <button
                    key={val || 'any'}
                    type="button"
                    className={`button button-small ${datePreset === val && !dateFrom && !dateTo ? 'button-primary' : 'button-outline'}`}
                    onClick={() =>
                      setParam({
                        date_preset: val || null,
                        date_from: null,
                        date_to: null,
                      })
                    }
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div style={{ width: 155 }}>
                <GreenDatePicker
                  value={dateFrom}
                  onChange={(v) => setParam({ date_from: v || null, date_preset: null })}
                  placeholder="From Date"
                />
              </div>
              <div style={{ width: 155 }}>
                <GreenDatePicker
                  value={dateTo}
                  onChange={(v) => setParam({ date_to: v || null, date_preset: null })}
                  placeholder="To Date"
                />
              </div>

              {data?.doctor_options && data.doctor_options.length > 1 && (
                <select
                  className="field-control"
                  style={{ width: 'auto', minWidth: 180 }}
                  value={doctor}
                  onChange={(e) => setParam({ doctor: e.target.value || null })}
                >
                  <option value="">All Specialists</option>
                  {data.doctor_options.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                className="field-control"
                style={{ width: 'auto' }}
                value={payment}
                onChange={(e) => setParam({ payment: e.target.value || null })}
              >
                <option value="">All Payments</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="refund_pending">Refund Pending</option>
                <option value="partially_refunded">Partly Refunded</option>
                <option value="refunded">Refunded</option>
              </select>
            </>
          )}

          <select
            className="field-control"
            style={{ width: 'auto' }}
            value={sort}
            onChange={(e) => setParam({ sort: e.target.value })}
          >
            <option value="newest_date">Latest Schedule Date</option>
            <option value="oldest_date">Earliest Schedule Date</option>
            <option value="created_desc">Recently Booked</option>
            <option value="fee_desc">Highest Fee</option>
            <option value="fee_asc">Lowest Fee</option>
          </select>

          <button type="submit" className="button button-primary button-small">
            <Icon id="ic-search" /> Apply
          </button>

          {(status || payment || q || datePreset || dateFrom || dateTo || doctor) && (
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

      {/* Staff Bulk Bar */}
      {!isPatient && selectedIds.length > 0 && (
        <form
          onSubmit={handleBulkSubmit}
          className="notice notice-info no-print"
          style={{
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <strong>{selectedIds.length} appointment(s) selected</strong>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select
              className="field-control"
              style={{ width: 'auto' }}
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              required
            >
              <option value="">Choose bulk action...</option>
              <option value="cash">Record Cash Payment</option>
              <option value="completed">Mark Completed</option>
              <option value="no_show">Mark Did Not Attend</option>
              {(user?.role === 'doctor' || user?.role === 'admin') && (
                <option value="doctor_cancel">Cancel by Doctor (Full Refund)</option>
              )}
            </select>
            <button type="submit" className="button button-primary button-small">
              Run Action
            </button>
          </div>
        </form>
      )}

      {/* Excel Sheet Table */}
      <div className="panel">
        {loading ? (
          <LoadingScreen label="Loading consultation sheet..." />
        ) : appts.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <h3>No appointments match these filters</h3>
            <p className="muted">Try clearing filters or registering a new booking.</p>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  {!isPatient && (
                    <th className="no-print" style={{ width: 38 }}>
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? appts.map((a) => a.id) : [])
                        }
                        aria-label="Select all rows"
                      />
                    </th>
                  )}
                  <th>Ref &amp; Serial</th>
                  <th>Schedule Date &amp; Slot</th>
                  {!isPatient && <th>Patient Details</th>}
                  <th>Specialist &amp; Chamber</th>
                  <th>Visit &amp; Fee</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {appts.map((ap) => (
                  <tr key={ap.id}>
                    {!isPatient && (
                      <td className="no-print">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(ap.id)}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked
                                ? [...prev, ap.id]
                                : prev.filter((id) => id !== ap.id)
                            )
                          }
                          aria-label={`Select ${ap.reference}`}
                        />
                      </td>
                    )}
                    <td>
                      <Link to={`/appointments/${ap.id}`} style={{ fontWeight: 700, color: 'var(--forest)' }}>
                        {ap.reference}
                      </Link>
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        Serial #{ap.serial_number} · {ap.source_display}
                      </div>
                    </td>
                    <td>
                      <strong>{formatDisplayDate(ap.slot.date)}</strong>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {ap.slot.start_time_12h} – {ap.slot.end_time_12h}
                      </div>
                    </td>
                    {!isPatient && (
                      <td>
                        <strong>{ap.patient_name}</strong>
                        <div className="muted" style={{ fontSize: '0.82rem' }}>
                          {ap.guest_phone}
                          {ap.patient_username ? ` · @${ap.patient_username}` : ' · Walk-in/Guest'}
                        </div>
                      </td>
                    )}
                    <td>
                      <strong>{ap.doctor.name}</strong>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {ap.doctor.department.name} · {ap.doctor.active_room}
                      </div>
                    </td>
                    <td>
                      <strong>BDT {ap.fee.toFixed(0)}</strong>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {ap.visit_type_display}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={ap.status} label={ap.status_display} />
                    </td>
                    <td>
                      <StatusPill status={ap.payment_status} label={ap.payment_status_display} />
                      <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                        {ap.payment_method_display}
                      </div>
                    </td>
                    <td className="no-print">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!isPatient && (
                          <button
                            type="button"
                            className="button button-small button-outline"
                            onClick={() => openQuickModal(ap)}
                          >
                            Quick Edit
                          </button>
                        )}
                        {isPatient &&
                          ap.payment_status === 'unpaid' &&
                          ['pending', 'confirmed'].includes(ap.status) &&
                          ap.payment_method === 'online' && (
                            <button
                              type="button"
                              className="button button-small button-primary"
                              onClick={() => handlePayOnline(ap.id)}
                            >
                              Pay Online
                            </button>
                          )}
                        {isPatient && ['pending', 'confirmed'].includes(ap.status) && (
                          <button
                            type="button"
                            className="button button-small button-outline"
                            style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}
                            onClick={() => {
                              setCancelTarget(ap);
                              setCancelReason('');
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        <Link
                          className="button button-small button-outline"
                          to={`/appointments/${ap.id}`}
                        >
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
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
              Showing page {data.page} of {data.total_pages} ({data.total} total)
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

      {/* Staff Quick Update Modal */}
      {quickTarget && (
        <div
          className="modal-backdrop"
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
            if (e.target === e.currentTarget) setQuickTarget(null);
          }}
        >
          <div className="panel" style={{ width: '100%', maxWidth: 520, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0 }}>Quick Update — {quickTarget.reference}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {quickTarget.patient_name} · {quickTarget.doctor.name}
                </p>
              </div>
              <button
                type="button"
                className="button button-small button-outline"
                onClick={() => setQuickTarget(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitQuickUpdate} className="form-grid two-col">
              <div className="form-group">
                <label htmlFor="qu-visit">Visit Type</label>
                <select
                  id="qu-visit"
                  className="field-control"
                  value={qVisitType}
                  onChange={(e) =>
                    handleQuickVisitChange(e.target.value as 'first' | 'followup' | 'report')
                  }
                >
                  <option value="first">First Visit / New</option>
                  <option value="followup">Follow-up Visit</option>
                  <option value="report">Report Review</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="qu-fee">Consultation Fee (BDT)</label>
                <input
                  id="qu-fee"
                  type="number"
                  min={0}
                  step="1"
                  className="field-control"
                  value={qFee}
                  onChange={(e) => {
                    setQFee(e.target.value);
                    setQFeeManual(true);
                  }}
                />
              </div>

              <div className="form-group full">
                <label htmlFor="qu-status">Appointment Status</label>
                <select
                  id="qu-status"
                  className="field-control"
                  value={qStatus}
                  onChange={(e) => setQStatus(e.target.value)}
                >
                  <option value="pending">Awaiting payment</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed</option>
                  <option value="no_show">Did not attend</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              {qStatus === 'cancelled' && (
                <div className="form-group full">
                  <label htmlFor="qu-cancel-reason">Cancellation Reason</label>
                  <input
                    id="qu-cancel-reason"
                    type="text"
                    className="field-control"
                    value={qCancelReason}
                    onChange={(e) => setQCancelReason(e.target.value)}
                    placeholder="Reason for cancellation..."
                  />
                </div>
              )}

              {quickTarget.payment_status === 'unpaid' && qStatus !== 'cancelled' && (
                <div className="form-group full">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={qCollectCash}
                      onChange={(e) => setQCollectCash(e.target.checked)}
                    />
                    Collect cash payment now (BDT {qFee || quickTarget.fee})
                  </label>
                </div>
              )}

              <div className="form-group full">
                <label htmlFor="qu-notes">Desk Notes</label>
                <textarea
                  id="qu-notes"
                  rows={2}
                  className="field-control"
                  value={qNotes}
                  onChange={(e) => setQNotes(e.target.value)}
                />
              </div>

              <div className="form-group full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setQuickTarget(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={qSaving}>
                  {qSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Patient Cancel Modal */}
      {cancelTarget && (
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
            if (e.target === e.currentTarget) setCancelTarget(null);
          }}
        >
          <div className="panel" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>Cancel Appointment {cancelTarget.reference}?</h2>
            <p className="muted">
              Consultation with <strong>{cancelTarget.doctor.name}</strong> on{' '}
              {formatDisplayDate(cancelTarget.slot.date)}. If already paid, cancellation policy
              applies and an eligible refund will be queued for review.
            </p>
            <form onSubmit={submitPatientCancel}>
              <div className="form-group">
                <label htmlFor="pc-reason">Reason (Optional)</label>
                <textarea
                  id="pc-reason"
                  rows={3}
                  className="field-control"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Let us know why you need to cancel..."
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setCancelTarget(null)}
                >
                  Keep Appointment
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
