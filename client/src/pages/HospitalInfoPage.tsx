import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout, PublicLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface HomeCatalogResponse {
  hospital: {
    name: string;
    phone: string;
    address: string;
  };
  departments: Array<{ id: number }>;
  doctor_count: number;
}

const POLICIES = [
  {
    icon: 'ic-calendar',
    title: 'Booking & Queue',
    text: 'Slots follow each specialist’s weekly schedule with automatic queue numbers. Online booking defaults to 24-hour advance notice and up to 60 days ahead.',
  },
  {
    icon: 'ic-wallet',
    title: 'Consultation Fees',
    text: 'First Visit, Follow-up, and Report Review rates are shown upfront per doctor. Follow-up and report rates apply within the doctor’s eligibility window (30 days default).',
  },
  {
    icon: 'ic-check',
    title: 'Payments & Deadlines',
    text: 'Pay by cash at reception or online where supported. Bookings with a payment deadline (4 hours default) expire automatically if unpaid.',
  },
  {
    icon: 'ic-alert',
    title: 'Cancellations & Refunds',
    text: 'Request cancellations or reschedules via the Patient Portal before consultation start. Doctor cancellations receive a full refund; patient cancellations follow the doctor’s policy (10% default deduction).',
  },
];

export default function HospitalInfoPage() {
  const { user } = useAuth();
  const [hospital, setHospital] = useState({
    name: 'Green Hospital',
    phone: '+88096100016211',
    address: 'Mirpur, Dhaka, Bangladesh',
  });
  const [counts, setCounts] = useState<{ doctors: number | null; departments: number | null }>({
    doctors: null,
    departments: null,
  });

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
        setCounts({
          doctors: typeof res.data.doctor_count === 'number' ? res.data.doctor_count : null,
          departments: Array.isArray(res.data.departments) ? res.data.departments.length : null,
        });
      })
      .catch(() => {});
  }, []);

  const Wrapper = user ? AppLayout : PublicLayout;

  return (
    <Wrapper>
      <div className="container hospital-info-page">
        <header className="panel hospital-info-header">
          <div>
            <span className="hospital-section-eyebrow">HOSPITAL INFORMATION</span>
            <h1>{hospital.name} — About, Policies &amp; Contact</h1>
            <p>
              DGHS-approved multi-specialty medical center and diagnostic facility in{' '}
              <strong>{hospital.address}</strong>.
            </p>
          </div>
          <div className="hospital-info-header-actions">
            <Link to="/doctors" className="button button-primary button-sm">
              Find Doctors <Icon id="ic-arrow" />
            </Link>
            <Link
              to={user ? '/complaints' : '/login/patient?next=%2Fcomplaints'}
              className="button button-outline button-sm"
            >
              Support Desk
            </Link>
          </div>
        </header>

        <div className="hospital-info-top-grid">
          <section id="about-us" className="panel hospital-concise-card">
            <div className="hospital-concise-title">
              <span className="home-info-card-icon">
                <Icon id="ic-building" />
              </span>
              <h2>About Us</h2>
            </div>
            <p className="hospital-concise-desc">
              {hospital.name} provides specialist outpatient consultations, diagnostic services, and
              24/7 emergency care with transparent fees and dedicated chamber receptionists.
            </p>
            <ul className="hospital-concise-list">
              <li>
                <strong>Specialists &amp; Clinics:</strong>{' '}
                {counts.doctors !== null ? `${counts.doctors}+ verified doctors` : 'Verified specialists'}
                {counts.departments !== null ? ` across ${counts.departments} departments` : ''}.
              </li>
              <li>
                <strong>Chamber Care:</strong> Confirmed queue numbers linked to assigned rooms and
                receptionists.
              </li>
              <li>
                <strong>Patient Portal:</strong> Online booking, payment tracking, refunds, and
                support requests.
              </li>
            </ul>
          </section>

          <section id="contact-us" className="panel hospital-concise-card">
            <div className="hospital-concise-title">
              <span className="home-info-card-icon">
                <Icon id="ic-phone" />
              </span>
              <h2>Contact &amp; Hours</h2>
            </div>
            <dl className="hospital-contact-dl">
              <div>
                <dt>24/7 Hotline</dt>
                <dd>
                  <a href={`tel:${hospital.phone}`}>{hospital.phone}</a>
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{hospital.address}</dd>
              </div>
              <div>
                <dt>OPD Clinics</dt>
                <dd>8:00 AM – 10:00 PM (Daily)</dd>
              </div>
              <div>
                <dt>Emergency</dt>
                <dd>Open 24 Hours / 7 Days</dd>
              </div>
            </dl>
          </section>
        </div>

        <section id="hospital-policy" className="panel hospital-concise-card">
          <div className="hospital-concise-title">
            <span className="home-info-card-icon">
              <Icon id="ic-clipboard" />
            </span>
            <h2>Hospital Policy</h2>
          </div>
          <div className="hospital-policy-grid">
            {POLICIES.map((item) => (
              <article key={item.title} className="hospital-policy-card">
                <div className="hospital-policy-card-head">
                  <span className="hospital-policy-icon">
                    <Icon id={item.icon} />
                  </span>
                  <h3>{item.title}</h3>
                </div>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Wrapper>
  );
}
