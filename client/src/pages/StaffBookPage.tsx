import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { BookingRules, VisitField } from '../components/BookingFields.tsx';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import DoctorCard from '../components/DoctorCard.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatLongDate } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Doctor } from '../types/index.ts';

interface SlotOption {
  id: number;
  label: string;
  remaining: number;
  capacity: number;
}

export default function StaffBookPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [doctorSearch, setDoctorSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
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
  const [matchedPatient, setMatchedPatient] = useState<{ id: number; name: string } | null>(null);
  const [identityVerified, setIdentityVerified] = useState(false);
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
        const list = res.data.doctors || [];
        setDoctors(list);

      })
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Could not load doctors.'), 'error');
      })
      .finally(() => setLoadingDocs(false));
  }, [showToast]);

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
    const stripped = clean.replace(/^\+/, '');
    if (!/^\d{10,15}$/.test(stripped)) {
      setMatchedPatient(null);
      setIdentityVerified(false);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ patient: { id: number; name: string } | null }>(
          `/patients/lookup?phone=${encodeURIComponent(clean)}`
        )
        .then((res) => {
          setMatchedPatient(res.data.patient || null);
          if (!res.data.patient) setIdentityVerified(false);
        })
        .catch(() => setMatchedPatient(null));
    }, 300);
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

      {!selectedDoc ? <>
        <div className="management-table-tools">
          <input className="field-control" type="search" aria-label="Search doctors" placeholder="Search doctors" value={doctorSearch} onChange={(e) => setDoctorSearch(e.target.value)} />
          <select className="field-control" aria-label="Filter by department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">All departments</option>
            {[...new Map(doctors.flatMap((doctor) => doctor.department ? [[doctor.department.id, doctor.department.name] as const] : []))].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="directory-cards-grid">
          {doctors.filter((doctor) => (!departmentFilter || String(doctor.department?.id) === departmentFilter) &&
            `${doctor.full_doctor_title} ${doctor.department?.name || ''} ${doctor.designation}`.toLowerCase().includes(doctorSearch.trim().toLowerCase()))
            .map((doctor) => <DoctorCard key={doctor.id} doctor={doctor} onBook={() => setDoctorId(String(doctor.id))} />)}
        </div>
        {doctors.length === 0 && <p>No doctors are available for booking.</p>}
      </> : <>
        <div className="desk-doctor-heading"><DoctorCard doctor={selectedDoc} onBook={() => setDoctorId('')} actionLabel="Change doctor" /></div>
        <form onSubmit={handleSubmit} className="content-columns">
          <div className="panel">
            <div className="panel-header"><h2>Consultation session</h2></div>
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
              <p>Enter patient phone to automatically check for a registered portal profile</p>
            </div>
          </div>

          <div className="form-grid two-col" style={{ padding: '20px' }}>
            <div className="form-group">
              <label htmlFor="sb-phone">Patient Phone Number</label>
              <input
                id="sb-phone"
                type="tel"
                className="field-control"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+88017XXXXXXXX"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="sb-name">Patient Full Name</label>
              <input
                id="sb-name"
                type="text"
                className="field-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={matchedPatient ? matchedPatient.name : 'Full legal name'}
                required={!matchedPatient || !identityVerified}
              />
            </div>

            {matchedPatient && (
              <div className="form-group full">
                <div className="notice notice-success">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <strong>Registered Patient Account Found:</strong> {matchedPatient.name} (#
                      {matchedPatient.id})
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={identityVerified}
                        onChange={(e) => {
                          setIdentityVerified(e.target.checked);
                          if (e.target.checked && !name.trim()) {
                            setName(matchedPatient.name);
                          }
                        }}
                      />
                      Identity verified — link booking to account
                    </label>
                  </div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="sb-age">Patient age</label>
              <input id="sb-age" className="field-control" type="number" min={0} max={130} required
                value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="sb-gender">Patient gender</label>
              <select id="sb-gender" className="field-control" required value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Select gender</option><option value="female">Female</option>
                <option value="male">Male</option><option value="other">Other</option>
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
                {selectedDoc?.accepted_payment_methods.includes('cash') && <option value="cash">Collect at reception now</option>}
                {selectedDoc?.accepted_payment_methods.includes('cash') && <option value="later">Pay at reception later</option>}
                {selectedDoc?.accepted_payment_methods.includes('online') && <option value="online">Online payment</option>}
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
            {selectedDoc ? (
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
                    BDT {estFee.toFixed(0)}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Confirmation</span>
                  <strong>
                    {paymentChoice === 'cash' ? 'Instant (Paid Cash)' : 'Pending Settlement'}
                  </strong>
                </div>
              </div>
            ) : (
              <p className="muted">Select a specialist doctor to review fee &amp; room info.</p>
            )}

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
      </form></>}
    </AppLayout>
  );
}
