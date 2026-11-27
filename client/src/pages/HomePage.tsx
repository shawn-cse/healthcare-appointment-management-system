import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { PublicLayout } from '../components/Layout.tsx';
import type { Department } from '../types/index.ts';

export default function HomePage() {
  const location = useLocation();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hospital, setHospital] = useState({ phone: '+88096100016211', address: 'Mirpur, Dhaka' });
  const { phone, address } = hospital;

  useEffect(() => {
    api
      .get<{ departments: Department[]; hospital: { phone: string; address: string } }>('/catalog/home')
      .then((res) => {
        setDepartments(res.data.departments || []);
        if (res.data.hospital?.phone) setHospital(res.data.hospital);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);

  return (
    <PublicLayout>
      <section className="hero">
        <div className="container hero-layout">
          <div className="hero-copy">
            <h1>Specialist consultations at <span>Green Hospital</span></h1>
            <p>Find a doctor, check consultation times, and book an appointment in {address}.</p>
            <div className="hero-actions">
              <Link className="button button-primary button-lg" to="/doctors">
                Find Doctors <Icon id="ic-arrow" />
              </Link>
            </div>
            <div className="hero-trust">
              <span className="trust-symbol">
                <Icon id="ic-check" />
              </span>
              <span>Instant queue confirmation</span>
              <span className="trust-sep" />
              <span>Convenient clinic hours</span>
              <span className="trust-sep" />
              <span>Clear upfront fees</span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-arch">
              <div className="medical-orb orb-one" />
              <div className="medical-orb orb-two" />
              <div className="hero-symbol">
                <Icon id="ic-activity" />
              </div>
              <div className="hero-visual-word">
                GREEN
                <br />
                HOSPITAL<span>.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="quick-strip">
        <div className="container quick-strip-inner">
          <div>
            <Icon id="ic-hospital-logo" />
            <span>
              <b>Green Hospital</b>
              <small>Mirpur, Dhaka</small>
            </span>
          </div>
          <div>
            <Icon id="ic-clock" />
            <span>
              <b>Online Consultation</b>
              <small>Choose a suitable consultation session</small>
            </span>
          </div>
          <div>
            <Icon id="ic-help" />
            <span>
              <b>24/7 Assistance</b>
              <small>Call {phone}</small>
            </span>
          </div>
        </div>
      </section>

      <section id="care" className="home-section">
        <div className="container">
          <div
            className="section-header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              gap: 15,
            }}
          >
            <div>
              <h2>Departments</h2>
            </div>
            <Link to="/doctors" className="button button-outline button-sm">
              Find Specialists <Icon id="ic-arrow" />
            </Link>
          </div>
          <div className="department-grid">
            {departments.length ? (
              departments.map((d) => (
                <Link
                  key={d.id}
                  className="department-tile"
                  to={`/doctors?department=${d.id}`}
                >
                  <div className="department-tile-icon">
                    <Icon id="ic-stethoscope" />
                  </div>
                  <h3>{d.name}</h3>
                  <p>{d.description || 'Specialist consultation and patient care.'}</p>
                  <span className="text-link" style={{ marginTop: 10, fontSize: 11 }}>
                    View Doctors ›
                  </span>
                </Link>
              ))
            ) : (
              <p>Department information will appear here soon.</p>
            )}
          </div>
        </div>
      </section>

      <section className="home-section home-info-summary" id="about-contact">
        <div className="container">
          <div className="hospital-section-head">
            <div>
              <span className="hospital-section-eyebrow">HOSPITAL INFORMATION</span>
              <h2>About Us, Hospital Policy &amp; Contact</h2>
            </div>
            <Link to="/hospital-info" className="button button-outline button-sm">
              View All Hospital Info <Icon id="ic-arrow" />
            </Link>
          </div>

          <div className="home-info-cards">
            <article className="panel home-info-card">
              <span className="home-info-card-icon">
                <Icon id="ic-building" />
              </span>
              <h3>About Us</h3>
              <p>
                Green Hospital Medical Center &amp; Diagnostic provides verified multi-specialty
                consultations, dedicated chamber receptionists, and instant appointment confirmation in{' '}
                {address}.
              </p>
              <Link to="/hospital-info#about-us" className="text-link">
                Read About Green Hospital ›
              </Link>
            </article>

            <article className="panel home-info-card">
              <span className="home-info-card-icon">
                <Icon id="ic-clipboard" />
              </span>
              <h3>Hospital Policy</h3>
              <p>
                Transparent first-visit, follow-up, and report-review fees, online and reception
                payment deadlines, and clear cancellation &amp; refund guidelines.
              </p>
              <Link to="/hospital-info#hospital-policy" className="text-link">
                Review Hospital Policies ›
              </Link>
            </article>

            <article className="panel home-info-card">
              <span className="home-info-card-icon">
                <Icon id="ic-phone" />
              </span>
              <h3>Contact Us</h3>
              <p>
                Outpatient clinics run <strong>8:00 AM – 10:00 PM</strong> daily and Emergency care
                is open <strong>24/7</strong>. Call{' '}
                <a href={`tel:${phone}`}>
                  <strong>{phone}</strong>
                </a>
                .
              </p>
              <Link to="/hospital-info#contact-us" className="text-link">
                Get Contact &amp; Support Details ›
              </Link>
            </article>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
