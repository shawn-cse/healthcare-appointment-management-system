import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker, GreenTimePicker } from '../components/DateTimePickers.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { AppointmentSlot, Doctor, WeeklyAvailability } from '../types/index.ts';

const WEEKDAYS = [
  { val: 0, label: 'Monday' },
  { val: 1, label: 'Tuesday' },
  { val: 2, label: 'Wednesday' },
  { val: 3, label: 'Thursday' },
  { val: 4, label: 'Friday' },
  { val: 5, label: 'Saturday' },
  { val: 6, label: 'Sunday' },
];

export function WeeklyFormPage() {
  const { doctorPk, id } = useParams<{ doctorPk: string; id?: string }>();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [weekday, setWeekday] = useState(5); // Saturday default in BD
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [capacity, setCapacity] = useState(2);
  const [active, setActive] = useState(true);

  useEffect(() => {
    api
      .get<{ doctor: Doctor | null; patterns: WeeklyAvailability[] }>(
        `/catalog/schedules?doctor=${doctorPk}`
      )
      .then((res) => {
        setDoctor(res.data.doctor);
        if (id) {
          const found = res.data.patterns.find((p) => String(p.id) === id);
          if (found) {
            setWeekday(found.weekday);
            setStartTime(found.start_time.slice(0, 5));
            setEndTime(found.end_time.slice(0, 5));
            setDurationMinutes(found.duration_minutes);
            setCapacity(found.capacity);
            setActive(found.active);
          }
        }
      })
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Could not load schedule details.'), 'error');
        navigate('/schedules');
      })
      .finally(() => setLoading(false));
  }, [doctorPk, id, navigate, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        weekday,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes,
        capacity,
        active,
      };
      const res = id
        ? await api.put<{ message: string }>(`/catalog/schedules/weekly/${doctorPk}/${id}`, payload)
        : await api.post<{ message: string }>(`/catalog/schedules/weekly/${doctorPk}`, payload);
      showToast(res.data.message, 'success');
      navigate(`/schedules?doctor=${doctorPk}`);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save weekly rule.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
          <p className="eyebrow">WEEKLY CLINIC RULE</p>
          <h1>{id ? 'Edit Recurring Availability' : 'Add Recurring Availability'}</h1>
          <p>
            {doctor
              ? `${doctor.name} · ${doctor.department?.name || 'General Consultation'}`
              : 'Doctor schedule setup'}
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to={`/schedules?doctor=${doctorPk}`}>
            Back to Schedules
          </Link>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 680, padding: 24 }}>
        <form onSubmit={handleSubmit} className="form-grid two-col">
          <div className="form-group">
            <label htmlFor="wf-day">Weekday</label>
            <select
              id="wf-day"
              className="field-control"
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {WEEKDAYS.map((w) => (
                <option key={w.val} value={w.val}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="wf-dur">Slot Interval (Minutes)</label>
            <input
              id="wf-dur"
              type="number"
              min={5}
              max={240}
              className="field-control"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="wf-start">Session Start Time</label>
            <GreenTimePicker id="wf-start" value={startTime} onChange={setStartTime} required />
          </div>

          <div className="form-group">
            <label htmlFor="wf-end">Session End Time</label>
            <GreenTimePicker id="wf-end" value={endTime} onChange={setEndTime} required />
          </div>

          <div className="form-group">
            <label htmlFor="wf-cap">Patients Per Interval</label>
            <input
              id="wf-cap"
              type="number"
              min={1}
              max={100}
              className="field-control"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              required
            />
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', paddingTop: 26 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active (publish upcoming 60 days)
            </label>
          </div>

          <div className="form-group full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link className="button button-outline" to={`/schedules?doctor=${doctorPk}`}>
              Cancel
            </Link>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Weekly Rule'}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}

export function SlotFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [doctorId, setDoctorId] = useState(searchParams.get('doctor') || '');
  const [date, setDate] = useState(() => {
    const t = new Date();
    return (
      searchParams.get('date') ||
      `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    );
  });
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('18:30');
  const [capacity, setCapacity] = useState(2);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const reqs: Promise<unknown>[] = [
      api.get<{ doctors: Doctor[] }>('/catalog/schedules').then((res) => {
        setDoctors(res.data.doctors || []);
        if (!doctorId && res.data.doctors.length > 0 && !id) {
          setDoctorId(String(res.data.doctors[0].id));
        }
      }),
    ];
    if (id) {
      reqs.push(
        api.get<{ slot: AppointmentSlot }>(`/catalog/slots/${id}`).then((res) => {
          const s = res.data.slot;
          setDoctorId(String(s.doctor_id));
          setDate(s.date);
          setStartTime(s.start_time.slice(0, 5));
          setEndTime(s.end_time.slice(0, 5));
          setCapacity(s.capacity);
          setIsOpen(s.is_open);
        })
      );
    }
    Promise.all(reqs)
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Could not load slot form.'), 'error');
        navigate('/schedules');
      })
      .finally(() => setLoading(false));
  }, [id, doctorId, navigate, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        doctor_id: Number(doctorId),
        date,
        start_time: startTime,
        end_time: endTime,
        capacity,
        is_open: isOpen,
      };
      const res = id
        ? await api.put<{ message: string }>(`/catalog/schedules/slot/${id}`, payload)
        : await api.post<{ message: string }>('/catalog/schedules/slot', payload);
      showToast(res.data.message, 'success');
      navigate(`/schedules?doctor=${doctorId}&date=${date}`);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save slot.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
          <p className="eyebrow">CUSTOM CLINIC WINDOW</p>
          <h1>{id ? 'Edit Time Slot' : 'Add Custom Consultation Slot'}</h1>
          <p>Create or modify an individual consultation window for a specific date.</p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to={`/schedules?doctor=${doctorId}&date=${date}`}>
            Back to Schedules
          </Link>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 680, padding: 24 }}>
        <form onSubmit={handleSubmit} className="form-grid two-col">
          <div className="form-group full">
            <label htmlFor="sf-doc">Specialist Doctor</label>
            <select
              id="sf-doc"
              className="field-control"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              required
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.department?.name || 'General Consultation'}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="sf-date">Date</label>
            <GreenDatePicker id="sf-date" value={date} onChange={setDate} minToday required />
          </div>

          <div className="form-group">
            <label htmlFor="sf-cap">Patient Capacity</label>
            <input
              id="sf-cap"
              type="number"
              min={1}
              max={150}
              className="field-control"
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="sf-start">Start Time</label>
            <GreenTimePicker id="sf-start" value={startTime} onChange={setStartTime} required />
          </div>

          <div className="form-group">
            <label htmlFor="sf-end">End Time</label>
            <GreenTimePicker id="sf-end" value={endTime} onChange={setEndTime} required />
          </div>

          <div className="form-group full">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={isOpen}
                onChange={(e) => setIsOpen(e.target.checked)}
              />
              Open for new patient bookings
            </label>
          </div>

          <div className="form-group full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link
              className="button button-outline"
              to={`/schedules?doctor=${doctorId}&date=${date}`}
            >
              Cancel
            </Link>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Slot'}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
