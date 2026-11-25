import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { GreenDatePicker } from '../components/DateTimePickers.tsx';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill, formatDisplayDate } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Appointment, Doctor } from '../types/index.ts';

interface ReportsResponse {
  report: {
    total: number;
    completed: number;
    confirmed: number;
    cancelled: number;
    unpaid: number;
    collected: number;
    refunded: number;
    net: number;
    hospital_cut: number;
    doctor_cut: number;
  };
  appointments: Appointment[];
  doctors: Doctor[];
  from_date: string;
  to_date: string;
  selected_doctor: string;
}

export default function ReportsPage() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fromDate, setFromDate] = useState(searchParams.get('from') || '');
  const [toDate, setToDate] = useState(searchParams.get('to') || '');
  const [selectedDoctor, setSelectedDoctor] = useState(searchParams.get('doctor') || '');
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadReports = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchParams.get('from')) params.set('from', searchParams.get('from')!);
    if (searchParams.get('to')) params.set('to', searchParams.get('to')!);
    if (searchParams.get('doctor')) params.set('doctor', searchParams.get('doctor')!);

    api
      .get<ReportsResponse>(`/reports?${params.toString()}`)
      .then((res) => {
        setData(res.data);
        setFromDate(res.data.from_date);
        setToDate(res.data.to_date);
        setSelectedDoctor(res.data.selected_doctor);
      })
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load reports.'), 'error'))
      .finally(() => setLoading(false));
  }, [searchParams, showToast]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const applyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (fromDate) next.set('from', fromDate);
    if (toDate) next.set('to', toDate);
    if (selectedDoctor) next.set('doctor', selectedDoctor);
    setSearchParams(next);
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (selectedDoctor) params.set('doctor', selectedDoctor);
      const res = await api.get(`/reports/excel?${params.toString()}`, { responseType: 'blob' });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `green-hospital-report-${fromDate || 'export'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Operations Excel workbook downloaded.', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Excel export failed.'), 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading || !data) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  const r = data.report;
  const totalBase = Math.max(1, r.total);
  const netBase = Math.max(1, r.hospital_cut + r.doctor_cut);

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLINICAL ANALYTICS &amp; REVENUE</p>
          <h1>Reports &amp; Reconciliation</h1>
          <p>
            Period: <strong>{formatDisplayDate(data.from_date)}</strong> –{' '}
            <strong>{formatDisplayDate(data.to_date)}</strong>
          </p>
        </div>
        <div className="heading-actions no-print">
          <button type="button" className="button button-outline" onClick={() => window.print()}>
            Print Report
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={exporting}
            onClick={handleExportExcel}
          >
            <Icon id="ic-download" /> {exporting ? 'Generating XLSX...' : 'Export Excel (.xlsx)'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="panel no-print" style={{ padding: 16, marginBottom: 20 }}>
        <form
          onSubmit={applyFilter}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <div className="form-group" style={{ width: 175, marginBottom: 0 }}>
            <label htmlFor="rp-from">From Date</label>
            <GreenDatePicker id="rp-from" value={fromDate} onChange={setFromDate} />
          </div>
          <div className="form-group" style={{ width: 175, marginBottom: 0 }}>
            <label htmlFor="rp-to">To Date</label>
            <GreenDatePicker id="rp-to" value={toDate} onChange={setToDate} />
          </div>
          {data.doctors.length > 1 && (
            <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
              <label htmlFor="rp-doc">Specialist Filter</label>
              <select
                id="rp-doc"
                className="field-control"
                value={selectedDoctor}
                onChange={(e) => setSelectedDoctor(e.target.value)}
              >
                <option value="">All Hospital Specialists</option>
                {data.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.department?.name || 'General'})
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="button button-primary">
            Update Report
          </button>
        </form>
      </div>

      {/* Headline Metrics */}
      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric-card">
          <div className="metric-top">
            <span>Total Bookings</span>
          </div>
          <strong>{r.total}</strong>
          <small>
            {r.completed} completed · {r.confirmed} confirmed
          </small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Verified Collections</span>
          </div>
          <strong>BDT {r.collected.toFixed(0)}</strong>
          <small>Verified cash &amp; online gateway charges</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Paid Refunds</span>
          </div>
          <strong>BDT {r.refunded.toFixed(0)}</strong>
          <small>Settled cancellations</small>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Net Collected</span>
          </div>
          <strong style={{ color: 'var(--forest)' }}>BDT {r.net.toFixed(0)}</strong>
          <small>Collections minus completed refunds</small>
        </div>
      </div>

      <div className="content-columns" style={{ marginBottom: 20 }}>
        <div className="panel" style={{ padding: 22 }}>
          <h2 style={{ marginTop: 0 }}>Appointment Outcomes</h2>
          {[
            ['Completed Visits', r.completed, '#0d5c46'],
            ['Confirmed Upcoming', r.confirmed, '#0369a1'],
            ['Cancelled', r.cancelled, '#dc2626'],
            ['Unpaid Reservations', r.unpaid, '#b45309'],
          ].map(([label, val, color]) => {
            const pct = Math.round((Number(val) / totalBase) * 100);
            return (
              <div key={String(label)} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{label}</span>
                  <strong>
                    {val} ({pct}%)
                  </strong>
                </div>
                <div style={{ height: 8, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: String(color),
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="panel" style={{ padding: 22 }}>
          <h2 style={{ marginTop: 0 }}>Proportional Revenue Reconciliation</h2>
          {[
            ['Hospital Net Share', r.hospital_cut, '#0d5c46'],
            ['Specialist Doctor Net Share', r.doctor_cut, '#127559'],
          ].map(([label, val, color]) => {
            const pct = Math.round((Number(val) / netBase) * 100);
            return (
              <div key={String(label)} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{label}</span>
                  <strong>
                    BDT {Number(val).toFixed(2)} ({pct}%)
                  </strong>
                </div>
                <div style={{ height: 10, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: String(color),
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Appointments table preview */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Appointment Breakdown (Latest 50 in Period)</h2>
            <p>Full multi-sheet dataset included in Excel export</p>
          </div>
        </div>
        {data.appointments.length === 0 ? (
          <div className="empty-state" style={{ padding: 36 }}>
            <h3>No appointments in this date range</h3>
          </div>
        ) : (
          <div className="excel-table-wrap">
            <table className="excel-sheet">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Status</th>
                  <th>Fee BDT</th>
                  <th>Hospital Cut</th>
                  <th>Doctor Cut</th>
                </tr>
              </thead>
              <tbody>
                {data.appointments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/appointments/${a.id}`} style={{ fontWeight: 700, color: 'var(--forest)' }}>
                        {a.reference}
                      </Link>
                    </td>
                    <td>{formatDisplayDate(a.slot.date)}</td>
                    <td>{a.patient_name}</td>
                    <td>{a.doctor.name}</td>
                    <td>
                      <StatusPill status={a.status} label={a.status_display} />
                    </td>
                    <td>{a.fee.toFixed(0)}</td>
                    <td>{a.hospital_cut.toFixed(2)}</td>
                    <td>{a.doctor_cut.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
