import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDateTime, formatLongDate } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Appointment } from '../types/index.ts';

interface DetailResponse {
  appointment: Appointment;
  patient_access?: { is_active: boolean; login_allowed: boolean } | null;
  operational_requests?: Array<{ id: number; subject: string; category: string; status: string }>;
  patient_history?: Array<{ id: number; reference: string; date: string; status: string }>;
  linked_candidate: { id: number; display_name: string } | null;
}

export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      showToast('Online payment verified and appointment confirmed.', 'success');
      const next = new URLSearchParams(searchParams);
      next.delete('payment');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast]);

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newSlot, setNewSlot] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<Array<{ id: number; label: string }>>([]);

  // Cancel modal
  const [cancelModal, setCancelModal] = useState(false);
  const [byDoctor, setByDoctor] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Link patient checkbox
  const [linkVerified, setLinkVerified] = useState(false);

  const loadDetail = useCallback(() => {
    setLoading(true);
    api
      .get<DetailResponse>(`/appointments/${id}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Appointment not found.'), 'error'))
      .finally(() => setLoading(false));
  }, [id, showToast]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setNewSlot('');
    setRescheduleSlots([]);
    if (!newDate || !data?.appointment.doctor.id) return;
    api.get<{ slots: Array<{ id: number; label: string }> }>('/catalog/slots-api', { params: { doctor: data.appointment.doctor.id, date: newDate } })
      .then(({ data }) => setRescheduleSlots(data.slots))
      .catch((err) => showToast(getApiErrorMessage(err, 'Could not load available times.'), 'error'));
  }, [newDate, data?.appointment.doctor.id, showToast]);

  if (!loading && !data) return <AppLayout><p role="alert">Appointment not found.</p></AppLayout>;
  if (loading || !data) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  const { appointment: ap, linked_candidate } = data;
  const isStaff = user && ['admin', 'receptionist', 'doctor'].includes(user.role);
  const canDoctorCancel = user && ['admin', 'doctor'].includes(user.role);
  const isCancellable = ['pending', 'confirmed'].includes(ap.status);
  const canCollectCash = (user?.role === 'admin' || user?.role === 'receptionist') && ap.accepted_payment_methods.includes('cash') && ap.payment_status === 'unpaid' && !['cancelled', 'expired'].includes(ap.status);

  const approval = (category: string) => data.operational_requests?.some((item) => item.category === category && item.status === 'approved');
  const canReschedule = isCancellable && (canDoctorCancel || (user?.role === 'receptionist' && approval('reschedule')));

  const handleCollectCash = async () => {
    const ok = await confirm({
      title: 'Record Cash Payment',
      message: `Confirm cash collection of Tk. ${ap.fee.toFixed(0)} for ${ap.reference}?`,
      confirmText: 'Record Cash & Confirm',
      type: 'info',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<{ appointment: Appointment; message: string }>(
        `/appointments/${ap.id}/collect`
      );
      setData((prev) => (prev ? { ...prev, appointment: res.data.appointment } : prev));
      showToast(res.data.message, 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to collect payment.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (nextStatus: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ appointment: Appointment; message: string }>(
        `/appointments/${ap.id}/status`,
        { status: nextStatus }
      );
      setData((prev) => (prev ? { ...prev, appointment: res.data.appointment } : prev));
      showToast(res.data.message, 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not update status.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePayOnline = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ gateway_url: string }>(`/appointments/${ap.id}/pay-online`);
      if (res.data.gateway_url) {
        window.location.href = res.data.gateway_url;
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Online gateway unavailable.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ appointment: Appointment; message: string }>(
        `/appointments/${ap.id}/cancel`,
        {
          actor_type: canDoctorCancel && byDoctor ? 'doctor' : 'patient',
          reason: cancelReason,
        }
      );
      setData((prev) => (prev ? { ...prev, appointment: res.data.appointment } : prev));
      showToast(res.data.message, 'success');
      setCancelModal(false);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Cancellation failed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLinkPatient = async () => {
    if (!linked_candidate || !linkVerified) return;
    setBusy(true);
    try {
      const res = await api.post<{ appointment: Appointment; message: string }>(
        `/appointments/${ap.id}/link`,
        { patient_id: linked_candidate.id, verified: 'yes' }
      );
      setData({ appointment: res.data.appointment, linked_candidate: null });
      showToast(res.data.message, 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Linking failed.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">APPOINTMENT SLIP · SERIAL #{ap.serial_number}</p>
          <h1>Reference {ap.reference}</h1>
          <p>
            {formatLongDate(ap.slot.date)} · {ap.slot.start_time_12h} – {ap.slot.end_time_12h}
          </p>
        </div>
        <div className="heading-actions no-print">
          <button type="button" className="button button-outline" onClick={() => window.print()}>
            Print Slip
          </button>
          <Link className="button button-outline" to="/appointments">
            ← Back to List
          </Link>
        </div>
      </div>

      {/* Status Banner */}
      <div className="metric-grid three-metrics" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-top">
            <span>Visit Status</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <StatusPill status={ap.status} label={ap.status_display} />
          </div>
          <small>{ap.visit_type_display}</small>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span>Consultation Fee</span>
          </div>
          <strong>Tk. {ap.fee.toFixed(0)}</strong>
          <small>
            {isStaff
              ? `Hospital: Tk. ${ap.hospital_cut.toFixed(0)} · Doctor: Tk. ${ap.doctor_cut.toFixed(0)}`
              : ap.payment_method_display}
          </small>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span>Payment Settlement</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <StatusPill status={ap.payment_status} label={ap.payment_status_display} />
          </div>
          <small>
            {ap.payment_due_at && ap.payment_status === 'unpaid'
              ? `Due before ${formatDateTime(ap.payment_due_at)}`
              : ap.source_display}
          </small>
        </div>
      </div>

      <div className="content-columns">
        {/* Left column: Consultation & Patient details */}
        <div className="panel appt-record-card">
          <div className="appt-record-header">
            <h2>Consultation &amp; Patient Record</h2>
            <span className="appt-serial-chip">Serial #{ap.serial_number}</span>
          </div>

          <div className="appt-record-sections">
            <div className="appt-record-section">
              <div className="appt-record-section-title">Consultation Details</div>
              <div className="summary-list">
                <div className="summary-row">
                  <span>Specialist Doctor</span>
                  <strong>
                    <Link to={`/doctors/${ap.doctor.profile_slug}`} className="appt-doc-link">
                      {ap.doctor.name}
                    </Link>
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Department</span>
                  <strong>{ap.doctor.department?.name || 'General Consultation'}</strong>
                </div>
                <div className="summary-row">
                  <span>Room No</span>
                  <strong>{ap.doctor.active_room || 'Unassigned'}</strong>
                </div>
              </div>
            </div>

            <div className="appt-record-section">
              <div className="appt-record-section-title">Patient Information</div>
              <div className="summary-list">
                <div className="summary-row">
                  <span>Patient Name</span>
                  <strong>{ap.patient_name}</strong>
                </div>
                <div className="summary-row">
                  <span>Contact Phone</span>
                  <strong>
                    <a href={`tel:${ap.guest_phone}`} className="appt-phone-link">
                      {ap.guest_phone}
                    </a>
                  </strong>
                </div>
                {ap.guest_dob && (
                  <div className="summary-row">
                    <span>Date of Birth</span>
                    <strong>{formatLongDate(ap.guest_dob)}</strong>
                  </div>
                )}
                <div className="summary-row">
                  <span>Portal Link</span>
                  <strong>
                    {ap.patient_username ? (
                      <span className="appt-portal-handle">@{ap.patient_username}</span>
                    ) : (
                      <span className="muted">Unlinked Guest / Walk-in</span>
                    )}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {(ap.notes || ap.cancellation_reason) && (
            <div className="appt-record-extra">
              {ap.notes && (
                <div className="appt-note-box">
                  <span className="appt-note-label">Notes</span>
                  <p>{ap.notes}</p>
                </div>
              )}
              {ap.cancellation_reason && (
                <div className="appt-cancel-reason-box">
                  <span className="appt-note-label">Cancellation Reason</span>
                  <p>{ap.cancellation_reason}</p>
                </div>
              )}
            </div>
          )}

          {ap.refund_request && (
            <div className="appt-refund-card">
              <div className="appt-refund-card-head">
                <div className="appt-refund-card-title">
                  <Icon id="ic-wallet" />
                  <strong>Refund Request</strong>
                </div>
                <StatusPill
                  status={ap.refund_request.status}
                  label={ap.refund_request.status_display}
                />
              </div>
              <div className="appt-refund-card-meta">
                <strong>Tk. {ap.refund_request.amount.toFixed(0)}</strong>
                <span>via {ap.refund_request.mode_display}</span>
              </div>
              {ap.refund_request.reason && (
                <p className="appt-refund-card-reason">{ap.refund_request.reason}</p>
              )}
            </div>
          )}

          {linked_candidate && (
            <div className="notice notice-warning no-print" style={{ marginTop: 18 }}>
              <strong>Registered Account Matches This Phone:</strong>{' '}
              {linked_candidate.display_name} (#{linked_candidate.id})
              <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={linkVerified}
                    onChange={(e) => setLinkVerified(e.target.checked)}
                  />
                  Verify patient identity and attach to portal account
                </label>
                <button
                  type="button"
                  className="button button-small button-primary"
                  disabled={!linkVerified || busy}
                  onClick={handleLinkPatient}
                >
                  Link Account
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Actions */}
        <div className="panel no-print" style={{ padding: 24, alignSelf: 'start' }}>
          <h2 style={{ marginTop: 0 }}>Desk &amp; Patient Actions</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {user?.role === 'patient' && ap.payment_status === 'unpaid' && isCancellable && <label className="form-group">Payment method
              <select className="field-control" disabled={busy} value={ap.payment_method} onChange={async (event) => {
                setBusy(true);
                try {
                  const { data } = await api.put<{ appointment: Appointment }>(`/appointments/${ap.id}/payment-method`, { payment_method: event.target.value });
                  setData((previous) => previous && { ...previous, appointment: data.appointment });
                } catch (err) { showToast(getApiErrorMessage(err, 'Could not change the payment method.'), 'error'); }
                finally { setBusy(false); }
              }}>{ap.accepted_payment_methods.map((method) => <option key={method} value={method}>{method === 'cash' ? 'Reception counter' : 'Online'}</option>)}</select>
            </label>}
            {user?.role === 'patient' && ap.payment_method === 'online' &&
              ap.payment_status === 'unpaid' &&
              ['pending', 'confirmed'].includes(ap.status) && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={handlePayOnline}
                >
                  <Icon id="ic-wallet" /> Pay Online Now (Tk. {ap.fee.toFixed(0)})
                </button>
              )}

            {canCollectCash && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={handleCollectCash}
              >
                <Icon id="ic-wallet" /> Collect Cash Now (Tk. {ap.fee.toFixed(0)})
              </button>
            )}

            {isStaff && ap.status === 'confirmed' && (
              <>
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={() => handleStatusChange('completed')}
                >
                  <Icon id="ic-check" /> Mark Completed
                </button>
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={() => handleStatusChange('no_show')}
                >
                  Mark Did Not Attend
                </button>
              </>
            )}

            {isCancellable && (canDoctorCancel || (user?.role === 'receptionist' && approval('cancel_appointment'))) && (
              <button
                type="button"
                className="button button-outline"
                style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.35)' }}
                disabled={busy}
                onClick={() => {
                  setByDoctor(false);
                  setCancelReason('');
                  setCancelModal(true);
                }}
              >
                Cancel Appointment
              </button>
            )}

            {user?.role === 'patient' && (
              <Link
                to={`/complaints/new?appointment=${ap.id}&issue=1`}
                className="button button-outline"
              >
                <Icon id="ic-help" /> Report Issue
              </Link>
            )}
            {canReschedule && <form className="form-grid" onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await api.put(`/appointments/${ap.id}/reschedule`, { slot_id: newSlot });
                setNewDate(''); loadDetail(); showToast('Appointment rescheduled.', 'success');
              } catch (err) { showToast(getApiErrorMessage(err, 'Could not reschedule the appointment.'), 'error'); }
              finally { setBusy(false); }
            }}>
              <label className="form-group">New consultation date<input className="field-control" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} required /></label>
              <label className="form-group">Available time<select className="field-control" value={newSlot} onChange={(e) => setNewSlot(e.target.value)} required>
                <option value="">Select time</option>{rescheduleSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
              </select></label>
              <button className="button button-outline" type="submit" disabled={busy || !newSlot}>Reschedule</button>
            </form>}
            {data.patient_access && ap.patient_id && <>
              <h3>Patient account</h3>
              <button type="button" className="button button-outline" onClick={async () => {
                try { await api.post(`/staff/${ap.patient_id}/toggle-active`); loadDetail(); }
                catch (err) { showToast(getApiErrorMessage(err, 'Account status could not be updated.'), 'error'); }
              }}>{data.patient_access.is_active ? 'Deactivate account' : 'Activate account'}</button>
            </>}
          </div>
        </div>
      </div>

      {!!data.operational_requests?.length && <section className="panel padded-panel" style={{ marginTop: 20 }}>
        <h2>Appointment requests</h2><ul>{data.operational_requests.map((request) => <li key={request.id}>
          <Link to={`/complaints/${request.id}`}>{request.subject}</Link> <StatusPill status={request.status} />
        </li>)}</ul>
      </section>}
      {!!data.patient_history?.length && <section className="panel padded-panel" style={{ marginTop: 20 }}>
        <h2>Patient appointment history</h2><ul>{data.patient_history.map((visit) => <li key={visit.id}>
          <Link to={`/appointments/${visit.id}`}>{visit.reference}</Link> {formatLongDate(visit.date)} <StatusPill status={visit.status} />
        </li>)}</ul>
      </section>}

      {/* Payment Transactions */}
      {ap.transactions && ap.transactions.length > 0 && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <div>
              <h2>Payment &amp; Refund Ledger</h2>{ap.transactions.some((payment) => payment.kind === 'charge' && payment.status === 'verified') && <button type="button" className="button button-small button-outline no-print" onClick={() => window.print()}>Print receipt</button>}
              <p>Audited transaction history recorded for this appointment</p>
            </div>
          </div>
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Amount (BDT)</th>
                  <th>Gateway / Ref ID</th>
                  <th>Handled By</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {ap.transactions.map((tx) => (
                  <tr key={tx.id} id={`payment-${tx.id}`}>
                    <td>{tx.kind_display}</td>
                    <td>{tx.method_display}</td>
                    <td>
                      <StatusPill status={tx.status} label={tx.status_display} />
                    </td>
                    <td>
                      <strong>{tx.amount.toFixed(2)}</strong>
                    </td>
                    <td>{tx.external_id || tx.validation_id || tx.refund_reference || '—'}</td>
                    <td>
                      {tx.handled_by_name}
                      {tx.note ? ` · ${tx.note}` : ''}
                    </td>
                    <td>{formatDateTime(tx.processed_at || tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModal && (
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
            if (e.target === e.currentTarget) setCancelModal(false);
          }}
        >
          <div className="panel" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>Cancel Appointment {ap.reference}</h2>
            <form onSubmit={handleCancelSubmit}>
              {canDoctorCancel && (
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={byDoctor}
                      onChange={(e) => setByDoctor(e.target.checked)}
                    />
                    Cancel on behalf of Doctor (issues 100% full refund if paid)
                  </label>
                </div>
              )}
              <div className="form-group">
                <label htmlFor="dt-cancel-reason">Cancellation Reason</label>
                <textarea
                  id="dt-cancel-reason"
                  rows={3}
                  className="field-control"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Enter reason for audit log..."
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setCancelModal(false)}
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                  disabled={busy}
                >
                  {busy ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
