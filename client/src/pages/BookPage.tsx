import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { BookingRules, VisitField, type PaymentMethod, type VisitType } from '../components/BookingFields.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, formatLongDate } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { AppointmentSlot, Doctor } from '../types/index.ts';

type SlotData = { slot: AppointmentSlot; doctor: Doctor; gateway_enabled: boolean };

export default function BookPage() {
  const { slotId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [data, setData] = useState<SlotData>();
  const [visit, setVisit] = useState<VisitType>('first');
  const [payment, setPayment] = useState<PaymentMethod | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    setData(undefined);
    api.get<SlotData>(`/catalog/slots/${slotId}`).then(({ data }) => {
      setData(data);
      setPayment(data.doctor.accepted_payment_methods.find((method) => method === 'cash' || data.gateway_enabled) || '');
    }).catch((err) => setError(getApiErrorMessage(err, 'This consultation time is currently unavailable.')));
  }, [slotId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !payment) return;
    setSaving(true);
    try {
      const response = await api.post<{ appointment: { id: number }; message: string }>('/appointments', { slot_id: data.slot.id, visit_type: visit, payment_method: payment });
      showToast(response.data.message, 'success');
      navigate(`/appointments/${response.data.appointment.id}`);
    } catch (err) { setError(getApiErrorMessage(err, 'Could not book this appointment.')); }
    finally { setSaving(false); }
  }

  return <AppLayout><div className="page-heading"><h1>Book Appointment</h1>
    <Link className="button button-outline" to={data ? `/doctors/${data.doctor.profile_slug}#booking` : '/doctors'}>Choose another time</Link>
  </div>
    {error && <p role="alert" className="form-errors">{error}</p>}
    {!data ? !error && <LoadingScreen /> : <form className="panel padded-panel form-grid" onSubmit={submit}>
      <div className="form-group full"><h2>{data.doctor.full_doctor_title}</h2><p>{data.doctor.department?.name} · {formatLongDate(data.slot.date)} · {data.slot.start_time_12h}–{data.slot.end_time_12h}</p></div>
      <VisitField value={visit} onChange={setVisit} />
      <label className="form-group">Payment method<select className="field-control" required value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
        <option value="" disabled>Select payment method</option>
        {data.doctor.accepted_payment_methods.map((method) => <option key={method} value={method} disabled={method === 'online' && !data.gateway_enabled}>
          {method === 'cash' ? 'Reception counter' : data.gateway_enabled ? 'Pay online' : 'Online (unavailable)'}
        </option>)}
      </select></label>
      <BookingRules doctor={data.doctor} visit={visit} />
      <button className="button button-primary" disabled={saving || !payment}>{saving ? 'Booking…' : 'Confirm appointment'}</button>
    </form>}
  </AppLayout>;
}
