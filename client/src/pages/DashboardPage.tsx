import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatLongDate } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { Appointment } from '../types/index.ts';

interface DashboardResponse {
  role: string;
  today: string;
  counts: Record<string, number>;
  upcoming?: Appointment[];
  history?: Appointment[];
  today_appointments?: Appointment[];
  recent_appointments?: Appointment[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);

  useEffect(() => {
    api
      .get<DashboardResponse>('/dashboard')
      .then((res) => setData(res.data))
      .catch(() => {});
  }, []);

  if (!user || !data) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  if (user.role === 'patient') {
    const upcoming = data.upcoming || [];
    return (
      <AppLayout>
        <div className="dashboard-page patient-dashboard">
          <div className="page-heading">
            <div>
              <p className="eyebrow">PATIENT PORTAL</p>
              <h1>Good to see you, {user.first_name || user.display_name}.</h1>
              <p>
                Your healthcare appointments, clinical consultations, and hospital support in one
                place.
              </p>
            </div>
            <div className="heading-actions">
              <Link className="button button-primary" to="/doctors">
                <Icon id="ic-plus" /> Book New Appointment
              </Link>
            </div>
          </div>

          <div className="metric-grid three-metrics">
            <div className="metric-card">
              <div className="metric-top">
                <span>Upcoming Consultations</span>
                <span className="metric-icon green">
                  <Icon id="ic-calendar" />
                </span>
              </div>
              <strong>{data.counts.upcoming ?? 0}</strong>
              <small>Scheduled appointments</small>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Completed Visits</span>
                <span className="metric-icon blue">
                  <Icon id="ic-check" />
                </span>
              </div>
              <strong>{data.counts.completed ?? 0}</strong>
              <small>Consultation history</small>
            </div>

            <div className="metric-card">
              <div className="metric-top">
                <span>Active Support Tickets</span>
                <span className="metric-icon amber">
                  <Icon id="ic-help" />
                </span>
              </div>
              <strong>{data.counts.complaints ?? 0}</strong>
              <small>In review or inquiry</small>
            </div>
          </div>

          <div className="content-columns">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h2>Upcoming Appointments</h2>
                  <p>Your next confirmed specialist visits and chamber locations</p>
                </div>
                <Link className="text-link" to="/appointments">
                  View all appointments <Icon id="ic-arrow" />
                </Link>
              </div>

              <div className="appointment-feed">
                {upcoming.length ? (
                  upcoming.map((a) => {
                    const dt = new Date(`${a.slot.date}T00:00:00`);
                    const day = String(dt.getDate()).padStart(2, '0');
                    const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(dt);
                    return (
                      <Link key={a.id} className="appointment-item" to={`/appointments/${a.id}`}>
                        <div className="date-box">
                          <b>{day}</b>
                          <small>{month}</small>
                        </div>
                        <div className="appointment-main">
                          <strong>Dr. {a.doctor.name}</strong>
                          <span>
                            {a.doctor.department.name} · {a.slot.start_time_12h}
                          </span>
                          <small>
                            Ref: {a.reference} · Chamber: {a.doctor.active_room || 'OPD Chamber'}
                          </small>
                        </div>
                        <StatusPill status={a.status} label={a.status_display} />
                      </Link>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Icon id="ic-calendar" />
                    </span>
                    <h3>No upcoming appointments</h3>
                    <p>
                      You have no active consultations booked. Find a specialist doctor and choose a
                      convenient time slot.
                    </p>
                    <Link className="button button-primary button-sm" to="/doctors">
                      <Icon id="ic-stethoscope" /> Find a Specialist Doctor
                    </Link>
                  </div>
                )}
              </div>
            </div>

            <div className="side-stack">
              <div className="feature-panel">
                <div className="feature-ring">
                  <Icon id="ic-stethoscope" />
                </div>
                <p className="eyebrow">SPECIALIST CARE</p>
                <h2>Need to see a doctor?</h2>
                <p>
                  Explore medical departments, consultant schedules, and book direct consultations
                  at Green Hospital, Mirpur.
                </p>
                <Link className="button button-white" to="/doctors">
                  Browse All Doctors <Icon id="ic-arrow" />
                </Link>
              </div>

              <div className="panel support-card">
                <span className="support-card-icon">
                  <Icon id="ic-help" />
                </span>
                <div>
                  <h3>Complaints &amp; Support</h3>
                  <p>
                    Need help with your visit, reports, or wish to file a concern? Our patient team
                    responds within 24 hours.
                  </p>
                  <Link className="text-link" to="/complaints">
                    Open Support Desk <Icon id="ic-arrow" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const todayAppointments = data.today_appointments || [];
  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {user.role === 'admin'
              ? 'HOSPITAL OVERVIEW'
              : user.role === 'doctor'
                ? 'YOUR CLINIC'
                : 'RECEPTION WORKSPACE'}
          </p>
          <h1>
            {user.role === 'admin'
              ? 'Hospital operations'
              : user.role === 'doctor'
                ? `Good day, Dr. ${user.first_name || user.username}`
                : 'Welcome to the front desk'}
          </h1>
          <p>
            Here&apos;s the latest activity across{' '}
            {user.role === 'doctor'
              ? 'your clinic'
              : user.role === 'receptionist'
                ? 'your assigned doctors'
                : 'Green Hospital'}
            .
          </p>
        </div>
        {user.role !== 'doctor' && (
          <Link to="/reception/book" className="button button-primary">
            <Icon id="ic-plus" /> New appointment
          </Link>
        )}
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-top">
            <span>Today&apos;s patients</span>
            <span className="metric-icon green">
              <Icon id="ic-users" />
            </span>
          </div>
          <strong>{data.counts.today ?? 0}</strong>
          <small>Today&apos;s scheduled visits</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Upcoming bookings</span>
            <span className="metric-icon blue">
              <Icon id="ic-calendar" />
            </span>
          </div>
          <strong>{data.counts.upcoming ?? 0}</strong>
          <small>Current active reservations</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Unpaid bookings</span>
            <span className="metric-icon amber">
              <Icon id="ic-wallet" />
            </span>
          </div>
          <strong>{data.counts.unpaid ?? 0}</strong>
          <small>Require collection</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Available today</span>
            <span className="metric-icon violet">
              <Icon id="ic-clock" />
            </span>
          </div>
          <strong>{data.counts.spaces ?? 0}</strong>
          <small>Open appointment places</small>
        </div>
      </div>

      <div className="content-columns">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Today&apos;s appointment queue</h2>
              <p>{formatLongDate(data.today)} · Your scheduled patients</p>
            </div>
            <Link to={`/appointments?date=${data.today}`} className="text-link">
              Full queue <Icon id="ic-arrow" />
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor / time</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {todayAppointments.length ? (
                  todayAppointments.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span className="table-primary">{a.patient_name}</span>
                        <small className="table-sub">{a.reference}</small>
                      </td>
                      <td>
                        <span>{a.doctor.name}</span>
                        <small className="table-sub">{a.slot.start_time_12h}</small>
                      </td>
                      <td>
                        <StatusPill status={a.payment_status} label={a.payment_status_display} />
                      </td>
                      <td>
                        <StatusPill status={a.status} label={a.status_display} />
                      </td>
                      <td>
                        <Link className="table-action" to={`/appointments/${a.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty">
                      No consultations scheduled for today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-stack">
          <div className="panel padded-panel quick-actions">
            <h2>Quick actions</h2>
            <p>Go directly to the tasks you use most.</p>
            {user.role !== 'doctor' && (
              <Link to="/reception/book">
                <span className="quick-icon">
                  <Icon id="ic-plus" />
                </span>
                <span>
                  <b>Book for a patient</b>
                  <small>Desk or telephone bookings</small>
                </span>
                <Icon id="ic-arrow" />
              </Link>
            )}
            <Link to="/schedules">
              <span className="quick-icon">
                <Icon id="ic-calendar" />
              </span>
              <span>
                <b>View schedules</b>
                <small>Open slots and availability</small>
              </span>
              <Icon id="ic-arrow" />
            </Link>
            {user.role === 'admin' || user.role === 'receptionist' ? (
              <Link to="/finance/refunds">
                <span className="quick-icon">
                  <Icon id="ic-wallet" />
                </span>
                <span>
                  <b>Refund approvals</b>
                  <small>{data.counts.refunds ?? 0} waiting for review</small>
                </span>
                <Icon id="ic-arrow" />
              </Link>
            ) : (
              <Link to="/reports">
                <span className="quick-icon">
                  <Icon id="ic-chart" />
                </span>
                <span>
                  <b>Consultation reports</b>
                  <small>Your activity and collections</small>
                </span>
                <Icon id="ic-arrow" />
              </Link>
            )}
          </div>

          <div className="mini-panel">
            <div>
              <span>Open refund requests</span>
              <strong>{data.counts.refunds ?? 0}</strong>
            </div>
            <div>
              <span>Awaiting confirmation</span>
              <strong>{data.counts.pending ?? 0}</strong>
            </div>
            {user.role === 'admin' && (
              <>
                <div>
                  <span>Active doctors</span>
                  <strong>{data.counts.doctors ?? 0}</strong>
                </div>
                <div>
                  <span>Registered patients</span>
                  <strong>{data.counts.patients ?? 0}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
