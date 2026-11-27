import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { ManagementTable, type Column } from '../components/ManagementTable.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface PaymentRow { id: number | null; appointment_id: number; reference: string; patient: string; doctor: string; department: string; amount: number; method: string; date: string; status: string; status_label: string }

export default function PaymentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PaymentRow[]>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  useEffect(() => {
    api.get<{ rows: PaymentRow[] }>('/payments').then(({ data }) => setRows(data.rows)).catch((err) => setError(getApiErrorMessage(err, 'Payments could not be loaded.')));
  }, []);
  const columns: Column<PaymentRow>[] = [
    { heading: 'Payment ID', value: (p) => p.id || '', cell: (p) => p.id ? <Link to={`/appointments/${p.appointment_id}#payment-${p.id}`}>{p.id}</Link> : '—' },
    { heading: 'Appointment ID', value: (p) => p.reference, cell: (p) => <Link to={`/appointments/${p.appointment_id}`}>{p.reference}</Link> },
    ...(user?.role === 'patient' ? [] : [{ heading: 'Patient', value: (p: PaymentRow) => p.patient }]),
    { heading: 'Doctor', value: (p) => `${p.doctor} ${p.department}`, cell: (p) => <>{p.doctor}<br /><small>{p.department}</small></> },
    { heading: 'Amount', value: (p) => p.amount, cell: (p) => `BDT ${p.amount.toFixed(2)}` },
    { heading: 'Method', value: (p) => p.method },
    { heading: 'Date', value: (p) => p.date, cell: (p) => formatDateTime(p.date) },
    { heading: 'Status', value: (p) => p.status_label, cell: (p) => <StatusPill status={p.status} label={p.status_label} /> },
  ];
  return <AppLayout>
    <div className="page-heading"><h1>{user?.role === 'patient' ? 'My Payments' : 'Payment Management'}</h1></div>
    {error ? <p role="alert">{error}</p> : !rows ? <LoadingScreen /> : <ManagementTable
      rows={rows.filter((p) => (!status || p.status === status) && (!method || p.method === method))} columns={columns}
      rowKey={(p) => p.id ?? `unpaid-${p.appointment_id}`} dateColumn={columns.length - 2}
      filters={<>
        <select className="field-control" aria-label="Payment status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{[...new Map(rows.map((p) => [p.status, p.status_label]))].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select className="field-control" aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>{[...new Set(rows.map((p) => p.method))].map((value) => <option key={value}>{value}</option>)}
        </select>
      </>} />}
  </AppLayout>;
}
