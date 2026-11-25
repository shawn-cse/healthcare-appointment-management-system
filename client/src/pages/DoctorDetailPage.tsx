import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout, PublicLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatLongDate } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { Doctor, WeeklyAvailability } from '../types/index.ts';

export default function DoctorDetailPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const { user } = useAuth();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [weeklySchedules, setWeeklySchedules] = useState<WeeklyAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    api
      .get<{ doctor: Doctor; weekly_schedules: WeeklyAvailability[] }>(
        `/catalog/doctors/${identifier}`
      )
      .then((res) => {
        setDoctor(res.data.doctor);
        setWeeklySchedules(res.data.weekly_schedules || []);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [identifier]);

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
          <span className="breadcrumb-dept">{doctor.department.name}</span>
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
              <div className="doctor-badge-row">
                <span className="dept-pill-tag">{doctor.department.name}</span>
                <span className="bmdc-pill-tag">{doctor.bmdc_display}</span>
              </div>

              <h1 className="doctor-profile-title">{doctor.full_doctor_title}</h1>
              <p className="doctor-profile-designation">
                {doctor.designation}
                {doctor.institute ? ` · ${doctor.institute}` : ''}
              </p>

              <div className="doctor-qualifications-inline">
                {doctor.qualifications_list.length ? (
                  doctor.qualifications_list.map((line, i) => (
                    <div key={i} className="qual-line-item">
                      <span className="qual-dot">•</span>
                      <span className="qual-text">{line}</span>
                    </div>
                  ))
                ) : (
                  <div className="qual-line-item">
                    <span className="qual-dot">•</span>
                    <span className="qual-text">MBBS, Specialist Consultant</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="doctor-meta-bar">
            {doctor.active_room && (
              <div className="meta-bar-item">
                <span className="meta-bar-label">
                  <Icon id="ic-building" className="icon icon-xs" /> Room
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
                  href={`tel:${doctor.active_contact || '+88096100016211'}`}
                  className="helpline-link"
                >
                  {doctor.active_contact || '+88096100016211'}
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
                <span className="fee-pill-type">1st Visit:</span>
                <b className="fee-pill-amount">Tk. {Math.round(doctor.initial_fee)}</b>
              </div>
              <div className="fee-pill-card">
                <span className="fee-pill-type">
                  Follow-up (<small>within {doctor.followup_within_days}d</small>):
                </span>
                <b className="fee-pill-amount">Tk. {Math.round(doctor.followup_fee)}</b>
              </div>
              <div className="fee-pill-card">
                <span className="fee-pill-type">Report Review:</span>
                <b className="fee-pill-amount">Tk. {Math.round(doctor.report_fee)}</b>
              </div>
            </div>
          </div>
        </div>

        <div className="panel doctor-schedule-panel" id="weekly-schedule">
          <div className="schedule-panel-header">
            <div className="schedule-header-title">
              <span className="schedule-badge">APPOINTMENT SCHEDULE</span>
              <h2>Weekly Available Schedule</h2>
              <p>
                Select a consultation session below to book your appointment and receive your
                sequential serial number:
              </p>
            </div>
          </div>

          <div className="schedule-sessions-list">
            {weeklySchedules.length ? (
              weeklySchedules.map((sched) => (
                <div key={sched.id} className="schedule-session-row">
                  <div className="session-day-block">
                    <span className="session-weekday-pill">
                      {sched.weekday_short.toUpperCase()}
                    </span>
                  </div>
                  <div className="session-info-block">
                    <div className="session-date-line">
                      {sched.upcoming_date ? formatLongDate(sched.upcoming_date) : sched.weekday_name}
                    </div>
                    <div className="session-time-line">
                      <Icon id="ic-clock" className="icon icon-xs" /> {sched.start_time_12h} –{' '}
                      {sched.end_time_12h}
                    </div>
                    {doctor.active_room && (
                      <div className="session-room-line">
                        <Icon id="ic-building" className="icon icon-xs" /> {doctor.active_room}
                      </div>
                    )}
                  </div>
                  <div className="session-action-block">
                    {sched.slot ? (
                      user ? (
                        <Link
                          to={`/book/${sched.slot.id}`}
                          className="button button-primary slot-book-button"
                        >
                          Book Appointment <Icon id="ic-arrow" />
                        </Link>
                      ) : (
                        <Link
                          to={`/login/patient?next=${encodeURIComponent(`/book/${sched.slot.id}`)}`}
                          className="button button-primary slot-book-button"
                        >
                          Book Appointment <Icon id="ic-arrow" />
                        </Link>
                      )
                    ) : (
                      <span className="slot-opening-soon-pill">Opening Soon</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <span className="empty-icon">
                  <Icon id="ic-calendar" />
                </span>
                <h3>No Consultation Sessions Currently Published</h3>
                <p>
                  Consultation sessions are being scheduled. For advance bookings, please contact
                  Green Hospital helpline at <b>{doctor.active_contact || '+88096100016211'}</b>.
                </p>
              </div>
            )}
          </div>

          <div className="schedule-footer-strip">
            <div className="footer-strip-item">
              <Icon id="ic-check" />
              <span>
                Sequential serial numbers are allocated automatically upon booking. Payment can be
                completed at hospital reception desk or online.
              </span>
            </div>
            <div className="footer-strip-item helpline-strip-item">
              <Icon id="ic-phone" />
              <span>
                Need phone booking or emergency serial? Call Green Hospital 24/7 hotline at{' '}
                <a href="tel:+88096100016211">
                  <b>+88096100016211</b>
                </a>
                .
              </span>
            </div>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
