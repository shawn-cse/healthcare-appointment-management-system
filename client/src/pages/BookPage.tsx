import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatLongDate } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { AppointmentSlot, Doctor } from '../types/index.ts';

export default function BookPage() {
  const { slotId } = useParams<{ slotId: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [slot, setSlot] = useState<AppointmentSlot | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const isStaffBooking = Boolean(user && ['doctor', 'receptionist', 'admin'].includes(user.role));

  // Patient fields
  const [visitType, setVisitType] = useState<'first' | 'followup' | 'report'>('first');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [notes, setNotes] = useState('');

  // Staff-assisted fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [source, setSource] = useState<'desk' | 'phone' | 'web'>('desk');
  const [paymentChoice, setPaymentChoice] = useState<'cash' | 'later'>('cash');

  useEffect(() => {
    api
      .get<{ slot: AppointmentSlot; doctor: Doctor; gateway_enabled: boolean }>(
        `/catalog/slots/${slotId}`
      )
      .then((res) => {
        setSlot(res.data.slot);
        setDoctor(res.data.doctor);
        setGatewayEnabled(res.data.gateway_enabled);
        if (res.data.doctor.payment_policy === 'within') {
          setPaymentMethod('online');
        }
      })
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Slot unavailable.'), 'error');
        navigate('/doctors');
      })
      .finally(() => setLoading(false));
  }, [slotId, navigate, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slot) return;
    setSubmitting(true);
    try {
      const payload = isStaffBooking
        ? {
            slot_id: slot.id,
            name,
            phone,
            dob: dob || undefined,
            visit_type: visitType,
            source,
            payment_choice: paymentChoice,
            notes,
          }
        : {
            slot_id: slot.id,
            visit_type: visitType,
            payment_method: paymentMethod,
            notes,
          };

      const res = await api.post<{ appointment: { id: number; reference: string }; message: string }>(
        '/appointments',
        payload
      );
      showToast(res.data.message || `Appointment ${res.data.appointment.reference} reserved.`, 'success');
      navigate(`/appointments/${res.data.appointment.id}`);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not complete reservation.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !slot || !doctor) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <Link className="back-link" to={`/doctors/${doctor.profile_slug}?date=${slot.date}`}>
            ‹ Back to Doctor Profile &amp; Slots
          </Link>
          <p className="eyebrow">
            {isStaffBooking ? 'HOSPITAL STAFF ASSISTED BOOKING' : 'BOOK CONSULTATION'}
          </p>
          <h1>
            {isStaffBooking ? 'Book Consultation on Behalf of Patient' : 'Confirm your appointment'}
          </h1>
          <p>
            {isStaffBooking
              ? 'Registering an appointment for a walk-in patient or telephone caller.'
              : 'Review your consultation details before reserving the time.'}
          </p>
        </div>
      </div>

      {isStaffBooking && user && (
        <div className="alert-box alert-info staff-banner-box">
          <div className="staff-banner-content">
            <Icon id="ic-user" />
            <div>
              <strong>Staff Booking Mode</strong>
              <p>
                Booking as <b>{user.display_name}</b> ({user.role_display}). The hospital system
                will automatically record your staff account as the booking agent.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="checkout-layout">
        <div className="panel padded-panel">
          <div className="panel-title-section">
            <h2>Consultation Specialist</h2>
            <p>Consultant &amp; Chamber Details</p>
          </div>

          <div className="booking-identity">
            <div className="booking-avatar-wrap">
              {doctor.avatar ? (
                <img src={doctor.avatar} alt={doctor.full_doctor_title} className="doctor-photo" />
              ) : (
                <svg
                  className="doctor-vector-avatar"
                  viewBox="0 0 64 64"
                  style={{ width: 48, height: 48 }}
                >
                  <use href={`#${doctor.default_avatar}`} />
                </svg>
              )}
            </div>
            <div>
              <strong>{doctor.full_doctor_title}</strong>
              <span className="bmdc-tag" style={{ display: 'inline-block', margin: '2px 0' }}>
                {doctor.bmdc_display}
              </span>
              <div className="qual-text">{doctor.qualifications || 'Consultant Specialist'}</div>
              <small className="text-muted">
                {doctor.designation} · {doctor.department.name}
              </small>
            </div>
          </div>

          {doctor.institute && (
            <div className="doctor-institute-row">
              <Icon id="ic-building" />
              <span>{doctor.institute}</span>
            </div>
          )}

          <div className="details-divider" />

          <div
            className="details-row highlight-serial-row"
            style={{
              background: '#eaf8f1',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #c2ebd5',
              marginBottom: 10,
            }}
          >
            <span style={{ fontWeight: 700, color: '#104b42' }}>Allocated Serial Number</span>
            <b style={{ fontSize: 18, color: '#146347' }}>Serial #{slot.next_serial_number}</b>
          </div>

          <div className="details-row">
            <span>Chamber / Center</span>
            <b>{doctor.chamber?.name || 'Green Hospital Outpatient & Consultation Center'}</b>
          </div>
          <div className="details-row">
            <span>Room Number</span>
            <b className="highlight-room-badge">{doctor.active_room || 'OPD'}</b>
          </div>
          <div className="details-row">
            <span>Helpline / Contact</span>
            <b className="contact-highlight">{doctor.active_contact}</b>
          </div>

          <div className="details-divider" />

          <div className="details-row">
            <span>Appointment Date</span>
            <b className="date-highlight">{formatLongDate(slot.date)}</b>
          </div>
          <div className="details-row">
            <span>Consultation Time</span>
            <b>
              {slot.start_time_12h} – {slot.end_time_12h}
            </b>
          </div>

          {!isStaffBooking && user && (
            <>
              <div className="details-divider" />
              <div className="details-row">
                <span>Patient Name</span>
                <b>{user.display_name}</b>
              </div>
              <div className="details-row">
                <span>Patient Contact</span>
                <b>{user.phone}</b>
              </div>
            </>
          )}

          <div className="form-tip margin-top">
            <Icon id="ic-alert" />
            <span>
              Follow-up fee rate applies only when previous consultation with this doctor was
              completed within {doctor.followup_within_days} days.
            </span>
          </div>
        </div>

        <div className="panel padded-panel">
          <div className="panel-title-section">
            <h2>{isStaffBooking ? 'Patient & Visit Information' : 'Visit & Payment'}</h2>
            <p>
              {isStaffBooking
                ? 'Fill in patient details to record this appointment.'
                : 'Select consultation category and payment method.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="smart-form">
            {isStaffBooking && (
              <>
                <div className="form-group">
                  <label htmlFor="staff-name">
                    Patient Full Name <span className="required">*</span>
                  </label>
                  <input
                    id="staff-name"
                    className="field-control"
                    required
                    placeholder="e.g. Mohammad Ali"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-phone">
                    Patient Contact Phone <span className="required">*</span>
                  </label>
                  <input
                    id="staff-phone"
                    className="field-control"
                    required
                    placeholder="+8801712345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="staff-dob">Date of Birth (optional)</label>
                  <GreenDatePicker
                    id="staff-dob"
                    isDob
                    maxToday
                    value={dob}
                    onChange={setDob}
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label htmlFor="visit-type">
                Consultation Type <span className="required">*</span>
              </label>
              <select
                id="visit-type"
                className="field-control"
                value={visitType}
                onChange={(e) => setVisitType(e.target.value as 'first' | 'followup' | 'report')}
              >
                <option value="first">First Visit / New Patient</option>
                <option value="followup">Second Visit / Follow-up</option>
                <option value="report">Report Review</option>
              </select>
            </div>

            {isStaffBooking ? (
              <>
                <div className="form-group">
                  <label htmlFor="staff-source">Booking Channel</label>
                  <select
                    id="staff-source"
                    className="field-control"
                    value={source}
                    onChange={(e) => setSource(e.target.value as 'desk' | 'phone' | 'web')}
                  >
                    <option value="desk">Reception Desk / Walk-in</option>
                    <option value="phone">Telephone / Helpline</option>
                    <option value="web">Assisted Online / Email</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="staff-pay">Payment Collection</label>
                  <select
                    id="staff-pay"
                    className="field-control"
                    value={paymentChoice}
                    onChange={(e) => setPaymentChoice(e.target.value as 'cash' | 'later')}
                  >
                    <option value="cash">Cash Collected Now</option>
                    <option value="later">Pay Later (at reception on appointment day)</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="form-group">
                <label htmlFor="pay-method">
                  Payment Method <span className="required">*</span>
                </label>
                <select
                  id="pay-method"
                  className="field-control"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'online')}
                >
                  {doctor.payment_policy !== 'within' && (
                    <option value="cash">Pay at hospital</option>
                  )}
                  {(doctor.payment_policy === 'within' || gatewayEnabled) && (
                    <option value="online">
                      {doctor.payment_policy === 'within'
                        ? 'Pay online (before deadline)'
                        : 'Pay online'}
                    </option>
                  )}
                </select>
              </div>
            )}

            <div className="form-group form-span">
              <label htmlFor="booking-notes">
                {isStaffBooking ? 'Staff & Consultation Notes (optional)' : 'Reason for visit (optional)'}
              </label>
              <textarea
                id="booking-notes"
                rows={2}
                className="field-control"
                placeholder="Optional reason for visit, symptoms, or remarks"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="checkout-prices">
              <div>
                <span>New consultation</span>
                <b>Tk. {Math.round(doctor.initial_fee)}</b>
              </div>
              <div>
                <span>Eligible follow-up</span>
                <b>Tk. {Math.round(doctor.followup_fee)}</b>
              </div>
              <div>
                <span>Report review</span>
                <b>Tk. {Math.round(doctor.report_fee)}</b>
              </div>
            </div>

            <p className="tiny-note">
              {isStaffBooking
                ? 'Booking created by staff is instantly assigned reference ID and tracked under staff reception logs.'
                : doctor.payment_policy === 'within'
                  ? `Payment must be verified within ${doctor.payment_deadline_hours} hours of reservation, or the reservation expires.`
                  : 'You may pay at reception on the appointment day. Cancellation terms apply as configured by your doctor.'}
            </p>

            <button
              className="button button-primary button-full"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                'Submitting…'
              ) : isStaffBooking ? (
                <>
                  Confirm &amp; Book for Patient <Icon id="ic-check" />
                </>
              ) : (
                <>
                  Reserve appointment <Icon id="ic-arrow" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
