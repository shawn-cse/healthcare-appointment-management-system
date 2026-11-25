import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDisplayDate } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { AppointmentSlot, Doctor, WeeklyAvailability } from '../types/index.ts';

interface ScheduleResponse {
  doctor: Doctor | null;
  doctors: Doctor[];
  patterns: WeeklyAvailability[];
  slots: AppointmentSlot[];
  date_value: string;
  can_edit: boolean;
}

export default function SchedulePage() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const doctorParam = searchParams.get('doctor') || '';
  const dateParam = searchParams.get('date') || '';

  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyToDate, setCopyToDate] = useState('');
  const [copying, setCopying] = useState(false);

  const loadSchedule = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (doctorParam) params.set('doctor', doctorParam);
    if (dateParam) params.set('date', dateParam);
    api
      .get<ScheduleResponse>(`/catalog/schedules?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load schedules.'), 'error'))
      .finally(() => setLoading(false));
  }, [doctorParam, dateParam, showToast]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const setFilter = (docId: string, dVal: string) => {
    const next = new URLSearchParams();
    if (docId) next.set('doctor', docId);
    if (dVal) next.set('date', dVal);
    setSearchParams(next);
  };

  const handleDeleteWeekly = async (pat: WeeklyAvailability) => {
    const ok = await confirm({
      title: 'Remove Recurring Pattern',
      message: `Remove ${pat.weekday_name} (${pat.start_time_12h} – ${pat.end_time_12h}) recurring schedule? Empty future slots will be removed; booked slots will remain closed.`,
      confirmText: 'Remove Schedule',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.delete<{ message: string }>(`/catalog/schedules/weekly/${pat.id}`);
      showToast(res.data.message, 'success');
      loadSchedule();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not remove recurring schedule.'), 'error');
    }
  };

  const handleToggleSlot = async (slot: AppointmentSlot) => {
    try {
      const res = await api.post<{ message: string }>(`/catalog/schedules/slot/${slot.id}/toggle`);
      showToast(res.data.message, 'success');
      loadSchedule();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not toggle slot.'), 'error');
    }
  };

  const handleCopyDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.doctor || !copyToDate) return;
    setCopying(true);
    try {
      const res = await api.post<{ message: string; to_date: string }>('/catalog/schedules/copy', {
        doctor_id: data.doctor.id,
        from_date: data.date_value,
        to_date: copyToDate,
      });
      showToast(res.data.message, 'success');
      setCopyToDate('');
      setFilter(String(data.doctor.id), res.data.to_date);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not copy clinic day.'), 'error');
    } finally {
      setCopying(false);
    }
  };

  if (loading && !data) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  const doc = data?.doctor || null;
  const doctors = data?.doctors || [];
  const patterns = data?.patterns || [];
  const slots = data?.slots || [];
  const dateValue = data?.date_value || '';
  const canEdit = Boolean(data?.can_edit);

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLINIC ROSTER &amp; SESSION TIMINGS</p>
          <h1>Schedules &amp; Time Slots</h1>
          <p>
            Configure weekly recurring sessions and manage daily consultation capacity.
          </p>
        </div>
        {canEdit && doc && (
          <div className="heading-actions">
            <Link className="button button-outline" to={`/schedules/weekly/${doc.id}`}>
              <Icon id="ic-plus" /> Add Weekly Rule
            </Link>
            <Link
              className="button button-primary"
              to={`/schedules/slot?doctor=${doc.id}&date=${dateValue}`}
            >
              <Icon id="ic-plus" /> Add Custom Slot
            </Link>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '1 1 260px', marginBottom: 0 }}>
            <label htmlFor="sch-doc">Specialist Doctor</label>
            <select
              id="sch-doc"
              className="field-control"
              value={doc ? String(doc.id) : ''}
              onChange={(e) => setFilter(e.target.value, dateValue)}
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.department.name} ({d.active_room})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ width: 220, marginBottom: 0 }}>
            <label htmlFor="sch-date">Inspect Date</label>
            <GreenDatePicker
              id="sch-date"
              value={dateValue}
              onChange={(dVal) => setFilter(doc ? String(doc.id) : '', dVal)}
              placeholder="Select date..."
            />
          </div>
          <button type="button" className="button button-outline" onClick={loadSchedule}>
            <Icon id="ic-refresh" /> Refresh
          </button>
        </div>
      </div>

      <div className="content-columns">
        {/* Daily Slots */}
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Slots on {dateValue ? formatDisplayDate(dateValue) : 'Selected Date'}</h2>
              <p>Individual consultation windows materialized for booking</p>
            </div>
          </div>
          {slots.length === 0 ? (
            <div className="empty-state" style={{ padding: 36 }}>
              <h3>No slots scheduled on this date</h3>
              <p className="muted">Add a custom slot or copy an existing clinic day below.</p>
            </div>
          ) : (
            <div className="excel-table-wrap">
              <table className="excel-sheet">
                <thead>
                  <tr>
                    <th>Session Window</th>
                    <th>Reserved / Cap</th>
                    <th>Status</th>
                    {canEdit && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.start_time_12h} – {s.end_time_12h}</strong>
                      </td>
                      <td>
                        {s.reserved} / {s.capacity}{' '}
                        <span className="muted">({s.remaining} open)</span>
                      </td>
                      <td>
                        <StatusPill
                          status={s.is_open ? 'confirmed' : 'cancelled'}
                          label={s.is_open ? 'Open' : 'Closed'}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Link
                              to={`/schedules/slot/${s.id}`}
                              className="button button-small button-outline"
                            >
                              Edit
                            </Link>
                            <button
                              type="button"
                              className="button button-small button-outline"
                              onClick={() => handleToggleSlot(s)}
                            >
                              {s.is_open ? 'Close' : 'Reopen'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && doc && slots.length > 0 && (
            <form
              onSubmit={handleCopyDay}
              style={{
                padding: 18,
                borderTop: '1px solid var(--line)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                alignItems: 'flex-end',
                background: 'var(--bg)',
              }}
            >
              <div className="form-group" style={{ marginBottom: 0, flex: '1 1 200px' }}>
                <label htmlFor="copy-to-date">
                  Duplicate {formatDisplayDate(dateValue)} slots to date:
                </label>
                <GreenDatePicker
                  id="copy-to-date"
                  value={copyToDate}
                  onChange={setCopyToDate}
                  minToday
                  required
                  placeholder="Target date..."
                />
              </div>
              <button
                type="submit"
                className="button button-primary"
                disabled={copying || !copyToDate}
              >
                {copying ? 'Copying...' : 'Copy Clinic Day'}
              </button>
            </form>
          )}
        </div>

        {/* Weekly Recurring Patterns */}
        <div className="panel" style={{ alignSelf: 'start' }}>
          <div className="panel-header">
            <div>
              <h2>Weekly Recurring Pattern</h2>
              <p>Automatically publishes upcoming 60-day clinic windows</p>
            </div>
          </div>
          {patterns.length === 0 ? (
            <div className="empty-state" style={{ padding: 36 }}>
              <h3>No weekly rules defined</h3>
              <p className="muted">Add recurring weekly clinic days for automated publishing.</p>
            </div>
          ) : (
            <div className="excel-table-wrap">
              <table className="excel-sheet">
                <thead>
                  <tr>
                    <th>Weekday</th>
                    <th>Time</th>
                    <th>Interval / Cap</th>
                    <th>State</th>
                    {canEdit && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {patterns.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.weekday_name}</strong>
                      </td>
                      <td>
                        {p.start_time_12h} – {p.end_time_12h}
                      </td>
                      <td>
                        {p.duration_minutes}m · Cap {p.capacity}
                      </td>
                      <td>
                        <StatusPill
                          status={p.active ? 'confirmed' : 'cancelled'}
                          label={p.active ? 'Active' : 'Paused'}
                        />
                      </td>
                      {canEdit && (
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Link
                              to={`/schedules/weekly/${p.doctor_id}/${p.id}`}
                              className="button button-small button-outline"
                            >
                              Edit
                            </Link>
                            <button
                              type="button"
                              className="button button-small button-outline"
                              style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}
                              onClick={() => handleDeleteWeekly(p)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
