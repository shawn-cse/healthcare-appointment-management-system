import { Link } from 'react-router-dom';
import { Icon } from '../components/Icons.tsx';
import { PublicLayout } from '../components/Layout.tsx';

export default function LoginChoicePage() {
  return (
    <PublicLayout>
      <section className="auth-background">
        <div className="container">
          <div className="auth-heading">
            <p className="eyebrow">GREEN HOSPITAL DHAKA</p>
            <h1>Hospital Portal Access</h1>
            <p>
              Please select the appropriate portal to access your healthcare services or clinical
              workspace.
            </p>
          </div>

          <div className="portal-grid">
            <Link className="portal-card" to="/login/patient">
              <span className="portal-icon">
                <Icon id="ic-user" />
              </span>
              <span className="portal-tag">PATIENT SERVICES</span>
              <h2>Patient Portal</h2>
              <p>
                Book specialist doctor consultations, manage appointments, download visit slips, and
                access support.
              </p>
              <span className="portal-link">
                Sign in to Patient Portal <Icon id="ic-arrow" />
              </span>
            </Link>

            <Link className="portal-card" to="/login/staff">
              <span className="portal-icon alt">
                <Icon id="ic-stethoscope" />
              </span>
              <span className="portal-tag">CLINICAL &amp; ADMINISTRATIVE</span>
              <h2>Doctor &amp; Staff Portal</h2>
              <p>
                Authorized clinical workspace for medical specialists, chamber receptionists, and
                hospital administrators.
              </p>
              <span className="portal-link">
                Sign in to Staff Workspace <Icon id="ic-arrow" />
              </span>
            </Link>
          </div>

          <p className="auth-bottom">
            New patient? <Link to="/register">Register an account for online booking</Link>
          </p>
        </div>
      </section>
    </PublicLayout>
  );
}
