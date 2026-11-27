import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Doctor, WeeklyAvailability } from '../types/index.ts';

interface Schedule { doctor: Doctor | null; doctors: Doctor[]; patterns: WeeklyAvailability[]; can_edit: boolean }

export default function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const doctorId = params.get('doctor') || '';
  const [schedule, setSchedule] = useState<Schedule>();
  const [error, setError] = useState('');
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const load = useCallback(async () => {
    try { setSchedule((await api.get<Schedule>('/catalog/schedules', { params: { doctor: doctorId } })).data); setError(''); }
    catch (err) { setError(getApiErrorMessage(err, 'Could not load consultation times.')); }
  }, [doctorId]);
  useEffect(() => { void load(); }, [load]);

  async function remove(period: WeeklyAvailability) {
    if (!await confirm({ title: 'Remove consultation period', message: 'Existing appointments will keep their scheduled times.', confirmText: 'Remove', type: 'warning' })) return;
    try { await api.delete(`/catalog/schedules/weekly/${period.id}`); await load(); }
    catch (err) { showToast(getApiErrorMessage(err, 'Could not remove the consultation period.'), 'error'); }
  }

  return <AppLayout>
    <div className="page-heading"><h1>Schedule Management</h1>
      {schedule?.can_edit && schedule.doctor && <Link to={`/schedules/weekly/${schedule.doctor.id}`} className="button button-primary">Add consultation period</Link>}
    </div>
    {error ? <p role="alert">{error}</p> : !schedule ? <LoadingScreen /> :
      <ManagementTable rows={schedule.patterns} rowKey={(p) => p.id}
        filters={<select aria-label="Doctor" className="field-control" value={schedule.doctor?.id || ''} onChange={(event) => setParams({ doctor: event.target.value })}>
          {schedule.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.full_doctor_title}</option>)}
        </select>} columns={[
          { heading: 'Day', value: (p) => 6 - (p.weekday + 2) % 7, cell: (p) => p.weekday_name },
          { heading: 'Starts', value: (p) => p.start_time, cell: (p) => p.start_time_12h },
          { heading: 'Ends', value: (p) => p.end_time, cell: (p) => p.end_time_12h },
          ...(schedule.can_edit && schedule.doctor ? [{ heading: 'Actions', value: (_: WeeklyAvailability) => '', cell: (p: WeeklyAvailability) =>
            <div className="consultation-times"><Link className="button button-small button-outline" to={`/schedules/weekly/${schedule.doctor!.id}/${p.id}`}>Edit</Link>
              <button type="button" className="button button-small button-outline" onClick={() => void remove(p)}>Remove</button></div> }] : []),
        ]} />}
  </AppLayout>;
}
