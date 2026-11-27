import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { BookingRules, VisitField } from '../components/BookingFields.tsx';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatLongDate } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Department, Doctor } from '../types/index.ts';

interface SlotOption {
  id: number;
  label: string;
  remaining: number;
  capacity: number;
}

interface MatchedPatient {
  id: number;
  name: string;
  username?: string;
  age?: number | null;
  gender?: string;
  phone_verified?: boolean;
}

export default function StaffBookPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [doctorSearch, setDoctorSearch] = useState('');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [genderMale, setGenderMale] = useState(false);
  const [genderFemale, setGenderFemale] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const [doctorId, setDoctorId] = useState(searchParams.get('doctor') || '');
  const [date, setDate] = useState(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return searchParams.get('date') || `${y}-${m}-${d}`;
  });
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotId, setSlotId] = useState('');

  const [phone, setPhone] = useState('');
  const [matchedPatient, setMatchedPatient] = useState<MatchedPatient | null>(null);
  const [lookupChecked, setLookupChecked] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(true);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [visitType, setVisitType] = useState<'first' | 'followup' | 'report'>('first');
  const [source, setSource] = useState<'desk' | 'phone' | 'web'>('desk');
  const [paymentChoice, setPaymentChoice] = useState<'cash' | 'later' | 'online'>('later');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<{ doctors: Doctor[] }>('/catalog/schedules?bookable=1')
      .then((res) => {
        setDoctors(res.data.doctors || []);
      })
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Could not load doctors.'), 'error');
      })
      .finally(() => setLoadingDocs(false));
  }, [showToast]);

  const departments = useMemo(() => {
    const map = new Map<number, Department>();
    for (const d of doctors) {
      if (d.department) map.set(d.department.id, d.department);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [doctors]);

  const filteredDoctors = useMemo(() => {
    const terms = doctorSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
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
  }, [doctors, doctorSearch, selectedDepts, genderMale, genderFemale]);

  const toggleDept = (id: string) => {
    setSelectedDepts((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const resetAllFilters = () => {
    setDoctorSearch('');
    setSelectedDepts([]);
    setGenderMale(false);
    setGenderFemale(false);
  };

  useEffect(() => {
    if (!doctorId || !date) {
      setSlots([]);
      setSlotId('');
      return;
    }
    setSlotsLoading(true);
    api
      .get<{ slots: SlotOption[] }>(`/slots?doctor=${doctorId}&date=${date}`)
      .then((res) => {
        const list = res.data.slots || [];
        setSlots(list);
        setSlotId(list.length > 0 ? String(list[0].id) : '');
      })
      .catch(() => {
        setSlots([]);
        setSlotId('');
      })
      .finally(() => setSlotsLoading(false));
  }, [doctorId, date]);

  useEffect(() => {
    const clean = phone.trim();
    const stripped = clean.replace(/[\s\-+]/g, '');
    if (!/^\d{10,15}$/.test(stripped)) {
      setMatchedPatient(null);
      setLookupChecked(false);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ patient: MatchedPatient | null }>(
          `/patients/lookup?phone=${encodeURIComponent(clean)}`
        )
        .then((res) => {
          const found = res.data.patient || null;
          setMatchedPatient(found);
          setLookupChecked(true);
          if (found) {
            setIdentityVerified(true);
            setName(found.name || '');
            if (typeof found.age === 'number') setAge(String(found.age));
            if (found.gender) setGender(found.gender);
          }
        })
        .catch(() => {
          setMatchedPatient(null);
          setLookupChecked(false);
        });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [phone]);

  const selectedDoc = doctors.find((d) => String(d.id) === doctorId) || null;
  useEffect(() => {
    if (!selectedDoc) return;
    if (selectedDoc.accepted_payment_methods.includes('cash')) setPaymentChoice('later');
    else setPaymentChoice('online');
  }, [selectedDoc?.id, selectedDoc?.accepted_payment_methods.join(',')]);

  const estFee = selectedDoc
    ? visitType === 'followup'
      ? selectedDoc.followup_fee
      : visitType === 'report'
        ? selectedDoc.report_fee
        : selectedDoc.initial_fee
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotId) {
      showToast('Please select an open consultation slot.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const linkPatientId = matchedPatient && identityVerified ? matchedPatient.id : undefined;
      const res = await api.post<{ appointment: { id: number; reference: string }; message: string }>(
        '/appointments',
        {
          slot_id: Number(slotId),
          patient_id: linkPatientId,
          identity_verified: linkPatientId ? true : undefined,
          name: name.trim(),
          phone: phone.trim(),
          age: Number(age),
          gender,
          payment_method: paymentChoice === 'online' ? 'online' : 'cash',
          visit_type: visitType,
          source,
          payment_choice: paymentChoice,
          notes: notes.trim(),
        }
      );
      showToast(res.data.message || `Appointment ${res.data.appointment.reference} booked.`, 'success');
      navigate(`/appointments/${res.data.appointment.id}`);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not complete reservation.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingDocs) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <h1>Register Booking</h1>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to="/appointments">
            View Desk Queue
          </Link>
        </div>
      </div>

      {!selectedDoc ? (
        <div className="directory-layout">
          <aside className="directory-sidebar">
            <div className="filter-panel panel">
              <div className="filter-header">
                <div className="filter-title">
                  <Icon id="ic-filter" />
                  <h3>Search &amp; Filters</h3>
                </div>
                <button type="button" className="filter-reset-link" onClick={resetAllFilters}>
                  Reset All
                </button>
              </div>

              <form className="directory-filter-form" onSubmit={(e) => e.preventDefault()}>
                <div className="filter-group">
                  <div className="filter-label-row">
                    <label htmlFor="staff-doctor-search-input" className="filter-group-title">
                      Search Doctor
                    </label>
                    {doctorSearch && (
                      <button
                        type="button"
                        className="quick-clear-link"
                        onClick={() => {
                          setDoctorSearch('');
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
                      id="staff-doctor-search-input"
                      className="filter-search-input"
                      placeholder="Search doctor name, specialty, room..."
                      value={doctorSearch}
                      onChange={(e) => setDoctorSearch(e.target.value)}
                      autoComplete="off"
                    />
                    {doctorSearch && (
                      <button
                        type="button"
                        className="clear-search-btn"
                        title="Clear search"
                        onClick={() => {
                          setDoctorSearch('');
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
                Showing <b>{filteredDoctors.length}</b> of <b>{doctors.length}</b> specialist doctors
                {doctorSearch.trim() && (
                  <span>
                    {' '}
                    matching &quot;<b>{doctorSearch.trim()}</b>&quot;
                  </span>
                )}
              </span>
            </div>

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
                          <span className="dept-tag">
                            {d.department?.name || 'General Consultation'}
                          </span>
                          {d.bmdc_display && <span className="bmdc-tag">{d.bmdc_display}</span>}
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
                              <span className="chamber-lbl">Room No:</span>
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
                      <button
                        type="button"
                        className="button button-primary button-full appt-action-btn"
                        onClick={() => setDoctorId(String(d.id))}
                      >
                        <span>Register Booking</span>
                        <Icon id="ic-arrow" className="icon btn-arrow-icon" />
                      </button>
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
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={resetAllFilters}
                  >
                    <Icon id="ic-filter" /> Clear All Filters
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      ) : (
        <>
          <div className="panel desk-doctor-heading" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span className="dept-tag">{selectedDoc.department?.name || 'General Consultation'}</span>
              <h2 style={{ margin: '6px 0 2px', fontSize: 19 }}>{selectedDoc.full_doctor_title}</h2>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {selectedDoc.designation}
                {selectedDoc.active_room ? ` · ${selectedDoc.active_room}` : ''}
                {selectedDoc.assigned_receptionist_name ? ` · Receptionist: ${selectedDoc.assigned_receptionist_name}` : ''}
              </p>
            </div>
            <button type="button" className="button button-outline button-sm" onClick={() => setDoctorId('')}>
              Change Doctor
            </button>
          </div>

          <form onSubmit={handleSubmit} className="content-columns">
            <div className="panel">
              <div className="panel-header">
                <h2>1. Consultation Session</h2>
              </div>
              <div className="form-grid two-col" style={{ padding: 20 }}>
                <div className="form-group">
                  <label htmlFor="sb-date">Consultation Date</label>
                  <GreenDatePicker
                    id="sb-date"
                    value={date}
                    onChange={setDate}
                    minToday
                    required
                    placeholder="Select date..."
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sb-slot">Available Time Slot</label>
                  <select
                    id="sb-slot"
                    className="field-control"
                    value={slotId}
                    onChange={(e) => setSlotId(e.target.value)}
                    disabled={slotsLoading || slots.length === 0}
                    required
                  >
                    {slotsLoading ? (
                      <option value="">Checking slots...</option>
                    ) : slots.length === 0 ? (
                      <option value="">No open slots on this date</option>
                    ) : (
                      slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} ({s.remaining}/{s.capacity} left)
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="panel-header" style={{ borderTop: '1px solid var(--line)' }}>
                <div>
                  <h2>2. Patient Information</h2>
                  <p>
                    Enter patient phone number — existing accounts auto-fill and link immediately;
                    walk-in/phone bookings link automatically if they register later.
                  </p>
                </div>
              </div>

              <div className="form-grid two-col" style={{ padding: '20px' }}>
                <div className="form-group">
                  <label htmlFor="sb-phone">Patient Phone No *</label>
                  <input
                    id="sb-phone"
                    type="tel"
                    className="field-control"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sb-name">Patient Name *</label>
                  <input
                    id="sb-name"
                    type="text"
                    className="field-control"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full legal name"
                    required
                  />
                </div>

                {matchedPatient && (
                  <div className="form-group full">
                    <div className="notice notice-success">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <strong>Registered Patient Account Found:</strong> {matchedPatient.name}
                          {matchedPatient.username ? ` (@${matchedPatient.username})` : ''} — details auto-filled.
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                          <input
                            type="checkbox"
                            checked={identityVerified}
                            onChange={(e) => setIdentityVerified(e.target.checked)}
                          />
                          Link booking to portal account
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {lookupChecked && !matchedPatient && (
                  <div className="form-group full">
                    <div className="notice notice-info">
                      No portal account found for this phone number. Booking will be saved as a{' '}
                      <strong>{source === 'phone' ? 'phone' : 'reception'}</strong> reservation and
                      linked automatically if the patient creates an account with this number later.
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="sb-age">Age *</label>
                  <input
                    id="sb-age"
                    className="field-control"
                    type="number"
                    min={0}
                    max={130}
                    required
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="sb-gender">Gender *</label>
                  <select
                    id="sb-gender"
                    className="field-control"
                    required
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="">Select gender</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="sb-source">Booking Channel</label>
                  <select
                    id="sb-source"
                    className="field-control"
                    value={source}
                    onChange={(e) => setSource(e.target.value as 'desk' | 'phone' | 'web')}
                  >
                    <option value="desk">Reception Desk (Walk-in)</option>
                    <option value="phone">Telephone Request</option>
                    <option value="web">Assisted Portal</option>
                  </select>
                </div>

                <VisitField value={visitType} onChange={setVisitType} />
                {selectedDoc && <BookingRules doctor={selectedDoc} visit={visitType} />}

                <div className="form-group">
                  <label htmlFor="sb-payment">Payment method</label>
                  <select
                    id="sb-payment"
                    className="field-control"
                    value={paymentChoice}
                    onChange={(e) => setPaymentChoice(e.target.value as 'cash' | 'later' | 'online')}
                  >
                    {selectedDoc?.accepted_payment_methods.includes('cash') && (
                      <option value="later">Pay at reception later</option>
                    )}
                    {selectedDoc?.accepted_payment_methods.includes('cash') && (
                      <option value="cash">Collect at reception now</option>
                    )}
                    {selectedDoc?.accepted_payment_methods.includes('online') && (
                      <option value="online">Online payment</option>
                    )}
                  </select>
                </div>

                <div className="form-group full">
                  <label htmlFor="sb-notes">Clinical / Desk Notes</label>
                  <textarea
                    id="sb-notes"
                    rows={3}
                    className="field-control"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason for consultation, referral notes, or special instructions..."
                  />
                </div>
              </div>
            </div>

            <div className="panel" style={{ alignSelf: 'start' }}>
              <div className="panel-header">
                <div>
                  <h2>Booking Summary</h2>
                  <p>Live room, fee &amp; schedule verification</p>
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div className="summary-list">
                  <div className="summary-row">
                    <span>Specialist</span>
                    <strong>{selectedDoc.name}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Department</span>
                    <strong>{selectedDoc.department?.name || 'General Consultation'}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Room No</span>
                    <strong>{selectedDoc.active_room || 'Unassigned'}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Date</span>
                    <strong>{date ? formatLongDate(date) : '—'}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Visit Fee</span>
                    <strong style={{ color: 'var(--forest)', fontSize: '1.15rem' }}>
                      Tk. {estFee.toFixed(0)}
                    </strong>
                  </div>
                  <div className="summary-row">
                    <span>Confirmation</span>
                    <strong>
                      {paymentChoice === 'cash' ? 'Instant (Paid Cash)' : 'Pending Settlement'}
                    </strong>
                  </div>
                </div>

                <button
                  type="submit"
                  className="button button-primary full"
                  style={{ marginTop: 20, justifyContent: 'center' }}
                  disabled={submitting || !slotId}
                >
                  <Icon id="ic-check" />{' '}
                  {submitting ? 'Confirming Registration...' : 'Create Appointment'}
                </button>
              </div>
            </div>
          </form>
        </>
      )}
    </AppLayout>
  );
}
