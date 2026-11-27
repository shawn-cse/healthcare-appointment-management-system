import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout, PublicLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { Department } from '../types/index.ts';

interface HomeCatalogResponse {
  hospital: {
    name: string;
    phone: string;
    address: string;
  };
  departments: Department[];
  doctor_count: number;
}

const HOSPITAL_POLICIES = [
  {
    id: 'booking',
    icon: 'ic-calendar',
    title: 'Appointment Booking & Serials',
    items: [
      'Consultation sessions are published from each specialist’s recurring weekly schedule.',
      'Your appointment queue number is assigned automatically upon booking for each consultation session.',
      'Online booking typically opens up to 60 days ahead with a standard 24-hour advance notice, unless a doctor sets a custom booking window.',
      'For urgent consultations or same-day serial availability, please call the 24/7 hospital helpline or visit the reception desk.',
    ],
  },
  {
    id: 'fees',
    icon: 'ic-wallet',
    title: 'Consultation Fees & Visit Tiers',
    items: [
      'Each doctor publishes transparent fees for First Visit (new consultation), Follow-up Visit, and Report Review.',
      'Follow-up and report-review rates apply to patients with a completed visit with the same doctor within their configured eligibility window (30 days by default).',
      'Confirmed fee details are shown before booking and remain attached to your appointment record.',
    ],
  },
  {
    id: 'payment',
    icon: 'ic-check',
    title: 'Payment & Confirmation Policy',
    items: [
      'Accepted payment methods (Cash at Reception Desk and/or Online Payment) are shown on each doctor’s profile and booking page.',
      'Doctors may allow payment on the appointment day or require payment within a configured deadline (4 hours by default) after booking.',
      'Unpaid bookings that pass a required payment deadline expire automatically so the serial can be released to other patients.',
    ],
  },
  {
    id: 'cancellation',
    icon: 'ic-alert',
    title: 'Cancellation & Refund Policy',
    items: [
      'Upcoming appointments can be requested for cancellation or rescheduling through the Patient Portal Support Desk before the session starts.',
      'Paid appointments cancelled by the doctor or hospital qualify for a full refund.',
      'Patient-initiated cancellations of paid bookings follow the doctor’s cancellation policy (10% standard deduction unless specified otherwise), with refunds tracked for cash or online settlement.',
    ],
  },
];

export default function HospitalInfoPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [hospital, setHospital] = useState({
    name: 'Green Hospital',
    phone: '+88096100016211',
    address: 'Mirpur, Dhaka, Bangladesh',
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctorCount, setDoctorCount] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<HomeCatalogResponse>('/catalog/home')
      .then((res) => {
        if (res.data.hospital) {
          setHospital((prev) => ({
            name: res.data.hospital.name || prev.name,
            phone: res.data.hospital.phone || prev.phone,
            address: res.data.hospital.address || prev.address,
          }));
        }
        setDepartments(res.data.departments || []);
        if (typeof res.data.doctor_count === 'number') {
          setDoctorCount(res.data.doctor_count);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const targetId = location.hash ? location.hash.slice(1) : '';
    if (!targetId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);

  const Wrapper = user ? AppLayout : PublicLayout;
  const activeSection = location.hash.replace('#', '') || 'about-us';

  return (
    <Wrapper>
      <div className="container hospital-info-page">
        <section className="panel hospital-info-hero">
          <div className="hospital-info-hero-copy">
            <span className="status status-confirmed">DGHS Approved Hospital · 24/7 Emergency Wing</span>
            <h1>About {hospital.name}, Policies &amp; Contact</h1>
            <p>
              Everything patients and visitors need to know about our clinical services in{' '}
              <strong>{hospital.address}</strong>, appointment and refund policies, and 24/7 support
              channels.
            </p>
          </div>
          <nav className="hospital-info-jump-nav" aria-label="Hospital information sections">
            <a
              href="#about-us"
              className={`hospital-jump-pill ${activeSection === 'about-us' ? 'is-active' : ''}`}
            >
              <Icon id="ic-building" /> About Us
            </a>
            <a
              href="#hospital-policy"
              className={`hospital-jump-pill ${activeSection === 'hospital-policy' ? 'is-active' : ''}`}
            >
              <Icon id="ic-clipboard" /> Hospital Policy
            </a>
            <a
              href="#contact-us"
              className={`hospital-jump-pill ${activeSection === 'contact-us' ? 'is-active' : ''}`}
            >
              <Icon id="ic-phone" /> Contact Us
            </a>
          </nav>
        </section>

        <section id="about-us" className="panel hospital-info-section">
          <div className="hospital-section-head">
            <div>
              <span className="hospital-section-eyebrow">ABOUT US</span>
              <h2>{hospital.name} Medical Center &amp; Diagnostic</h2>
            </div>
            <Link to="/doctors" className="button button-primary button-sm">
              Find Specialist Doctors <Icon id="ic-arrow" />
            </Link>
          </div>

          <p className="hospital-section-lead">
            {hospital.name} is a multi-specialty healthcare and diagnostic center in {hospital.address},
            built around transparent specialist consultations, organized chamber scheduling, and
            accessible patient support.
          </p>

          <div className="hospital-stats-grid">
            <div className="hospital-stat-card">
              <Icon id="ic-stethoscope" />
              <div>
                <strong>{doctorCount !== null ? `${doctorCount}+` : 'Multi-Specialty'}</strong>
                <span>Verified Specialist Doctors</span>
              </div>
            </div>
            <div className="hospital-stat-card">
              <Icon id="ic-building" />
              <div>
                <strong>{departments.length || '10+'}</strong>
                <span>Active Clinical Departments</span>
              </div>
            </div>
            <div className="hospital-stat-card">
              <Icon id="ic-clock" />
              <div>
                <strong>8:00 AM – 10:00 PM</strong>
                <span>Daily Outpatient (OPD) Clinics</span>
              </div>
            </div>
            <div className="hospital-stat-card">
              <Icon id="ic-activity" />
              <div>
                <strong>24 / 7</strong>
                <span>Emergency &amp; Hotline Assistance</span>
              </div>
            </div>
          </div>

          <div className="hospital-about-highlights">
            <div className="hospital-highlight-item">
              <h3>Verified Clinical Directory</h3>
              <p>
                Patients can search specialists by name, department, qualifications, room number,
                and gender, and view exact consultation days, fees, and assigned receptionists before
                booking.
              </p>
            </div>
            <div className="hospital-highlight-item">
              <h3>Organized Queue &amp; Chamber Care</h3>
              <p>
                Each confirmed consultation receives a guaranteed queue number tied to a specific
                chamber room and dedicated receptionist desk for smooth check-in.
              </p>
            </div>
            <div className="hospital-highlight-item">
              <h3>Integrated Patient Portal</h3>
              <p>
                Registered patients can manage upcoming and past appointments, complete online or
                counter payments, track refunds, and contact support from one account.
              </p>
            </div>
          </div>

          {departments.length > 0 && (
            <div className="hospital-dept-chips-wrap">
              <h3>Available Clinical Departments</h3>
              <div className="hospital-dept-chips">
                {departments.map((dept) => (
                  <Link
                    key={dept.id}
                    to={`/doctors?department=${dept.id}`}
                    className="hospital-dept-chip"
                  >
                    {dept.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <section id="hospital-policy" className="panel hospital-info-section">
          <div className="hospital-section-head">
            <div>
              <span className="hospital-section-eyebrow">HOSPITAL POLICY</span>
              <h2>Appointments, Fees, Payments &amp; Patient Care Rules</h2>
            </div>
          </div>
          <p className="hospital-section-lead">
            Our operational policies protect fair serial allocation, clear fee visibility, and timely
            refund handling across both online and reception-desk bookings.
          </p>

          <div className="hospital-policy-grid">
            {HOSPITAL_POLICIES.map((policy) => (
              <article key={policy.id} className="hospital-policy-card">
                <div className="hospital-policy-card-head">
                  <span className="hospital-policy-icon">
                    <Icon id={policy.icon} />
                  </span>
                  <h3>{policy.title}</h3>
                </div>
                <ul>
                  {policy.items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="contact-us" className="panel hospital-info-section">
          <div className="hospital-section-head">
            <div>
              <span className="hospital-section-eyebrow">CONTACT US</span>
              <h2>Reach {hospital.name} Desk &amp; Emergency Support</h2>
            </div>
          </div>
          <p className="hospital-section-lead">
            Need help finding a specialist, confirming an urgent consultation, or checking an
            existing appointment? Contact our 24/7 hospital helpline or visit our reception desk.
          </p>

          <div className="hospital-contact-grid">
            <div className="hospital-contact-card">
              <span className="hospital-contact-icon">
                <Icon id="ic-phone" />
              </span>
              <h3>24/7 Hotline &amp; Appointments</h3>
              <p>Call anytime for emergency assistance, urgent serials, or reception desk support.</p>
              <a href={`tel:${hospital.phone}`} className="hospital-contact-action">
                {hospital.phone}
              </a>
            </div>

            <div className="hospital-contact-card">
              <span className="hospital-contact-icon">
                <Icon id="ic-map-pin" />
              </span>
              <h3>Main Hospital &amp; Chambers</h3>
              <p>Visit our outpatient consultation rooms and diagnostic center directly.</p>
              <strong className="hospital-contact-value">{hospital.address}</strong>
            </div>

            <div className="hospital-contact-card">
              <span className="hospital-contact-icon">
                <Icon id="ic-clock" />
              </span>
              <h3>Visiting &amp; Clinic Hours</h3>
              <p>Morning &amp; evening specialist sessions run daily; emergency wing never closes.</p>
              <strong className="hospital-contact-value">
                OPD: 8:00 AM – 10:00 PM · Emergency: 24/7
              </strong>
            </div>

            <div className="hospital-contact-card">
              <span className="hospital-contact-icon">
                <Icon id="ic-help" />
              </span>
              <h3>Patient Support &amp; Requests</h3>
              <p>
                Submit a support ticket, cancellation request, or reschedule inquiry through your
                patient account.
              </p>
              <div className="hospital-contact-links">
                <Link
                  to={user ? '/complaints' : '/login/patient?next=%2Fcomplaints'}
                  className="button button-primary button-sm"
                >
                  Open Support Desk <Icon id="ic-arrow" />
                </Link>
                <Link to="/doctors" className="button button-outline button-sm">
                  Doctor Helplines
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Wrapper>
  );
}
