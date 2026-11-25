import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { PublicLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';

export default function LoginPage() {
  const { kind } = useParams<{ kind: string }>();
  const portalKind: 'patient' | 'staff' = kind === 'staff' ? 'staff' : 'patient';
  const [searchParams] = useSearchParams();
  const nextUrl = searchParams.get('next') || '';

  const { user, login } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (kind !== 'patient' && kind !== 'staff') {
    return <Navigate to="/login" replace />;
  }
  if (user) {
    return <Navigate to={nextUrl.startsWith('/') ? nextUrl : '/dashboard'} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const loggedIn = await login(identifier.trim(), password, portalKind);
      showToast(`Welcome back, ${loggedIn.first_name || loggedIn.username}.`, 'success');
      navigate(nextUrl.startsWith('/') ? nextUrl : '/dashboard', { replace: true });
    } catch (err) {
      const msg = getApiErrorMessage(
        err,
        'Incorrect login details. Please verify your credentials and try again.'
      );
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div className="auth-background">
        <div className="container auth-container">
          <div className="auth-card">
            <Link className="back-link" to="/login">
              ‹ Return to Portal Selection
            </Link>
            <div className="auth-icon">
              <Icon id={portalKind === 'patient' ? 'ic-user' : 'ic-stethoscope'} />
            </div>
            <p className="eyebrow">
              {portalKind === 'patient' ? 'PATIENT ACCESS' : 'AUTHORIZED CLINICAL ACCESS'}
            </p>
            <h1>
              {portalKind === 'patient' ? 'Patient Sign In' : 'Doctor & Staff Sign In'}
            </h1>
            <p className="auth-intro">
              {portalKind === 'patient'
                ? 'Manage your specialist doctor consultations, appointment schedules, and visit history.'
                : 'Authorized clinical workspace for doctors, receptionists, and hospital administration.'}
            </p>

            {errorMsg && (
              <div className="form-errors" style={{ marginBottom: 14 }}>
                {errorMsg}
              </div>
            )}

            <form onSubmit={onSubmit} className="smart-form auth-form">
              <div className="form-group">
                <label htmlFor="identifier">
                  {portalKind === 'patient'
                    ? 'Phone Number, Username, or Email'
                    : 'Staff Username, Email, or Phone'}
                </label>
                <input
                  className="field-control"
                  type="text"
                  id="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder={
                    portalKind === 'patient'
                      ? '01XXXXXXXXX or username'
                      : 'Enter your staff username or ID'
                  }
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="password-wrap">
                  <input
                    className="field-control"
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                className="button button-primary button-full"
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Signing in…' : 'Sign In to Portal'} <Icon id="ic-arrow" />
              </button>
            </form>

            {portalKind === 'patient' ? (
              <p className="auth-bottom">
                Don&apos;t have a patient account?{' '}
                <Link to={nextUrl ? `/register?next=${encodeURIComponent(nextUrl)}` : '/register'}>
                  Register here
                </Link>
              </p>
            ) : (
              <p className="auth-bottom muted">
                Staff credentials are provisioned by Green Hospital Administration.
              </p>
            )}
          </div>

          <div className="auth-side">
            <span className="decorative-cross">
              <svg viewBox="0 0 40 40" style={{ width: 160, height: 160, opacity: 0.12 }}>
                <use href="#ic-hospital-logo" />
              </svg>
            </span>
            <p className="eyebrow">CLINICAL EXCELLENCE</p>
            <h2>Modern Healthcare &amp; Ethical Clinical Standards</h2>
            <p>
              Green Hospital provides high-standard outpatient consultations, advanced diagnostics,
              and dedicated patient support in Mirpur, Dhaka.
            </p>
            <div className="auth-side-footer">
              <Icon id="ic-map-pin" /> Mirpur, Dhaka · 24/7 Hotline: +88096100016211
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
