import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout, PublicLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { Department, Doctor } from '../types/index.ts';

export default function DoctorsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [selectedDepts, setSelectedDepts] = useState<string[]>(() =>
    searchParams.getAll('department').filter(Boolean)
  );
  const [genderMale, setGenderMale] = useState(() => searchParams.get('gender') === 'male');
  const [genderFemale, setGenderFemale] = useState(() => searchParams.get('gender') === 'female');

  useEffect(() => {
    api
      .get<{ doctors: Doctor[]; departments: Department[]; total_doctors_count: number }>(
        '/catalog/doctors'
      )
      .then((res) => {
        setDoctors(res.data.doctors || []);
        setDepartments(res.data.departments || []);
        setTotalCount(res.data.total_doctors_count || 0);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    selectedDepts.forEach((d) => params.append('department', d));
    if (genderMale && !genderFemale) params.set('gender', 'male');
    else if (genderFemale && !genderMale) params.set('gender', 'female');
    setSearchParams(params, { replace: true });
  }, [query, selectedDepts, genderMale, genderFemale, setSearchParams]);

  const filteredDoctors = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const targetGender =
      genderMale && !genderFemale ? 'male' : genderFemale && !genderMale ? 'female' : 'all';

    return doctors.filter((d) => {
      if (selectedDepts.length > 0 && !selectedDepts.includes(String(d.department_id))) {
        return false;
      }
      if (targetGender !== 'all' && d.gender !== targetGender) {
        return false;
      }
      if (terms.length > 0) {
        const haystack = [
          d.full_doctor_title,
          d.department?.name,
          d.qualifications,
          d.active_room,
          d.designation,
          d.registration_number,
          d.assigned_receptionist_name,
        ]
          .join(' ')
          .toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [doctors, query, selectedDepts, genderMale, genderFemale]);

  const toggleDept = (id: string) => {
    setSelectedDepts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const resetAll = () => {
    setQuery('');
    setSelectedDepts([]);
    setGenderMale(false);
    setGenderFemale(false);
  };

  const Wrapper = user ? AppLayout : PublicLayout;

  return (
    <Wrapper>
      <div className="doctor-directory-container container">
        <div className="directory-header-bar">
          <div>
            <h1 className="directory-title">Consult Our Specialist Doctors</h1>
            <p className="directory-subtitle">
              Consult verified senior professors, consultants, and surgeons at Green Hospital.
              Choose your consultation date and receive sequential serial numbers directly.
            </p>
          </div>
        </div>

        <div className="directory-layout">
          <aside className="directory-sidebar">
            <div className="filter-panel panel">
              <div className="filter-header">
                <div className="filter-title">
                  <Icon id="ic-filter" />
                  <h3>Search &amp; Filters</h3>
                </div>
                <button type="button" className="filter-reset-link" onClick={resetAll}>
                  Reset All
                </button>
              </div>

              <form className="directory-filter-form" onSubmit={(e) => e.preventDefault()}>
                <div className="filter-group">
                  <div className="filter-label-row">
                    <label htmlFor="left-doctor-search-input" className="filter-group-title">
                      Search Doctor
                    </label>
                    {query && (
                      <button
                        type="button"
                        className="quick-clear-link"
                        onClick={() => setQuery('')}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="filter-search-box">
                    <Icon id="ic-search" className="icon search-icon" />
                    <input
                      type="text"
                      id="left-doctor-search-input"
                      className="filter-search-input"
                      placeholder="Search doctor name, specialty, room..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoComplete="off"
                    />
                    {query && (
                      <button
                        type="button"
                        className="clear-search-btn"
                        title="Clear search"
                        onClick={() => setQuery('')}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="filter-group">
                  <div className="filter-label-row">
                    <label className="filter-group-title">Specialty Department</label>
                    {selectedDepts.length > 0 && (
                      <button
                        type="button"
                        className="quick-clear-link"
                        onClick={() => setSelectedDepts([])}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="dept-checkbox-list">
                    {departments.map((dep) => {
                      const depId = String(dep.id);
                      return (
                        <label key={dep.id} className="filter-check-row">
                          <input
                            type="checkbox"
                            className="dept-check-input"
                            checked={selectedDepts.includes(depId)}
                            onChange={() => toggleDept(depId)}
                          />
                          <span className="custom-check-box">
                            <svg className="check-tick-icon" viewBox="0 0 16 16">
                              <path
                                d="M3.5 8.5L6.5 11.5L12.5 4.5"
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="check-label-text">{dep.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="filter-group">
                  <label className="filter-group-title">Doctor Gender</label>
                  <div className="gender-checkbox-list">
                    <label className="filter-check-row">
                      <input
                        type="checkbox"
                        className="gender-check-input"
                        checked={genderMale}
                        onChange={(e) => setGenderMale(e.target.checked)}
                      />
                      <span className="custom-check-box">
                        <svg className="check-tick-icon" viewBox="0 0 16 16">
                          <path
                            d="M3.5 8.5L6.5 11.5L12.5 4.5"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="check-label-text">Male Specialists</span>
                    </label>
                    <label className="filter-check-row">
                      <input
                        type="checkbox"
                        className="gender-check-input"
                        checked={genderFemale}
                        onChange={(e) => setGenderFemale(e.target.checked)}
                      />
                      <span className="custom-check-box">
                        <svg className="check-tick-icon" viewBox="0 0 16 16">
                          <path
                            d="M3.5 8.5L6.5 11.5L12.5 4.5"
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="check-label-text">Female Specialists</span>
                    </label>
                  </div>
                </div>
              </form>
            </div>
          </aside>

          <main className="directory-main">
            <div className="results-meta-bar">
              <span className="results-text">
                Showing <b>{filteredDoctors.length}</b> of <b>{totalCount}</b> specialist doctors
                {query.trim() && (
                  <span>
                    {' '}
                    matching &quot;<b>{query.trim()}</b>&quot;
                  </span>
                )}
              </span>
            </div>

            {loading ? (
              <LoadingScreen />
            ) : (
              <div className="directory-cards-grid">
                {filteredDoctors.length ? (
                  filteredDoctors.map((d) => (
                    <article key={d.id} className="doctor-card panel">
                      <div className="doctor-card-top">
                        <div className="doctor-avatar-wrapper">
                          {d.avatar ? (
                            <img
                              src={d.avatar}
                              alt={d.full_doctor_title}
                              className="doctor-avatar-img"
                            />
                          ) : (
                            <div className="doctor-avatar-circle">
                              <svg className="doctor-vector-avatar" viewBox="0 0 64 64">
                                <use href={`#${d.default_avatar}`} />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="doctor-primary-meta">
                          <div className="doctor-badge-row">
                            <span className="dept-tag">{d.department.name}</span>
                            <span className="bmdc-tag">{d.bmdc_display}</span>
                          </div>
                          <h2 className="doctor-name-heading">
                            <Link to={`/doctors/${d.profile_slug}`}>{d.full_doctor_title}</Link>
                          </h2>
                          <p className="doctor-designation-text">{d.designation}</p>
                        </div>
                      </div>

                      <div className="doctor-card-middle">
                        <div className="doctor-qual-block">
                          <div className="qual-label">
                            <Icon id="ic-stethoscope" />
                            <span>Degrees &amp; Qualifications</span>
                          </div>
                          <div className="qual-list">
                            {d.qualifications_list.length ? (
                              d.qualifications_list.map((line, i) => (
                                <div key={i} className="qual-line">
                                  <span className="qual-dot" />
                                  <span className="qual-text">{line}</span>
                                </div>
                              ))
                            ) : (
                              <div className="qual-line">
                                <span className="qual-dot" />
                                <span className="qual-text">MBBS, Specialist Consultant</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="doctor-chamber-section">
                          {d.active_room && (
                            <div className="chamber-info-item">
                              <span className="chamber-icon-box chamber-icon-building">
                                <Icon id="ic-building" />
                              </span>
                              <span className="chamber-info-text">
                                <span className="chamber-lbl">Room:</span>
                                <b className="chamber-val">{d.active_room}</b>
                              </span>
                            </div>
                          )}
                          <div className="chamber-info-item">
                            <span className="chamber-icon-box chamber-icon-user">
                              <Icon id="ic-user" />
                            </span>
                            <span className="chamber-info-text">
                              <span className="chamber-lbl">Receptionist:</span>
                              <b className="chamber-val">{d.assigned_receptionist_name}</b>
                            </span>
                          </div>
                          <div className="chamber-info-item helpline-item">
                            <span className="chamber-icon-box chamber-icon-phone">
                              <Icon id="ic-phone" />
                            </span>
                            <span className="chamber-info-text">
                              <span className="chamber-lbl">Helpline:</span>
                              <a
                                href={`tel:${d.active_contact || '+88096100016211'}`}
                                className="helpline-link"
                              >
                                <b>{d.active_contact || '+88096100016211'}</b>
                              </a>
                            </span>
                          </div>
                        </div>

                        <div className="doctor-fees-grid">
                          <div className="fee-tile">
                            <span className="fee-tile-label">1st Visit / New</span>
                            <b className="fee-tile-amount">Tk. {Math.round(d.initial_fee)}</b>
                          </div>
                          <div className="fee-tile">
                            <span className="fee-tile-label">
                              Follow-up (<small>{d.followup_within_days}d</small>)
                            </span>
                            <b className="fee-tile-amount">Tk. {Math.round(d.followup_fee)}</b>
                          </div>
                          <div className="fee-tile">
                            <span className="fee-tile-label">Report Review</span>
                            <b className="fee-tile-amount">Tk. {Math.round(d.report_fee)}</b>
                          </div>
                        </div>

                        <div className="doctor-schedule-preview">
                          <div className="schedule-label">
                            <Icon id="ic-clock" />
                            <span>APPOINTMENT SCHEDULE:</span>
                          </div>
                          <div className="schedule-pills-wrap">
                            {d.weekly.length ? (
                              d.weekly.map((sched) => (
                                <div key={sched.id} className="sched-pill">
                                  <span className="sched-day-badge">
                                    {sched.weekday_short.toUpperCase()}
                                  </span>
                                  <span className="sched-time-text">
                                    {sched.start_time_12h}–{sched.end_time_12h}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <span className="sched-pill sched-pill-open">
                                Consultation by Appointment
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="doctor-card-bottom">
                        <Link
                          to={`/doctors/${d.profile_slug}`}
                          className="button button-primary button-full appt-action-btn"
                        >
                          <span>Make Appointment</span>
                          <Icon id="ic-arrow" className="icon btn-arrow-icon" />
                        </Link>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="panel empty-state full-grid">
                    <span className="empty-icon">
                      <Icon id="ic-search" />
                    </span>
                    <h3>No doctors found matching your filters</h3>
                    <p>
                      Try adjusting your search query, or clear your department and gender filters.
                    </p>
                    <button type="button" className="button button-outline" onClick={resetAll}>
                      <Icon id="ic-filter" /> Clear All Filters
                    </button>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </Wrapper>
  );
}
