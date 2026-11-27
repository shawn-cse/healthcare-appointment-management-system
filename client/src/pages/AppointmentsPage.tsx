import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { PageSizeControl, SortableColumn } from '../components/ManagementTable.tsx';
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
  const paymentMethod = searchParams.get('payment_method') || '';
  const visitType = searchParams.get('visit_type') || '';
  const q = searchParams.get('q') || '';
  const datePreset = searchParams.get('date_preset') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const doctor = searchParams.get('doctor') || '';
  const sort = searchParams.get('sort') || 'date_desc';
  const page = Number(searchParams.get('page') || 1) || 1;
  const size = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 25));

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

  const isPatient = user?.role === 'patient';

  const fetchList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (payment) params.set('payment', payment);
    if (paymentMethod) params.set('payment_method', paymentMethod);
    if (visitType) params.set('visit_type', visitType);
    if (q) params.set('q', q);
    if (datePreset) params.set('date_preset', datePreset);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (doctor) params.set('doctor', doctor);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));
    params.set('limit', String(size));

    api
      .get<ApptsResponse>(`/appointments?${params.toString()}`)
      .then((res) => {
        setData(res.data);
        setSelectedIds([]);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load appointments.'), 'error'))
      .finally(() => setLoading(false));
  }, [status, payment, paymentMethod, visitType, q, datePreset, dateFrom, dateTo, doctor, sort, page, size, showToast]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (searchParams.get('payment') === 'cancelled') {
      showToast('Online payment gateway session was cancelled or failed.', 'warning');
    }
  }, [searchParams, showToast]);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in updates)) next.set('page', '1');
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  // Sync URL ?q -> local input if navigated externally
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  // Instant live typing search (debounced)
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === q) return;
    const t = window.setTimeout(() => {
      setParam({ q: trimmed || null });
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchInput, q, setParam]);

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
          visit_type: qVisitType !== quickTarget.visit_type ? qVisitType : undefined,
          fee: Number(qFee) !== quickTarget.fee ? qFee : undefined,
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
          <h1>{isPatient ? 'My Appointments' : 'Appointments'}</h1>
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

      {/* Unified Excel Sheet Appointments Container */}
      <div className="excel-sheet-panel">
        <div className="excel-sheet-header-bar no-print">
          <div className="activity-filter-toolbar" style={{ marginBottom: 10 }}>
            <div className="staff-live-search-wrap" style={{ flex: '1 1 280px', maxWidth: 460 }}>
              <Icon id="ic-search" className="icon search-ic" />
              <input
                type="text"
                className="field-control"
                placeholder={
                  isPatient
                    ? 'Type to search reference or doctor...'
                    : 'Type to search ref, patient name, phone, doctor...'
                }
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

            <div className="sheet-indicator" style={{ marginLeft: 'auto' }}>
              <span className="live-dot-pulse" />
              <span>
                Showing <strong>{appts.length}</strong> of <strong>{data?.total ?? 0}</strong>{' '}
                bookings
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <select
              className="field-control activity-select"
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setParam({ status: e.target.value || null })}
            >
              {statusTabs.map(([val, lbl]) => (
                <option key={val || 'all'} value={val}>
                  {val === '' ? (isPatient ? 'All Statuses' : 'All Statuses') : lbl}
                </option>
              ))}
            </select>

            {!isPatient && (
              <>
                <select
                  className="field-control activity-select"
                  aria-label="Filter by date range"
                  value={dateFrom || dateTo ? 'custom' : datePreset}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    if (nextVal === 'custom') {
                      setParam({ date_preset: 'custom' });
                    } else {
                      setParam({
                        date_preset: nextVal || null,
                        date_from: null,
                        date_to: null,
                      });
                    }
                  }}
                >
                  <option value="">Any Date</option>
                  <option value="today">Today</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="custom">Custom Date Range</option>
                </select>

                {(datePreset === 'custom' || dateFrom || dateTo) && (
                  <>
                    <div style={{ width: 185 }}>
                      <GreenDatePicker
                        value={dateFrom}
                        onChange={(v) => setParam({ date_from: v || null, date_preset: 'custom' })}
                        placeholder="From Date"
                      />
                    </div>
                    <div style={{ width: 185 }}>
                      <GreenDatePicker
                        value={dateTo}
                        onChange={(v) => setParam({ date_to: v || null, date_preset: 'custom' })}
                        placeholder="To Date"
                      />
                    </div>
                  </>
                )}

                {data?.doctor_options && data.doctor_options.length > 1 && (
                  <select
                    className="field-control activity-select"
                    aria-label="Filter by specialist"
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
                  className="field-control activity-select"
                  aria-label="Filter by payment status"
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
                <select className="field-control activity-select" aria-label="Filter by payment method" value={paymentMethod} onChange={(e) => setParam({ payment_method: e.target.value || null })}>
                  <option value="">Any payment method</option><option value="cash">Cash</option><option value="online">Online</option>
                </select>
                <select className="field-control activity-select" aria-label="Filter by visit type" value={visitType} onChange={(e) => setParam({ visit_type: e.target.value || null })}>
                  <option value="">Any visit type</option><option value="first">First visit</option><option value="followup">Follow-up</option><option value="report">Report review</option>
                </select>
              </>
            )}

            <select
              className="field-control activity-select"
              aria-label="Sort appointments"
              value={sort}
              onChange={(e) => setParam({ sort: e.target.value })}
            >
              {sort.includes('.') && <option value={sort}>Column sort</option>}
              <option value="date_desc">Latest to oldest</option>
              <option value="date_asc">Oldest to latest</option>
              <option value="newest">Recently Booked</option>
              <option value="fee_desc">Highest Fee</option>
              <option value="fee_asc">Lowest Fee</option>
            </select>
          </div>
        </div>

        {/* Staff Bulk Bar */}
        {!isPatient && selectedIds.length > 0 && (
          <form
            onSubmit={handleBulkSubmit}
            className="notice notice-info no-print"
            style={{
              margin: '12px 18px',
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
        {loading ? (
          <LoadingScreen label="Loading consultation sheet..." />
        ) : appts.length === 0 ? (
          <div className="empty-state" style={{ padding: 48 }}>
            <h3>No appointments match these filters</h3>
            <p className="muted">Try another search keyword or adjust dropdown filters.</p>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-grid-table">
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
                  <SortableColumn name="reference" sort={sort} onChange={(sort) => setParam({ sort })}>Appointment ID</SortableColumn>
                  {!isPatient && <SortableColumn name="patient" sort={sort} onChange={(sort) => setParam({ sort })}>Patient</SortableColumn>}
                  {user?.role !== 'doctor' && <SortableColumn name="doctor" sort={sort} onChange={(sort) => setParam({ sort })}>Doctor</SortableColumn>}
                  <SortableColumn name="date" sort={sort} onChange={(sort) => setParam({ sort })}>Date &amp; Time</SortableColumn>
                  <SortableColumn name="visit" sort={sort} onChange={(sort) => setParam({ sort })}>Visit Type</SortableColumn>
                  <SortableColumn name="payment" sort={sort} onChange={(sort) => setParam({ sort })}>Payment</SortableColumn>
                  <SortableColumn name="status" sort={sort} onChange={(sort) => setParam({ sort })}>Appointment Status</SortableColumn>
                  <th className="no-print">{isPatient ? 'Report Issue' : 'Actions'}</th>
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
                    {!isPatient && (
                      <td>
                        <strong>{ap.patient_name}</strong>
                        <div className="muted" style={{ fontSize: '0.82rem' }}>
                          {ap.guest_phone}
                          {ap.patient_username ? ` · @${ap.patient_username}` : ' · Walk-in/Guest'}
                        </div>
                      </td>
                    )}
                    {user?.role !== 'doctor' && <td>
                      <strong>{ap.doctor.name}</strong>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {ap.doctor.department?.name || 'General Consultation'}
                        {ap.doctor.active_room ? ` · ${ap.doctor.active_room}` : ''}
                      </div>
                    </td>}
                    <td>
                      <strong>{formatDisplayDate(ap.slot.date)}</strong>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {ap.slot.start_time_12h} – {ap.slot.end_time_12h}
                      </div>
                    </td>
                    <td>{ap.visit_type_display}</td>
                    <td>
                      <strong>BDT {ap.fee.toFixed(2)}</strong>
                      <div className="muted">{ap.payment_method_display}</div>
                      <StatusPill status={ap.payment_status} label={ap.payment_status_display} />
                    </td>
                    <td><StatusPill status={ap.status} label={ap.status_display} /></td>
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
                        {isPatient && <Link className="button button-small button-outline" to={`/complaints/new?appointment=${ap.id}&issue=1`}>Report Issue</Link>}
                        {!isPatient && <Link className="button button-small button-outline" to={`/appointments/${ap.id}`}>Details</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && (
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
            <PageSizeControl size={size} onChange={(next) => setParam({ limit: String(next) })} />
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
            <div style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0 }}>Quick Update — {quickTarget.reference}</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {quickTarget.patient_name} · {quickTarget.doctor.name}
              </p>
            </div>

            <form onSubmit={submitQuickUpdate} className="form-grid two-col">
              <div className="form-group">
                <label htmlFor="qu-visit">Visit Type</label>
                <select
                  id="qu-visit"
                  disabled={quickTarget.payment_status !== 'unpaid' || user?.role === 'receptionist'}
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
                  disabled={quickTarget.payment_status !== 'unpaid' || user?.role === 'receptionist'}
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
                  {(user?.role === 'doctor' || user?.role === 'admin' || qStatus === 'cancelled') && <option value="cancelled">Cancelled</option>}
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

              {user?.role !== 'doctor' && quickTarget.accepted_payment_methods.includes('cash') && quickTarget.payment_status === 'unpaid' && qStatus !== 'cancelled' && (
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
                <label htmlFor="qu-notes">Appointment note</label>
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
    </AppLayout>
  );
}
