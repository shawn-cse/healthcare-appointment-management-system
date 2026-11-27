import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Chamber, Department } from '../types/index.ts';

export default function RoomsPage() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [department, setDepartment] = useState('');
  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [loading, setLoading] = useState(true);
  const [occupancyFilter, setOccupancyFilter] = useState<'all' | 'occupied' | 'empty'>('all');

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
    api.get<{ departments: Department[] }>('/catalog/departments').then(({ data }) => setDepartments(data.departments)).catch((err) => showToast(getApiErrorMessage(err, 'Could not load departments.'), 'error'));
  }, [loadRooms, showToast]);

  const openNew = () => {
    setEditing(null);
    setDepartment('');
    setRoomNumber('');
    setDescription('');
    setModalOpen(true);
  };

  const openEdit = (c: Chamber) => {
    setEditing(c);
    setDepartment(c.department_id ? String(c.department_id) : '');
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
        department_id: department || null,
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
    const action = editing.is_active ? 'Deactivate' : 'Activate';
    const ok = await confirm({ title: `${action} room`, message: `${action} ${editing.room_number}?`, confirmText: action, type: 'warning' });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await api.put<{ message: string }>(`/catalog/chambers/${editing.id}`, { is_active: !editing.is_active });
      showToast(res.data.message, 'success');
      setModalOpen(false);
      loadRooms();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not change room status.'), 'error');
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

        {loading ? <LoadingScreen /> : <ManagementTable rows={chambers.filter((room) => {
          const occupied = !!room.doctors?.length || !!room.staff_users?.length;
          return occupancyFilter === 'all' || occupied === (occupancyFilter === 'occupied');
        })} rowKey={(room) => room.id}
          filters={<select className="field-control" aria-label="Room occupancy" value={occupancyFilter} onChange={(e) => setOccupancyFilter(e.target.value as typeof occupancyFilter)}>
            <option value="all">All rooms</option><option value="occupied">Assigned rooms</option><option value="empty">Unassigned rooms</option>
          </select>} columns={[
            { heading: 'Room number', value: (room) => `${room.room_number} ${room.description}`, cell: (room) => <button className="text-link" type="button" onClick={() => openEdit(room)}>{room.room_number}</button> },
            { heading: 'Department', value: (room) => room.department?.name || 'Unassigned' },
            { heading: 'Assigned doctors', value: (room) => room.doctors?.map((doctor) => doctor.name).join(', ') || 'Unassigned',
              cell: (room) => room.doctors?.length ? <details><summary>{room.doctors.map((doctor) => doctor.name).join(', ')}</summary>
                {room.doctors.map((doctor) => <p key={doctor.id}><strong>{doctor.name}</strong> {(doctor.schedules ?? []).map((period) => `${period.weekday_short} ${period.start_time_12h}`).join(', ')}</p>)}
              </details> : 'Unassigned' },
            { heading: 'Status', value: (room) => room.is_active ? 'Active' : 'Inactive' },
            { heading: 'Actions', value: () => '', cell: (room) => <button className="button button-small button-outline" type="button" onClick={() => openEdit(room)}>Edit room</button> },
          ]} />}
      </div>

      {modalOpen && (
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

                <label className="form-group">Department
                  <select className="field-control" value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
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
                  {deleting ? 'Saving...' : editing.is_active ? 'Deactivate room' : 'Activate room'}
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
        </div>
      )}
    </AppLayout>
  );
}
