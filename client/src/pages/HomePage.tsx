import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { PublicLayout } from '../components/Layout.tsx';
import type { Department } from '../types/index.ts';

export default function HomePage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [phone, setPhone] = useState('+88096100016211');

  useEffect(() => {
    api
      .get<{ departments: Department[]; hospital: { phone: string } }>('/catalog/home')
      .then((res) => {
        setDepartments(res.data.departments || []);
        if (res.data.hospital?.phone) setPhone(res.data.hospital.phone);
      })
      .catch(() => {});
  }, []);

  return (
    <PublicLayout>
      <section className="hero">
        <div className="container hero-layout">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="green-dot" /> YOUR HEALTH. OUR PRIORITY.
            </div>
            <h1>
              Thoughtful care.
              <br />
              <span>Right when you need it.</span>
            </h1>
            <p>
              Consult with trusted specialist departments at Green Hospital, Dhaka. A clear and
              convenient way to plan your next medical consultation.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary button-lg" to="/doctors">
                Consult with a Doctor <Icon id="ic-arrow" />
              </Link>
            </div>
            <div className="hero-trust">
              <span className="trust-symbol">
                <Icon id="ic-check" />
              </span>
              <span>Sequential serial numbers</span>
              <span className="trust-sep" />
              <span>Flexible clinic schedules</span>
              <span className="trust-sep" />
              <span>Transparent consultation fees</span>
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
            <div className="floating-info floating-one">
              <span className="float-icon">
                <Icon id="ic-calendar" />
              </span>
              <div>
                <b>Consultations</b>
                <small>At your convenience</small>
              </div>
            </div>
            <div className="floating-info floating-two">
              <span className="float-icon">
                <Icon id="ic-stethoscope" />
              </span>
              <div>
                <b>Specialist care</b>
                <small>Across 10 departments</small>
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
              <p className="eyebrow">CARE SPECIALTIES</p>
              <h2>Explore our clinical departments</h2>
              <p>Find the right care team and specialists for your medical needs.</p>
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

      <section className="cta-band" id="specialists">
        <div className="container cta-band-inner">
          <div>
            <p className="eyebrow">YOUR NEXT CONSULTATION</p>
            <h2>One less thing to worry about.</h2>
            <p>
              Explore doctor availability, chamber locations, and reserve a consultation in
              minutes.
            </p>
          </div>
          <Link className="button button-white button-lg" to="/doctors">
            Consult Specialist <Icon id="ic-arrow" />
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
