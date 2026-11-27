import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout, PublicLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import DoctorCard from '../components/DoctorCard.tsx';
import type { Department, Doctor } from '../types/index.ts';

export default function DoctorsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
  const lastSyncedSearchRef = useRef(searchParams.toString());

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
    const incoming = searchParams.toString();
    if (incoming === lastSyncedSearchRef.current) return;
    lastSyncedSearchRef.current = incoming;
    setQuery(searchParams.get('q') || '');
    setSelectedDepts(searchParams.getAll('department').filter(Boolean));
    const gender = searchParams.get('gender');
    setGenderMale(gender === 'male');
    setGenderFemale(gender === 'female');
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    selectedDepts.forEach((d) => params.append('department', d));
    if (genderMale && !genderFemale) params.set('gender', 'male');
    else if (genderFemale && !genderMale) params.set('gender', 'female');
    const nextSearch = params.toString();
    if (nextSearch === lastSyncedSearchRef.current) return;
    lastSyncedSearchRef.current = nextSearch;
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
          d.name,
          d.first_name,
          d.last_name,
          d.department?.name,
          d.qualifications,
          d.professional_experience,
          d.active_room,
          d.chamber?.room_number,
          d.chamber?.name,
          d.chamber?.building,
          d.designation,
          d.institute,
          d.registration_number,
          d.bmdc_display,
          d.assigned_receptionist_name,
          d.assigned_days_text,
        ]
          .filter(Boolean)
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
            <h1 className="directory-title">Find Doctors</h1>
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
                        onClick={() => {
                          setQuery('');
                          searchInputRef.current?.focus();
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="filter-search-box">
                    <Icon id="ic-search" className="icon search-icon" />
                    <input
                      ref={searchInputRef}
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
                        onClick={() => {
                          setQuery('');
                          searchInputRef.current?.focus();
                        }}
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
                      <span className="check-label-text">Male</span>
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
                      <span className="check-label-text">Female</span>
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
                  filteredDoctors.map((doctor) => <DoctorCard key={doctor.id} doctor={doctor} />)
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
