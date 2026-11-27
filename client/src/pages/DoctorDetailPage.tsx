import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout, PublicLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatLongDate } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ProfessionalDetails } from '../components/DoctorCard.tsx';
import type { AppointmentSlot, Doctor, WeeklyAvailability } from '../types/index.ts';

export default function DoctorDetailPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const { hash } = useLocation();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const selectedDate = params.get('date') || '';
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [weeklySchedules, setWeeklySchedules] = useState<WeeklyAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    api
      .get<{ doctor: Doctor; weekly_schedules: WeeklyAvailability[]; upcoming_slots: AppointmentSlot[] }>(
        `/catalog/doctors/${identifier}`
      )
      .then((res) => {
        setDoctor(res.data.doctor);
        setSlots(res.data.upcoming_slots.filter((slot) => slot.booking_open));
        setWeeklySchedules(res.data.weekly_schedules || []);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [identifier]);

  useEffect(() => {
    if (loading || (hash !== '#weekly-schedule' && hash !== '#booking')) return;
    const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [hash, loading]);

  const Wrapper = user ? AppLayout : PublicLayout;

  if (loading) {
    return (
      <Wrapper>
        <LoadingScreen />
      </Wrapper>
    );
  }

  if (notFound || !doctor) {
    return (
      <Wrapper>
        <div className="container" style={{ padding: '48px 0' }}>
          <div className="panel empty-state">
            <h3>Specialist doctor not found</h3>
            <p>The doctor profile you requested is currently unavailable.</p>
            <Link to="/doctors" className="button button-primary button-sm">
              Back to Specialist Doctors
            </Link>
          </div>
        </div>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="doctor-profile-page container">
        <div className="profile-top-bar">
          <Link className="back-link" to="/doctors">
            ‹ Back to Specialist Doctors
          </Link>
          <span className="breadcrumb-dept">{doctor.department?.name || 'General Consultation'}</span>
        </div>

        <div className="doctor-profile-card panel">
          <div className="doctor-profile-top">
            <div className="doctor-profile-avatar-wrap">
              {doctor.avatar ? (
                <img
                  src={doctor.avatar}
                  alt={doctor.full_doctor_title}
                  className="doctor-profile-avatar"
                />
              ) : (
                <svg className="doctor-vector-avatar-profile" viewBox="0 0 64 64">
                  <use href={`#${doctor.default_avatar}`} />
                </svg>
              )}
            </div>

            <div className="doctor-profile-meta">
              <h1 className="doctor-profile-title">{doctor.full_doctor_title}</h1>
              <div className="doctor-badge-row">
                <span className="dept-pill-tag">{doctor.department?.name || 'General Consultation'}</span>
                {doctor.bmdc_display && <span className="bmdc-pill-tag">{doctor.bmdc_display}</span>}
              </div>
              <p className="doctor-profile-designation">{doctor.designation}</p>
              <ProfessionalDetails doctor={doctor} />
            </div>
          </div>

          <div className="doctor-meta-bar">
            {doctor.active_room && (
              <div className="meta-bar-item">
                <span className="meta-bar-label">
                  <Icon id="ic-building" className="icon icon-xs" /> Room No
                </span>
                <b className="meta-bar-value">{doctor.active_room}</b>
              </div>
            )}
            <div className="meta-bar-item">
              <span className="meta-bar-label">
                <Icon id="ic-user" className="icon icon-xs" /> Receptionist
              </span>
              <b className="meta-bar-value">{doctor.assigned_receptionist_name}</b>
            </div>
            <div className="meta-bar-item">
              <span className="meta-bar-label">
                <Icon id="ic-phone" className="icon icon-xs" /> Helpline
              </span>
              <b className="meta-bar-value">
                <a
                  href={`tel:${doctor.assigned_receptionist_phone || doctor.active_contact}`}
                  className="helpline-link"
                >
                  {doctor.assigned_receptionist_phone || doctor.active_contact}
                </a>
              </b>
            </div>
          </div>

          <div className="doctor-fees-strip">
            <span className="fees-strip-title">
              <Icon id="ic-wallet" className="icon icon-xs" /> Consultation Fees:
            </span>
            <div className="fees-strip-pills">
              <div className="fee-pill-card">
                <span className="fee-pill-type">First Visit</span>
                <b className="fee-pill-amount">Tk. {Math.round(doctor.initial_fee)}</b>
              </div>
              <div className="fee-pill-card">
                <span className="fee-pill-type">
                  Follow-up (<small>within {doctor.followup_within_days}d</small>):
                </span>
                <b className="fee-pill-amount">Tk. {Math.round(doctor.followup_fee)}</b>
              </div>
              <div className="fee-pill-card">
                <span className="fee-pill-type">Report Checking</span>
                <b className="fee-pill-amount">Tk. {Math.round(doctor.report_fee)}</b>
              </div>
            </div>
          </div>
        </div>

        <section className="panel doctor-schedule-panel" id="weekly-schedule">
          <h2>Consultation times</h2>
          {weeklySchedules.length ? (
            <ul className="consultation-periods">
              {[...weeklySchedules].sort((a, b) => (a.weekday + 2) % 7 - (b.weekday + 2) % 7).map((period) => (
                <li key={period.id}><strong>{period.weekday_name}</strong> {period.start_time_12h}–{period.end_time_12h}</li>
              ))}
            </ul>
          ) : <p>No recurring consultation times have been published.</p>}
          <h2 id="booking">Book appointment</h2>
          {slots.length ? (
            <>
              <label className="form-group">
                Available date
                <select className="field-control" value={selectedDate}
                  onChange={(e) => setParams({ date: e.target.value }, { replace: true })}>
                  <option value="">Choose a date</option>
                  {[...new Set(slots.map((slot) => slot.date))].map((day) => <option key={day} value={day}>{formatLongDate(day)}</option>)}
                </select>
              </label>
              <div className="consultation-times">
                {slots.filter((slot) => slot.date === selectedDate).map((slot) => (
                  <Link key={slot.id} className="button button-outline" to={user ? `/book/${slot.id}` : `/login/patient?next=${encodeURIComponent(`/book/${slot.id}`)}`}>
                    {slot.start_time_12h}–{slot.end_time_12h}
                  </Link>
                ))}
              </div>
            </>
          ) : <p>No appointments are currently open for booking.</p>}
        </section>
      </div>
    </Wrapper>
  );
}
