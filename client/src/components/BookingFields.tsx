import type { Doctor } from '../types/index.ts';

export type VisitType = 'first' | 'followup' | 'report';
export type PaymentMethod = 'cash' | 'online';

export function VisitField({ value, onChange }: { value: VisitType; onChange: (value: VisitType) => void }) {
  return <label className="form-group">Visit type
    <select className="field-control" value={value} onChange={(e) => onChange(e.target.value as VisitType)}>
      <option value="first">First Visit</option><option value="followup">Follow-up Visit</option><option value="report">Report Checking</option>
    </select>
  </label>;
}

export function BookingRules({ doctor, visit }: { doctor: Doctor; visit: VisitType }) {
  const fee = { first: doctor.initial_fee, followup: doctor.followup_fee, report: doctor.report_fee }[visit];
  const cancel = doctor.cancel_fee_mode === 'percent' ? `${doctor.cancel_fee_value}% of the consultation fee` : `BDT ${doctor.cancel_fee_value}`;
  return <section className="booking-rules"><h2>Booking rules</h2><dl>
    <div><dt>Consultation fee</dt><dd>BDT {fee.toFixed(2)}</dd></div>
    <div><dt>Advance booking</dt><dd>{doctor.booking_window_hours !== null ? `Opens ${doctor.booking_window_hours} hours before consultation` : `At least ${doctor.booking_notice_hours} hours before consultation`}</dd></div>
    <div><dt>Payment deadline</dt><dd>{doctor.payment_policy === 'within' ? doctor.booking_window_hours !== null ? `${doctor.payment_deadline_hours} hours before consultation` : `Within ${doctor.payment_deadline_hours} hours of booking and before consultation` : 'On the day of consultation'}</dd></div>
    <div><dt>Accepted methods</dt><dd>{doctor.accepted_payment_methods.map((method) => method === 'cash' ? 'Reception counter' : 'Online').join(', ')}</dd></div>
    <div><dt>Cancellation</dt><dd>Request through Report Issue. A cancellation fee of {cancel} may apply.</dd></div>
    {visit !== 'first' && <div><dt>Eligibility</dt><dd>Completed visit with this doctor within {visit === 'followup' ? doctor.followup_within_days : doctor.report_within_days} days.</dd></div>}
  </dl></section>;
}
