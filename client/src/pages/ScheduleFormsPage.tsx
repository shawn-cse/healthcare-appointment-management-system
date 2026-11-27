import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenTimePicker } from '../components/DateTimePickers.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Doctor, WeeklyAvailability } from '../types/index.ts';

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
              {[...WEEKDAYS.slice(5), ...WEEKDAYS.slice(0, 5)].map((w) => (
                <option key={w.val} value={w.val}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="wf-start">Session Start Time</label>
            <GreenTimePicker id="wf-start" value={startTime} onChange={setStartTime} required />
          </div>

          <div className="form-group">
            <label htmlFor="wf-end">Session End Time</label>
            <GreenTimePicker id="wf-end" value={endTime} onChange={setEndTime} required />
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
