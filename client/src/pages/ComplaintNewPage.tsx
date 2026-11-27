import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Appointment } from '../types/index.ts';

export default function ComplaintNewPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const issueMode = searchParams.get('issue') === '1';
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [category, setCategory] = useState(issueMode ? 'other_issue' : 'support');
  const [appointmentId, setAppointmentId] = useState(searchParams.get('appointment') || '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isPatient = user?.role === 'patient';
  const [recipients, setRecipients] = useState<Array<{ id: number; name: string; role: string }>>([]);
  const [recipient, setRecipient] = useState('');
  useEffect(() => {
    if (!isPatient) api.get<{ recipients: typeof recipients }>('/complaints/recipients').then(({ data }) => setRecipients(data.recipients)).catch(() => {});
  }, [isPatient]);

  useEffect(() => {
    if (!isPatient) return;
    api
      .get<{ patient_appointments: Appointment[] }>('/complaints')
      .then((res) => setAppointments(res.data.patient_appointments || []))
      .catch(() => {});
  }, [isPatient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('subject', subject.trim());
      formData.append('category', category);
      formData.append('message', message.trim());
      if (recipient) formData.append('recipient_id', recipient);
      if (isPatient && appointmentId) {
        formData.append('appointment_id', appointmentId);
      }
      if (attachment) {
        formData.append('attachment', attachment);
      }

      const res = await api.post<{ message: string }>('/complaints', formData);
      showToast(res.data.message || 'Ticket submitted.', 'success');
      navigate('/complaints');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to submit ticket.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">HOSPITAL SUPPORT &amp; ESCALATIONS</p>
          <h1>{issueMode ? 'Report Issue' : isPatient ? 'Complaint & Support' : 'New Support Request'}</h1>
          <p>
            {isPatient
              ? 'Support inquiries linked to an appointment go to your doctor; formal complaints and unlinked inquiries go to hospital administration.'
              : 'Select general support or file an administrative request.'}
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to="/complaints">
            ← Back to {isPatient ? 'Complaint & Support' : 'Tickets'}
          </Link>
        </div>
      </div>

      <div className="panel" style={{ padding: 24 }}>
        <form onSubmit={handleSubmit} className="form-grid" style={{ gap: '16px 20px' }}>
          {!isPatient && <label className="form-group">Recipient
            <select className="field-control" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">Hospital administration</option>{recipients.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.role})</option>)}
            </select>
          </label>}

          {isPatient && (
            <div className="form-group">
              <label htmlFor="cn-appt">Related Appointment</label>
              <select
                id="cn-appt"
                required={issueMode}
                disabled={issueMode && !!appointmentId}
                className="field-control"
                value={appointmentId}
                onChange={(e) => setAppointmentId(e.target.value)}
              >
                <option value="">Not linked to an appointment</option>
                {appointments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.reference} — {a.doctor.name} ({a.slot.date})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="cn-cat">Category</label>
            <select
              id="cn-cat"
              className="field-control"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {issueMode ? <>
                <option value="cancel_appointment">Cancel Appointment</option>
                <option value="reschedule">Adjust Date &amp; Time</option>
                <option value="adjust_visit">Adjust Consultation Fee or Visit Type</option>
                <option value="payment_issue">Payment Issue</option>
                <option value="refund_request">Refund Request</option>
                <option value="other_issue">Other Issue</option>
              </> : !isPatient ? <>
                <option value="support">General Support</option>
                <option value="assistance">Assistance Request</option>
                <option value="internal_complaint">Internal Complaint</option>
                <option value="admin_request">Administrative Request</option>
                <option value="technical">Technical Issue</option>
                <option value="important_message">Important Message</option>
              </> : <>
                <option value="support">Support &amp; General Inquiry</option>
                <option value="formal_complaint">Formal Complaint</option>
              </>}
            </select>
            {isPatient && !issueMode && (
              <p className="muted" style={{ marginTop: 4, marginBottom: 0, fontSize: '0.84rem' }}>
                {category === 'formal_complaint'
                  ? 'Formal Complaint goes directly to the Hospital Administration section.'
                  : appointmentId
                    ? "Support & General Inquiry linked to an appointment goes to the appointment's doctor."
                    : 'Support & General Inquiry linked to an appointment goes to the doctor; without a linked appointment, it goes to Hospital Administration.'}
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="cn-subj">Subject *</label>
            <input
              id="cn-subj"
              type="text"
              maxLength={150}
              className="field-control"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your request or concern"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cn-file">Supporting Document / Screenshot</label>
            <input
              id="cn-file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="field-control"
              onChange={(e) => setAttachment(e.target.files?.[0] || null)}
            />
          </div>

          <div className="form-group full">
            <label htmlFor="cn-msg">Description *</label>
            <textarea
              id="cn-msg"
              rows={3}
              className="field-control"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what happened, relevant dates, or how we can help..."
              required
            />
          </div>

          <div className="form-group full" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <Link className="button button-outline" to="/complaints">
              Cancel
            </Link>
            <button type="submit" className="button button-primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
