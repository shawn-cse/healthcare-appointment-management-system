import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import type { Doctor, User } from '../types/index.ts';

export default function CommissionPage() {
  const [doctors, setDoctors] = useState<Doctor[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    async function load() {
      const doctors: Doctor[] = [];
      let page = 1, pages = 1;
      do {
        const { data } = await api.get<{ staff: Array<User & { doctor_profile: Doctor | null }>; total_pages: number }>('/staff', { params: { role: 'doctor', page } });
        doctors.push(...data.staff.flatMap((row) => row.doctor_profile ? [row.doctor_profile] : []));
        pages = data.total_pages;
        page += 1;
      } while (page <= pages);
      setDoctors(doctors);
    }
    void load().catch((err) => setError(getApiErrorMessage(err, 'Could not load commission rules.')));
  }, []);
  return <AppLayout><div className="page-heading"><h1>Hospital Commission</h1></div>
    {error ? <p role="alert">{error}</p> : !doctors ? <LoadingScreen /> : <ManagementTable rows={doctors} rowKey={(doctor) => doctor.id} columns={[
      { heading: 'Doctor', value: (doctor) => doctor.full_doctor_title, cell: (doctor) => <Link to={`/staff/${doctor.user_id}`}>{doctor.full_doctor_title}</Link> },
      { heading: 'Department', value: (doctor) => doctor.department?.name || '—' },
      { heading: 'Commission type', value: (doctor) => doctor.hospital_share_mode === 'percent' ? 'Percentage' : doctor.hospital_share_mode === 'monthly' ? 'Fixed monthly amount' : 'Fixed amount per appointment' },
      { heading: 'Commission', value: (doctor) => doctor.hospital_share_value, cell: (doctor) => doctor.hospital_share_mode === 'percent' ? `${doctor.hospital_share_value}%` : `BDT ${doctor.hospital_share_value}` },
    ]} />}
  </AppLayout>;
}
