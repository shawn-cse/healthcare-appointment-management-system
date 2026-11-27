import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import { Icon } from './Icons.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.innerWidth > 900 && localStorage.getItem('gh_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.remove('public-layout');
    document.body.classList.add('app-layout');
    if (collapsed) document.body.classList.add('sidebar-collapsed');
    else document.body.classList.remove('sidebar-collapsed');
    if (mobileNavOpen) document.body.classList.add('nav-open');
    else document.body.classList.remove('nav-open');
    return () => {
      document.body.classList.remove('app-layout', 'sidebar-collapsed', 'nav-open');
    };
  }, [collapsed, mobileNavOpen]);

  const [progressWidth, setProgressWidth] = useState(0);
  const [progressActive, setProgressActive] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
    setDropdownOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    setProgressActive(true);
    setProgressWidth(68);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const t1 = window.setTimeout(() => setProgressWidth(100), 110);
    const t2 = window.setTimeout(() => {
      setProgressActive(false);
      setProgressWidth(0);
    }, 340);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [location.pathname]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!user) return <PublicLayout>{children}</PublicLayout>;

  const dashboard = { to: '/dashboard', label: 'Dashboard', icon: 'ic-grid' };
  const appointments = { to: '/appointments', label: 'Appointment Management', icon: 'ic-calendar' };
  const payments = { to: '/payments', label: 'Payment Management', icon: 'ic-wallet' };
  const refunds = { to: '/finance/refunds', label: 'Refund Management', icon: 'ic-wallet' };
  const complaints = { to: '/service/complaints', label: 'Complaint Management', icon: 'ic-alert' };
  const directory = { to: '/staff', label: 'Staff and Doctor List', icon: 'ic-users' };
  const support = { to: '/complaints', label: 'Support', icon: 'ic-help' };
  const personalComplaints = { ...support, label: 'My Complaints' };
  const groups: { label?: string; items: NavItem[] }[] = [];
  if (!user.is_active) {
    groups.push({ items: [user.role === 'patient' ? personalComplaints : support] });
  } else if (user.role === 'patient') {
    groups.push({ items: [dashboard,
      { to: '/doctors', label: 'Find Doctors', icon: 'ic-stethoscope' },
      { ...appointments, label: 'My Appointments' }, { ...payments, label: 'My Payments' }, personalComplaints,
    ] });
  } else if (user.role === 'doctor') {
    groups.push({ items: [dashboard, appointments,
      { to: '/schedules', label: 'Schedule Management', icon: 'ic-clock' },
      ...(user.doctor_profile_id ? [{ to: `/doctors/${user.doctor_profile_id}/rules`, label: 'Fees & Appointment Rules', icon: 'ic-settings' }] : []),
      complaints, directory, support,
    ] });
  } else if (user.role === 'receptionist') {
    groups.push({ items: [dashboard, { to: '/reception/book', label: 'Create Appointment', icon: 'ic-plus' }, appointments, payments, refunds, directory, support] });
  } else {
    groups.push({ items: [dashboard, { ...directory, label: 'Doctors & Staff Management' },
      appointments, { to: '/reception/book', label: 'Register Booking', icon: 'ic-plus' },
      { to: '/rooms', label: 'Room Management', icon: 'ic-building' },
      { to: '/departments', label: 'Department Management', icon: 'ic-building' },
      payments, refunds, { ...complaints, label: 'Complaints & Support' },
      { to: '/system/settings', label: 'System Settings', icon: 'ic-settings' },
      { to: '/reports', label: 'Reports & Analytics', icon: 'ic-chart' },
      { to: '/activity-log', label: 'Activity Log', icon: 'ic-clipboard' },
    ] });
  }

  const toggleNav = () => {
    if (window.innerWidth <= 900) {
      setMobileNavOpen((prev) => !prev);
    } else {
      setCollapsed((prev) => {
        const next = !prev;
        try {
          localStorage.setItem('gh_sidebar_collapsed', next ? 'true' : 'false');
        } catch {
          // ignore
        }
        return next;
      });
    }
  };

  const handleLogout = () => {
    const portal = logout();
    showToast('You have been successfully signed out.', 'success');
    navigate(`/login/${portal}`);
  };

  const workspaceLabel =
    user.role === 'admin'
      ? 'Administration'
      : user.role === 'doctor'
        ? 'Doctor Workspace'
        : user.role === 'receptionist'
          ? 'Front Desk'
          : 'Patient Portal';

  const initials =
    ((user.first_name || '').slice(0, 1) + (user.last_name || '').slice(0, 1)).toUpperCase() ||
    user.username.slice(0, 2).toUpperCase();

  const todayFormatted = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  return (
    <>
      <div className="sidebar-scrim" onClick={() => setMobileNavOpen(false)} />
      <aside className="sidebar" id="sidebar">
        <div className="sidebar-header-row">
          <Link className="brand sidebar-brand" to="/dashboard">
            <span className="brand-mark-emblem">
              <svg className="brand-logo-icon" viewBox="0 0 40 40">
                <use href="#ic-hospital-logo" />
              </svg>
            </span>
            <span className="brand-text-wrap">
              <strong>Green Hospital</strong>
              <small>{user.role === 'patient' ? 'Patient Portal' : 'Clinical Management'}</small>
            </span>
          </Link>
        </div>
        <div className="sidebar-scroll">
          <nav className="nav-list" aria-label="Main navigation">
            {groups.map((group, index) => <div className="nav-group" key={group.label || index}>
              {group.label && <div className="nav-eyebrow">{group.label}</div>}
              {group.items.map((item) => <NavLink key={item.to} to={item.to} end className={({ isActive }) => isActive ? 'active' : ''}>
                <Icon id={item.icon} /> <span>{item.label}</span>
              </NavLink>)}
            </div>)}
          </nav>
        </div>
      </aside>

      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="sidebar-toggle-btn"
              id="sidebar-toggle-btn"
              onClick={toggleNav}
              aria-label="Toggle side menu"
              title="Toggle side menu"
            >
              <svg className="icon chevron-left" viewBox="0 0 24 24">
                <path
                  d="M15 19l-7-7 7-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <svg className="icon chevron-right" viewBox="0 0 24 24">
                <path
                  d="M9 5l7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="topbar-collapsed-brand" id="topbar-collapsed-brand">
              <Link className="brand" to="/dashboard">
                <span className="brand-mark-emblem">
                  <svg className="brand-logo-icon" viewBox="0 0 40 40">
                    <use href="#ic-hospital-logo" />
                  </svg>
                </span>
                <strong>Green Hospital</strong>
              </Link>
            </div>
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-prefix">Green Hospital</span>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-current">{workspaceLabel}</span>
            </div>
          </div>

          <div className="topbar-right">
            <span className="today-chip">
              <Icon id="ic-clock" />
              {todayFormatted}
            </span>

            <div
              className={`profile-dropdown-wrap ${dropdownOpen ? 'is-open' : ''}`}
              id="profile-dropdown-wrap"
              ref={dropdownRef}
            >
              <button
                type="button"
                className="profile-chip profile-trigger"
                id="profile-trigger-btn"
                aria-expanded={dropdownOpen}
                aria-haspopup="true"
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen((prev) => !prev);
                }}
              >
                <span className="avatar avatar-small">
                  {user.avatar ? (
                    <img src={user.avatar} alt={user.display_name} />
                  ) : (
                    initials
                  )}
                </span>
                <span className="profile-chip-text">
                  <b>{user.display_name}</b>
                  <small>{user.role_display}</small>
                </span>
                <svg className="icon dropdown-chevron" viewBox="0 0 24 24">
                  <path
                    d="m6 9 6 6 6-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <div className="profile-dropdown-menu" id="profile-dropdown-menu" role="menu">
                <div className="dropdown-user-header">
                  <span className="avatar avatar-medium">
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.display_name} />
                    ) : (
                      initials
                    )}
                  </span>
                  <div className="dd-user-meta">
                    <strong className="dd-user-name">{user.display_name}</strong>
                    <span className="dd-user-email">{user.email || user.username}</span>
                    <span className="role-pill-badge">{user.role_display}</span>
                  </div>
                </div>
                <div className="dropdown-divider" />
                {user.is_active && <div className="dropdown-links-list">
                  <Link to="/profile" className="dropdown-link-item" role="menuitem">
                    <Icon id="ic-user" />
                    <span>My Profile</span>
                  </Link>
                  <Link to="/profile/password" className="dropdown-link-item" role="menuitem">
                    <Icon id="ic-settings" />
                    <span>Profile Settings</span>
                  </Link>
                </div>}
                <div className="dropdown-divider" />
                <div className="dropdown-logout-form">
                  <button
                    type="button"
                    className="dropdown-link-item dropdown-logout-action"
                    role="menuitem"
                    onClick={handleLogout}
                  >
                    <Icon id="ic-log-out" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="main-content" id="main-content">
          <div className={`page-progress-bar ${progressActive ? 'is-active' : ''}`} aria-hidden="true">
            <div className="page-progress-inner" style={{ width: `${progressWidth}%` }} />
          </div>
          <div key={location.pathname} className="gh-page-transition">
            {children}
          </div>
          <footer className="app-footer">
            <span>
              © {new Date().getFullYear()} Green Hospital. Clinical Care &amp; Patient Management
              System.
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [navExpanded, setNavExpanded] = useState(false);
  const [infoMenuOpen, setInfoMenuOpen] = useState(false);
  const infoMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setNavExpanded(false);
    setInfoMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [location.pathname]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (infoMenuRef.current && !infoMenuRef.current.contains(e.target as Node)) {
        setInfoMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInfoMenuOpen(false);
        setNavExpanded(false);
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    document.body.classList.remove('app-layout', 'sidebar-collapsed', 'nav-open');
    document.body.classList.add('public-layout');
    return () => {
      document.body.classList.remove('public-layout');
    };
  }, []);

  if (user) {
    return <AppLayout>{children}</AppLayout>;
  }

  return (
    <>
      <div className="header-top-bar">
        <div className="container header-top-inner">
          <div className="top-info-item">
            <Icon id="ic-phone" />
            <span className="top-info-text">
              24/7 Hotline:{' '}
              <a href="tel:+88096100016211" className="top-bar-hotline">
                <strong>+88096100016211</strong>
              </a>
            </span>
          </div>
          <div className="top-info-item hidden-mobile">
            <Icon id="ic-clock" />
            <span className="top-info-text">
              OPD Clinics: <strong>8:00 AM – 10:00 PM</strong> · Emergency: <strong>24/7</strong>
            </span>
          </div>
          <div className="top-info-item hidden-mobile">
            <Icon id="ic-map-pin" />
            <span className="top-info-text">
              <strong>Mirpur, Dhaka</strong>
            </span>
          </div>
        </div>
      </div>

      <header className="public-header">
        <div className="container public-header-inner">
          <Link className="brand" to="/">
            <span className="brand-mark-emblem">
              <svg className="brand-logo-icon" viewBox="0 0 40 40">
                <use href="#ic-hospital-logo" />
              </svg>
            </span>
            <span>
              <strong>Green Hospital</strong>
              <small>Medical Center &amp; Diagnostic</small>
            </span>
          </Link>

          <nav
            className={`public-links ${navExpanded ? 'nav-expanded' : ''}`}
            id="public-navigation"
          >
            <NavLink to="/" end className={({ isActive }) => (isActive && !location.hash ? 'is-nav-active' : '')} onClick={() => setNavExpanded(false)}>
              Home
            </NavLink>
            <NavLink to="/doctors" className={({ isActive }) => (isActive ? 'is-nav-active' : '')} onClick={() => setNavExpanded(false)}>
              Find Doctors
            </NavLink>
            <Link to="/#care" onClick={() => setNavExpanded(false)}>
              Departments
            </Link>

            <div
              className={`public-nav-dropdown ${infoMenuOpen ? 'is-open' : ''}`}
              ref={infoMenuRef}
            >
              <button
                type="button"
                className={`public-nav-trigger ${location.pathname === '/hospital-info' ? 'is-nav-active' : ''}`}
                aria-expanded={infoMenuOpen}
                aria-haspopup="true"
                onClick={(e) => {
                  e.stopPropagation();
                  setInfoMenuOpen((prev) => !prev);
                }}
              >
                <span>Hospital Info</span>
                <svg className="icon public-nav-chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="m6 9 6 6 6-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <div className="public-nav-menu" role="menu">
                <Link
                  to="/hospital-info#about-us"
                  className="public-nav-item"
                  role="menuitem"
                  onClick={() => {
                    setInfoMenuOpen(false);
                    setNavExpanded(false);
                  }}
                >
                  <Icon id="ic-building" />
                  <div>
                    <strong>About Us</strong>
                    <small>Clinical overview, departments &amp; care</small>
                  </div>
                </Link>
                <Link
                  to="/hospital-info#hospital-policy"
                  className="public-nav-item"
                  role="menuitem"
                  onClick={() => {
                    setInfoMenuOpen(false);
                    setNavExpanded(false);
                  }}
                >
                  <Icon id="ic-clipboard" />
                  <div>
                    <strong>Hospital Policy</strong>
                    <small>Booking rules, fees, payments &amp; refunds</small>
                  </div>
                </Link>
                <Link
                  to="/hospital-info#contact-us"
                  className="public-nav-item"
                  role="menuitem"
                  onClick={() => {
                    setInfoMenuOpen(false);
                    setNavExpanded(false);
                  }}
                >
                  <Icon id="ic-phone" />
                  <div>
                    <strong>Contact Us</strong>
                    <small>24/7 hotline, location &amp; support</small>
                  </div>
                </Link>
                <div className="public-nav-menu-footer">
                  <Link
                    to="/hospital-info"
                    onClick={() => {
                      setInfoMenuOpen(false);
                      setNavExpanded(false);
                    }}
                  >
                    View All Hospital Information <Icon id="ic-arrow" />
                  </Link>
                </div>
              </div>
            </div>
          </nav>

          <div className="public-header-actions">
            <Link className="button button-primary button-sm" to="/login">
              Login / Register <Icon id="ic-arrow" />
            </Link>
            <button
              type="button"
              className="icon-button mobile-toggle public-mobile-toggle"
              onClick={() => setNavExpanded((prev) => !prev)}
              aria-label="Toggle navigation"
              aria-controls="public-navigation"
              aria-expanded={navExpanded}
            >
              <Icon id="ic-menu" />
            </button>
          </div>
        </div>
      </header>

      <main className="public-main-content">
        <div key={location.pathname} className="gh-page-transition">
          {children}
        </div>
      </main>

      <footer className="public-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-col">
              <div className="brand footer-brand">
                <span className="brand-mark-emblem">
                  <svg className="brand-logo-icon" viewBox="0 0 40 40">
                    <use href="#ic-hospital-logo" />
                  </svg>
                </span>
                <span>
                  <strong>Green Hospital</strong>
                  <small>Medical Center &amp; Diagnostic</small>
                </span>
              </div>
              <p className="footer-desc">
                Green Hospital is a modern multi-specialty healthcare and diagnostic institution in
                Mirpur, Dhaka. We provide advanced consultations, ethical clinical standards, and
                hassle-free appointment scheduling.
              </p>
              <div className="footer-badge-wrap">
                <span className="status status-confirmed">✓ DGHS Approved Hospital</span>
                <span className="status status-paid">24/7 Emergency Wing</span>
              </div>
            </div>

            <div className="footer-col">
              <h4 className="footer-heading">Patient Services</h4>
              <ul className="footer-link-list">
                <li>
                  <Link to="/doctors">Find a Specialist Doctor</Link>
                </li>
                <li>
                  <Link to="/#care">Medical Departments</Link>
                </li>
                <li>
                  <Link to="/hospital-info#about-us">About Us</Link>
                </li>
                <li>
                  <Link to="/hospital-info#hospital-policy">Hospital Policy</Link>
                </li>
                <li>
                  <Link to="/hospital-info#contact-us">Contact Us</Link>
                </li>
                <li>
                  <Link to="/login/patient">Patient Portal Sign In</Link>
                </li>
                <li>
                  <Link to="/register">Patient Registration</Link>
                </li>
                <li>
                  <Link to="/login/staff">Doctor &amp; Staff Workspace</Link>
                </li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-heading">Key Specialties</h4>
              <ul className="footer-link-list">
                <li>
                  <Link to="/doctors">Gynaecological Oncology</Link>
                </li>
                <li>
                  <Link to="/doctors">Cardiology &amp; Vascular Care</Link>
                </li>
                <li>
                  <Link to="/doctors">Neurology &amp; Brain Sciences</Link>
                </li>
                <li>
                  <Link to="/doctors">Orthopedics &amp; Joint Care</Link>
                </li>
                <li>
                  <Link to="/doctors">Pediatrics &amp; Neonatology</Link>
                </li>
                <li>
                  <Link to="/doctors">General &amp; Internal Medicine</Link>
                </li>
              </ul>
            </div>

            <div className="footer-col">
              <h4 className="footer-heading">Contact &amp; Location</h4>
              <div className="footer-contact-item">
                <Icon id="ic-map-pin" />
                <div>
                  <b>Main Hospital &amp; Rooms</b>
                  <p>Mirpur, Dhaka</p>
                </div>
              </div>
              <div className="footer-contact-item">
                <Icon id="ic-phone" />
                <div>
                  <b>24/7 Hotlines &amp; Appointments</b>
                  <p>
                    <a href="tel:+88096100016211">
                      <b>+88096100016211</b>
                    </a>
                  </p>
                </div>
              </div>
              <div className="footer-contact-item">
                <Icon id="ic-clock" />
                <div>
                  <b>Visiting Hours</b>
                  <p>Morning &amp; Evening Outpatient Clinics (8 AM – 10 PM) · Emergency 24 Hours</p>
                </div>
              </div>
            </div>
          </div>

          <div className="footer-bottom-bar">
            <span>
              © {new Date().getFullYear()} Green Hospital, Mirpur, Dhaka, Bangladesh. All rights
              reserved.
            </span>
            <div className="footer-bottom-links">
              <a href="tel:+88096100016211">24/7 Hotline: +88096100016211</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
