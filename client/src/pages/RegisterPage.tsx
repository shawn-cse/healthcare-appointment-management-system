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
    first_name: '',
    last_name: '',
    username: '',
    phone: '',
    dob: '',
    email: '',
    nid: '',
    address: '',
    password1: '',
    password2: '',
  });
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'default' | 'conflict' | 'ok';
    message: string;
  }>({ state: 'default', message: 'Username must be unique.' });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const val = form.username.trim();
    if (!val) {
      setUsernameStatus({ state: 'default', message: 'Username must be unique.' });
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ status: string; message: string }>('/auth/check-username', {
          params: { username: val },
        })
        .then((res) => {
          if (res.data.status === 'conflict') {
            setUsernameStatus({
              state: 'conflict',
              message: 'This username conflicts with another account identifier.',
            });
          } else if (res.data.status === 'available') {
            setUsernameStatus({ state: 'ok', message: 'Username is OK' });
          } else {
            setUsernameStatus({
              state: 'default',
              message: res.data.message || 'Username must be unique.',
            });
          }
        })
        .catch(() => {});
    }, 220);
    return () => clearTimeout(timer);
  }, [form.username]);

  if (user) {
    return <Navigate to={nextUrl.startsWith('/') ? nextUrl : '/dashboard'} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      <div className="auth-background">
        <div className="container register-container">
          <div className="register-intro">
            <p className="eyebrow">JOIN GREEN HOSPITAL</p>
            <h1>Care begins here.</h1>
            <p>
              Create an account to book specialist appointments, manage upcoming visits and receive
              service updates.
            </p>
          </div>

          <div className="panel padded-panel register-panel">
            <h2>Create patient account</h2>
            <p>
              Already registered? <Link to="/login/patient">Sign in</Link>
            </p>

            {errorMsg && <div className="form-errors">{errorMsg}</div>}

            <form onSubmit={onSubmit} className="smart-form">
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="id_first_name">
                    First name <span className="required">*</span>
                  </label>
                  <input
                    id="id_first_name"
                    className="field-control"
                    required
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="id_last_name">
                    Last name <span className="required">*</span>
                  </label>
                  <input
                    id="id_last_name"
                    className="field-control"
                    required
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_username">Username (optional)</label>
                  <input
                    id="id_username"
                    className={`field-control ${
                      usernameStatus.state === 'conflict'
                        ? 'input-conflict-red'
                        : usernameStatus.state === 'ok'
                          ? 'input-valid-green'
                          : ''
                    }`}
                    placeholder="Choose unique username"
                    autoComplete="off"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                  <small
                    className={`username-live-feedback ${
                      usernameStatus.state === 'conflict'
                        ? 'feedback-conflict-red'
                        : usernameStatus.state === 'ok'
                          ? 'feedback-ok-green'
                          : 'feedback-default-neutral'
                    }`}
                  >
                    {usernameStatus.message}
                  </small>
                </div>

                <div className="form-group">
                  <label htmlFor="id_phone">
                    Phone <span className="required">*</span>
                  </label>
                  <input
                    id="id_phone"
                    className="field-control"
                    required
                    placeholder="01XXXXXXXXX"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_dob">
                    Date of birth <span className="required">*</span>
                  </label>
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
                  <label htmlFor="id_email">Email (optional)</label>
                  <input
                    id="id_email"
                    type="email"
                    className="field-control"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="id_nid">NID (optional)</label>
                  <input
                    id="id_nid"
                    className="field-control"
                    value={form.nid}
                    onChange={(e) => setForm({ ...form, nid: e.target.value })}
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
                    className="field-control"
                    required
                    autoComplete="new-password"
                    value={form.password2}
                    onChange={(e) => setForm({ ...form, password2: e.target.value })}
                  />
                </div>

                <div className="form-group form-span">
                  <label htmlFor="id_address">Address (optional)</label>
                  <textarea
                    id="id_address"
                    rows={2}
                    className="field-control"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                  />
                </div>
              </div>

              <button
                className="button button-primary button-full"
                type="submit"
                disabled={submitting}
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
