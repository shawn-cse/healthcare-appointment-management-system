import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { LoadingScreen, StatusPill, formatDateTime, formatDisplayDate } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Appointment, Doctor } from '../types/index.ts';

const views = [['appointments', 'Appointment Report'], ['by-doctor', 'Doctor-wise Appointment Report'],
  ['collections', 'Payment Collection Report'], ['refunds', 'Refund Report'], ['revenue', 'Hospital Revenue Report'],
  ['earnings', 'Doctor Earnings Report'], ['commission', 'Doctor-wise Commission Report']] as const;
type DoctorTotals = { id: number; doctor: string; department: string; appointments: number; gross: number; refunds: number; hospital: number; earnings: number };
const money = (value: number) => 'BDT ' + value.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Transaction = { id: number; appointment_id: number; reference: string; kind: string; doctor_id: number; doctor: string; department: string; method_display: string; processed_at: string; amount: number; hospital: number; doctor_earnings: number };
type ReportsData = {
  report: { total: number; completed: number; cancelled: number; collected: number; refunded: number; net: number; hospital_cut: number; doctor_cut: number };
  appointments: Appointment[]; transactions: Transaction[]; doctors: Doctor[]; from_date: string; to_date: string;
};

function localDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map((part) => parts.find((item) => item.type === part)?.value).join('-');
}

export default function ReportsPage() {
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ReportsData>();
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const view = params.get('view') || 'appointments';
  const query = params.toString();
  useEffect(() => {
    let active = true;
    api.get<ReportsData>(`/reports?${query}`).then(({ data }) => { if (active) { setError(''); setData(data); } })
      .catch((err) => { if (active) setError(getApiErrorMessage(err, 'Unable to load reports.')); });
    return () => { active = false; };
  }, [query]);

  function filter(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  function preset(value: string) {
    if (!value) return;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      const now = new Date();
      next.set('from', localDate(new Date(+now - (Number(value) - 1) * 86400_000)));
      next.set('to', localDate(now));
      return next;
    });
  }
  async function exportExcel() {
    setExporting(true);
    try {
      const { data } = await api.get<Blob>(`/reports/excel?${query}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'green-hospital-report.xlsx'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { showToast(getApiErrorMessage(err, 'Excel export failed.'), 'error'); }
    finally { setExporting(false); }
  }

  const summary = data ? [
    ['Gross Collections', data.report.collected], ['Completed Refunds', data.report.refunded],
    ['Net Collections', data.report.net], ['Hospital Revenue', data.report.hospital_cut], ['Doctor Earnings', data.report.doctor_cut],
  ] as const : [];
  const totals = new Map<number, DoctorTotals>();
  for (const item of data?.appointments || []) {
    const id = item.doctor.id;
    const row = totals.get(id) ?? { id, doctor: item.doctor.name, department: item.doctor.department?.name || '', appointments: 0, gross: 0, refunds: 0, hospital: 0, earnings: 0 };
    row.appointments += 1;
    totals.set(id, row);
  }
  for (const item of data?.transactions || []) {
    const id = item.doctor_id;
    const row = totals.get(id) ?? { id, doctor: item.doctor, department: item.department, appointments: 0, gross: 0, refunds: 0, hospital: 0, earnings: 0 };
    row.gross += item.kind === 'charge' ? item.amount : 0;
    row.refunds += item.kind === 'refund' ? item.amount : 0;
    row.hospital += item.hospital;
    row.earnings += item.doctor_earnings;
    totals.set(id, row);
  }
  const fields = [
    ['visit_type', 'Visit type', [['first', 'First Visit'], ['followup', 'Follow-up Visit'], ['report', 'Report Checking']]],
    ['payment_method', 'Payment method', [['cash', 'Cash'], ['online', 'Online']]],
    ['status', 'Appointment status', [['pending', 'Pending'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['no_show', 'No-show'], ['expired', 'Expired']]],
  ] as const;

  return <AppLayout>
    <div className="page-heading"><h1>Reports &amp; Analytics</h1><button className="button button-primary" type="button" onClick={() => void exportExcel()} disabled={exporting || !data}>{exporting ? 'Preparing Excel' : 'Export Excel (.xlsx)'}</button></div>
    <div className="panel management-table-tools">
      <select className="field-control" aria-label="Report" value={view} onChange={(e) => filter('view', e.target.value)}>{views.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
      <select className="field-control" aria-label="Date range" defaultValue="" onChange={(e) => preset(e.target.value)}>
        <option value="">Custom date range</option><option value="1">Daily</option><option value="7">Weekly</option><option value="30">Monthly</option><option value="365">Yearly</option>
      </select>
      <label>From <input className="field-control" type="date" value={params.get('from') || data?.from_date || ''} onChange={(e) => filter('from', e.target.value)} /></label>
      <label>To <input className="field-control" type="date" value={params.get('to') || data?.to_date || ''} onChange={(e) => filter('to', e.target.value)} /></label>
      <select className="field-control" aria-label="Doctor" value={params.get('doctor') || ''} onChange={(e) => filter('doctor', e.target.value)}>
        <option value="">All doctors</option>{data?.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
      </select>
      <select className="field-control" aria-label="Department" value={params.get('department') || ''} onChange={(e) => filter('department', e.target.value)}>
        <option value="">All departments</option>{[...new Map(data?.doctors.flatMap((d) => d.department ? [[d.department.id, d.department.name] as const] : []))].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      {fields.map(([key, label, options]) => <select key={key} className="field-control" aria-label={label} value={params.get(key) || ''} onChange={(e) => filter(key, e.target.value)}>
        <option value="">{label}</option>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>)}
    </div>
    {error ? <p role="alert">{error}</p> : !data ? <LoadingScreen /> : <>
      {view === 'appointments' || view === 'by-doctor' ? <div className="metric-grid three-metrics">
        {[['Appointments', data.report.total], ['Completed', data.report.completed], ['Cancelled', data.report.cancelled]].map(([label, value]) => <div className="metric-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div> : <section className="panel padded-panel report-summary" aria-label="Financial summary">
        {summary.map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value)}</strong><meter aria-label={label} min={0} max={Math.max(1, ...summary.map(([, n]) => Math.abs(n)))} value={Math.abs(value)} /></div>)}
      </section>}
      {view === 'appointments' ? <ManagementTable rows={data.appointments} rowKey={(item) => item.id} dateColumn={3} columns={[
        { heading: 'Appointment', value: (a) => a.reference, cell: (a) => <Link to={`/appointments/${a.id}`}>{a.reference}</Link> },
        { heading: 'Doctor', value: (a) => a.doctor.name }, { heading: 'Patient', value: (a) => a.patient_name },
        { heading: 'Consultation date', value: (a) => a.slot.date, cell: (a) => formatDisplayDate(a.slot.date) },
        { heading: 'Visit type', value: (a) => a.visit_type_display }, { heading: 'Status', value: (a) => a.status_display, cell: (a) => <StatusPill status={a.status} label={a.status_display} /> },
      ]} /> : view === 'collections' || view === 'refunds' ? <ManagementTable key={view} rows={data.transactions.filter((item) => item.kind === (view === 'refunds' ? 'refund' : 'charge'))} rowKey={(item) => item.id} dateColumn={4} columns={[
        { heading: 'Transaction', value: (item) => item.id, cell: (item) => <Link to={`/appointments/${item.appointment_id}#payment-${item.id}`}>{item.id}</Link> },
        { heading: 'Appointment', value: (item) => item.reference }, { heading: 'Doctor', value: (item) => item.doctor },
        { heading: 'Method', value: (item) => item.method_display }, { heading: 'Transaction date', value: (item) => item.processed_at, cell: (item) => formatDateTime(item.processed_at) },
        { heading: 'Amount', value: (item) => item.amount, cell: (item) => money(item.amount) },
      ]} /> : <ManagementTable key={view} rows={[...totals.values()].filter((row) => view === 'by-doctor' ? row.appointments > 0 : row.gross !== 0 || row.refunds !== 0)} rowKey={(item) => item.id} columns={[
        { heading: 'Doctor', value: (item) => item.doctor }, { heading: 'Department', value: (item) => item.department },
        ...(view === 'by-doctor' ? [{ heading: 'Appointments', value: (item: DoctorTotals) => item.appointments }] : [
          { heading: 'Gross collections', value: (item: DoctorTotals) => item.gross, cell: (item: DoctorTotals) => money(item.gross) },
          { heading: 'Refunds', value: (item: DoctorTotals) => item.refunds, cell: (item: DoctorTotals) => money(item.refunds) },
          { heading: 'Hospital revenue', value: (item: DoctorTotals) => item.hospital, cell: (item: DoctorTotals) => money(item.hospital) },
          { heading: 'Doctor earnings', value: (item: DoctorTotals) => item.earnings, cell: (item: DoctorTotals) => money(item.earnings) },
        ]),
      ]} />}
    </>}
  </AppLayout>;
}
