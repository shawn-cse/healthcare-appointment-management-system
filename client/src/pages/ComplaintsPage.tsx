import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AttachmentLink } from '../components/AttachmentLink.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { LoadingScreen, StatusPill, formatDateTime } from '../components/UI.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { Complaint } from '../types/index.ts';

export default function ComplaintsPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Complaint[]>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  useEffect(() => { api.get<{ complaints: Complaint[] }>('/complaints').then(({ data }) => setTickets(data.complaints)).catch((err) => setError(getApiErrorMessage(err, 'Could not load complaints.'))); }, []);
  return <AppLayout>
    <div className="page-heading"><h1>{user?.role === 'patient' ? 'Complaint & Support' : 'Support'}</h1>
      {user?.role !== 'admin' && <Link to="/complaints/new" className="button button-primary">{user?.role === 'patient' ? 'Complaint & Support' : 'New request'}</Link>}
    </div>
    {error ? <p role="alert">{error}</p> : !tickets ? <LoadingScreen /> : <ManagementTable
      rows={user?.role === 'patient' ? tickets : tickets.filter((item) => (!status || item.status === status) && (!category || item.category === category))}
      rowKey={(item) => item.id}
      dateColumn={4}
      showSortSelect={user?.role !== 'patient'}
      paginate={user?.role !== 'patient'}
      filters={user?.role === 'patient' ? undefined : <><select className="field-control" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>
        {[...new Map(tickets.map((item) => [item.status, item.status_display]))].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select><select className="field-control" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>
        {[...new Map(tickets.map((item) => [item.category, item.category_display]))].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></>} columns={[
        { heading: 'Complaint ID', value: (item) => item.display_code, cell: (item) => <Link to={`/complaints/${item.id}`}>{item.display_code}</Link> },
        { heading: 'Appointment ID', value: (item) => item.appointment?.reference || '', cell: (item) => item.appointment ? <Link to={`/appointments/${item.appointment.id}`}>{item.appointment.reference}</Link> : '—' },
        { heading: 'Subject', value: (item) => item.subject }, { heading: 'Category', value: (item) => item.category_display },
        { heading: 'Date', value: (item) => item.created_at, cell: (item) => formatDateTime(item.created_at) },
        { heading: 'Status', value: (item) => item.status_display, cell: (item) => <StatusPill status={item.status} label={item.status_display} /> },
      ]} />}
  </AppLayout>;
}

export function ComplaintDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<Complaint>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get<{ complaint: Complaint }>(`/complaints/${id}`).then(({ data }) => setTicket(data.complaint)).catch((err) => setError(getApiErrorMessage(err, 'Could not load the complaint.'))); }, [id]);
  async function reply(event: React.FormEvent) {
    event.preventDefault(); if (!ticket) return; setSaving(true);
    try {
      const { data } = await api.post<{ complaint: Complaint }>(`/complaints/${ticket.id}/reply`, { message: draft });
      setTicket(data.complaint); setDraft(''); setError('');
    } catch (err) { setError(getApiErrorMessage(err, 'Could not send the reply.')); }
    finally { setSaving(false); }
  }
  return <AppLayout><div className="page-heading"><h1>{ticket?.subject || 'Complaint details'}</h1><Link to="/complaints" className="button button-outline">{user?.role === 'patient' ? 'Back to Complaint & Support' : 'Back to complaints'}</Link></div>
    {error && <p role="alert">{error}</p>}
    {!ticket ? !error && <LoadingScreen /> : <section className="panel padded-panel">
      <p>{ticket.display_code} · {ticket.category_display} · {formatDateTime(ticket.created_at)} <StatusPill status={ticket.status} label={ticket.status_display} /></p>
      {ticket.appointment && user?.is_active && <p>Appointment <Link to={`/appointments/${ticket.appointment.id}`}>{ticket.appointment.reference}</Link></p>}
      <p className="preserve-lines">{ticket.message}</p>
      {ticket.attachment && <AttachmentLink path={ticket.attachment} filename={ticket.attachment_name || 'Original attachment'} />}
      {ticket.admin_attachment && <AttachmentLink path={ticket.admin_attachment} filename={ticket.admin_attachment_name || 'Response attachment'} />}
      <h2>Conversation</h2>
      {!ticket.messages.some((message) => message.message === ticket.response) && ticket.response && <p className="preserve-lines">{ticket.response}</p>}
      {ticket.messages.map((message) => <article key={message.id}><strong>{message.author_name}</strong> <small>{formatDateTime(message.created_at)}</small><p className="preserve-lines">{message.message}</p></article>)}
      {(user?.role === 'patient' || !ticket.appointment || user?.role === 'admin') && <form onSubmit={reply} className="form-grid">
        <label className="form-group">Reply<textarea className="field-control" required value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
        <button className="button button-primary" disabled={saving || !draft.trim()}>Send reply</button>
      </form>}
    </section>}
  </AppLayout>;
}
