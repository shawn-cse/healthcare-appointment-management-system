import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { PublicLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';

export default function RegisterPage() {
  const { user, register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextUrl = searchParams.get('next') || '';

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    username: '',
    dob: '',
    gender: '',
    nid: '',
    address: '',
    password1: '',
    password2: '',
  });
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'default' | 'conflict' | 'ok';
    message: string;
  }>({ state: 'default', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [contactChecks, setContactChecks] = useState<
    Partial<Record<'phone' | 'email', { valid: boolean; message: string }>>
  >({});

  useEffect(() => {
    const requests = new AbortController();
    const timer = setTimeout(() => {
      for (const field of ['phone', 'email'] as const) {
        if (!form[field].trim()) {
          setContactChecks((previous) => {
            if (!previous[field]) return previous;
            const next = { ...previous };
            delete next[field];
            return next;
          });
          continue;
        }
        api
          .get<{ valid: boolean; message: string }>(`/auth/check-${field}`, {
            params: { [field]: form[field] },
            signal: requests.signal,
          })
          .then(({ data }) => setContactChecks((previous) => ({ ...previous, [field]: data })))
          .catch(() => {});
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      requests.abort();
    };
  }, [form.phone, form.email]);

  useEffect(() => {
    const val = form.username.trim();
    if (!val) {
      setUsernameStatus({ state: 'default', message: '' });
      return;
    }
    if (!/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/.test(val)) {
      setUsernameStatus({
        state: 'conflict',
        message: 'Username may only contain letters, numbers, and dots (.) — no underscores (_).',
      });
      return;
    }
    if (val.length < 5) {
      setUsernameStatus({
        state: 'conflict',
        message: 'Username must be at least 5 characters.',
      });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<{ status: string; message: string }>('/auth/check-username', {
          params: { username: val },
          signal: controller.signal,
        })
        .then((res) => {
          if (res.data.status === 'conflict' || res.data.status === 'invalid') {
            setUsernameStatus({
              state: 'conflict',
              message:
                res.data.status === 'conflict'
                  ? 'This username is already taken.'
                  : res.data.message || 'Invalid username.',
            });
          } else if (res.data.status === 'available') {
            setUsernameStatus({ state: 'ok', message: 'Username is available' });
          } else {
            setUsernameStatus({
              state: 'default',
              message: res.data.message || '',
            });
          }
        })
        .catch(() => {});
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [form.username]);

  if (user) {
    return <Navigate to={nextUrl.startsWith('/') ? nextUrl : '/dashboard'} replace />;
  }

  const dobAge = (() => {
    if (!form.dob) return null;
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const age =
      now.getFullYear() - Number(form.dob.slice(0, 4)) - Number(local.slice(5) < form.dob.slice(5));
    return age >= 0 ? age : null;
  })();

  const passwordMismatch = Boolean(form.password2 && form.password1 !== form.password2);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordMismatch) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    try {
      await register(form);
      showToast('Your account has been created. Welcome to Green Hospital.', 'success');
      navigate(nextUrl.startsWith('/') ? nextUrl : '/dashboard', { replace: true });
    } catch (err) {
      const msg = getApiErrorMessage(err, 'Unable to create account.');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      <div className="auth-background register-auth-bg">
        <div className="container register-container">
          <div className="register-intro">
            <p className="eyebrow">JOIN GREEN HOSPITAL</p>
            <h1>Care begins here.</h1>
            <p>
              Create a patient account to book specialist appointments, view consultation schedules,
              and track your visits in one place.
            </p>
          </div>

          <div className="panel padded-panel register-panel">
            <div className="register-panel-head">
              <div>
                <h2>Create patient account</h2>
                <p>
                  Already registered? <Link to="/login/patient">Sign in</Link>
                </p>
              </div>
            </div>

            {errorMsg && <div className="form-errors">{errorMsg}</div>}

            <form onSubmit={onSubmit} className="smart-form register-form">
              <div className="form-grid register-form-grid">
                <div className="form-group">
                  <label htmlFor="id_full_name">
                    Full Name <span className="required">*</span>
                  </label>
                  <input
                    id="id_full_name"
                    className="field-control"
                    required
                    maxLength={150}
                    autoComplete="name"
                    placeholder="Enter your full name"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_phone">
                    Phone <span className="required">*</span>
                  </label>
                  <input
                    id="id_phone"
                    className={`field-control ${
                      contactChecks.phone?.valid === false
                        ? 'input-conflict-red'
                        : contactChecks.phone?.valid === true
                          ? 'input-valid-green'
                          : ''
                    }`}
                    type="tel"
                    autoComplete="tel"
                    required
                    placeholder="01XXXXXXXXX"
                    value={form.phone}
                    onChange={(e) => {
                      setContactChecks((previous) => ({ ...previous, phone: undefined }));
                      setForm({ ...form, phone: e.target.value });
                    }}
                  />
                  {contactChecks.phone && (
                    <small
                      aria-live="polite"
                      className={`register-field-feedback ${contactChecks.phone.valid ? 'feedback-ok-green' : 'feedback-conflict-red'}`}
                    >
                      {contactChecks.phone.message}
                    </small>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="id_email">Email</label>
                  <input
                    id="id_email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    className={`field-control ${
                      contactChecks.email?.valid === false
                        ? 'input-conflict-red'
                        : contactChecks.email?.valid === true
                          ? 'input-valid-green'
                          : ''
                    }`}
                    value={form.email}
                    onChange={(e) => {
                      setContactChecks((previous) => ({ ...previous, email: undefined }));
                      setForm({ ...form, email: e.target.value });
                    }}
                  />
                  {contactChecks.email && (
                    <small
                      aria-live="polite"
                      className={`register-field-feedback ${contactChecks.email.valid ? 'feedback-ok-green' : 'feedback-conflict-red'}`}
                    >
                      {contactChecks.email.message}
                    </small>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="id_username">Username</label>
                  <input
                    id="id_username"
                    minLength={5}
                    maxLength={150}
                    className={`field-control ${
                      usernameStatus.state === 'conflict'
                        ? 'input-conflict-red'
                        : usernameStatus.state === 'ok'
                          ? 'input-valid-green'
                          : ''
                    }`}
                    placeholder="Letters, numbers, or dot (.)"
                    autoComplete="off"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                  {usernameStatus.message && (
                    <small
                      aria-live="polite"
                      className={`register-field-feedback ${
                        usernameStatus.state === 'conflict'
                          ? 'feedback-conflict-red'
                          : 'feedback-ok-green'
                      }`}
                    >
                      {usernameStatus.message}
                    </small>
                  )}
                </div>

                <div className="form-group">
                  <div className="register-label-row">
                    <label htmlFor="id_dob">
                      Date of birth <span className="required">*</span>
                    </label>
                    {dobAge !== null && <span className="register-age-badge">Age {dobAge}</span>}
                  </div>
                  <GreenDatePicker
                    id="id_dob"
                    isDob
                    maxToday
                    required
                    value={form.dob}
                    onChange={(val) => setForm({ ...form, dob: val })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_gender">
                    Gender <span className="required">*</span>
                  </label>
                  <select
                    id="id_gender"
                    className="field-control"
                    required
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  >
                    <option value="">Select gender</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="id_nid">NID</label>
                  <input
                    id="id_nid"
                    maxLength={30}
                    className="field-control"
                    placeholder="National ID number"
                    value={form.nid}
                    onChange={(e) => setForm({ ...form, nid: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_address">Address</label>
                  <input
                    id="id_address"
                    className="field-control"
                    autoComplete="street-address"
                    placeholder="House, road, area"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_password1">
                    Password <span className="required">*</span>
                  </label>
                  <input
                    id="id_password1"
                    type="password"
                    className="field-control"
                    required
                    autoComplete="new-password"
                    placeholder="Create a password"
                    value={form.password1}
                    onChange={(e) => setForm({ ...form, password1: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_password2">
                    Confirm password <span className="required">*</span>
                  </label>
                  <input
                    id="id_password2"
                    type="password"
                    className={`field-control ${passwordMismatch ? 'input-conflict-red' : ''}`}
                    required
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    value={form.password2}
                    onChange={(e) => setForm({ ...form, password2: e.target.value })}
                  />
                  {passwordMismatch && (
                    <small className="register-field-feedback feedback-conflict-red">
                      Passwords do not match.
                    </small>
                  )}
                </div>
              </div>

              <button
                className="button button-primary button-full register-submit-btn"
                type="submit"
                disabled={
                  submitting ||
                  usernameStatus.state === 'conflict' ||
                  contactChecks.phone?.valid === false ||
                  contactChecks.email?.valid === false ||
                  passwordMismatch
                }
              >
                {submitting ? 'Creating account…' : 'Create my account'} <Icon id="ic-arrow" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
