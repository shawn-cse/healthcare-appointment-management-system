import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Chamber } from '../types/index.ts';

export default function RoomsPage() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [loading, setLoading] = useState(true);

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Chamber | null>(null);
  const [roomNumber, setRoomNumber] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadRooms = useCallback(() => {
    setLoading(true);
    api
      .get<{ chambers: Chamber[] }>('/catalog/chambers')
      .then((res) => setChambers(res.data.chambers || []))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load rooms.'), 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const openNew = () => {
    setEditing(null);
    setRoomNumber('');
    setDescription('');
    setModalOpen(true);
  };

  const openEdit = (c: Chamber) => {
    setEditing(c);
    setRoomNumber(c.room_number);
    setDescription(c.description || '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        room_number: roomNumber.trim(),
        description: description.trim(),
      };
      const res = editing
        ? await api.put<{ message: string }>(`/catalog/chambers/${editing.id}`, payload)
        : await api.post<{ message: string }>('/catalog/chambers', payload);
      showToast(res.data.message, 'success');
      setModalOpen(false);
      loadRooms();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not save room.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteInModal = async () => {
    if (!editing) return;
    const assignedCount = editing.doctors?.length || 0;
    const warningNote = assignedCount
      ? ` ${assignedCount} assigned doctor${assignedCount === 1 ? '' : 's'} will have their room set to not assigned.`
      : '';
    const ok = await confirm({
      title: 'Delete room',
      message: `Are you sure you want to permanently delete ${editing.room_number}?${warningNote} This action cannot be undone.`,
      confirmText: 'Delete room',
      type: 'danger',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await api.delete<{ message: string }>(`/catalog/chambers/${editing.id}`);
      showToast(res.data.message, 'success');
      setModalOpen(false);
      loadRooms();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not delete room.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="staff-directory-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">HOSPITAL ROOMS</p>
            <h1>Room Management</h1>
            <p>Manage hospital rooms, short descriptions, and assigned doctors &amp; staff.</p>
          </div>
          <div className="heading-actions">
            <button type="button" className="button button-primary" onClick={openNew}>
              <Icon id="ic-plus" /> Add Room
            </button>
          </div>
        </div>

        {loading ? <LoadingScreen /> : <ManagementTable rows={chambers} rowKey={(room) => room.id} showSortSelect={false} paginate={false} columns={[
            { heading: 'Room number', value: (room) => `${room.room_number} ${room.description}`, cell: (room) => <button className="text-link" type="button" onClick={() => openEdit(room)}>{room.room_number}</button> },
            { heading: 'Assigned doctors', value: (room) => room.doctors?.map((doctor) => doctor.name).join(', ') || 'Unassigned',
              cell: (room) => room.doctors?.length ? <details><summary>{room.doctors.map((doctor) => doctor.name).join(', ')}</summary>
                {room.doctors.map((doctor) => <p key={doctor.id}><strong>{doctor.name}</strong> {(doctor.schedules ?? []).map((period) => `${period.weekday_short} ${period.start_time_12h}`).join(', ')}</p>)}
              </details> : 'Unassigned' },
            { heading: 'Actions', value: () => '', cell: (room) => <button className="button button-small button-outline" type="button" onClick={() => openEdit(room)}>Edit room</button> },
          ]} />}
      </div>

      {modalOpen && createPortal(
        <div
          className="sm-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <form className="sm-modal-panel" style={{ maxWidth: 480 }} onSubmit={handleSave}>
            <div className="sm-modal-header">
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>
                  ROOM DETAILS
                </p>
                <h2 style={{ margin: 0 }}>
                  {editing ? `Edit Room: ${editing.room_number}` : 'Add Room'}
                </h2>
              </div>
            </div>

            <div className="sm-modal-body">
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-group">
                  <label htmlFor="rm-num">Room No *</label>
                  <input
                    id="rm-num"
                    type="text"
                    className="field-control"
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    placeholder="e.g. Room 405"
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="rm-desc">Description (Optional)</label>
                  <textarea
                    id="rm-desc"
                    rows={3}
                    className="field-control"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Ground Floor, Outpatient Wing"
                  />
                </div>
              </div>
            </div>

            <div
              className="sm-modal-footer"
              style={{
                justifyContent: editing ? 'space-between' : 'flex-end',
              }}
            >
              {editing && (
                <button
                  type="button"
                  className="button button-outline"
                  style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.35)' }}
                  disabled={deleting || saving}
                  onClick={handleDeleteInModal}
                >
                  {deleting ? 'Deleting...' : 'Delete room'}
                </button>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={saving || deleting}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </form>
        </div>,
        document.body
      )}
    </AppLayout>
  );
}
