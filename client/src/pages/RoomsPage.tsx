import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
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
  const [search, setSearch] = useState('');
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
  }, [loadRooms]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return chambers.filter((c) => {
      const hasPeople =
        (c.doctors_count ?? (c.doctors?.length || 0)) > 0 || (c.staff_users?.length || 0) > 0;
      if (occupancyFilter === 'occupied' && !hasPeople) return false;
      if (occupancyFilter === 'empty' && hasPeople) return false;
      if (!q) return true;
      return (
        c.room_number.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.doctors || []).some((d) => d.name.toLowerCase().includes(q)) ||
        (c.staff_users || []).some((s) => s.name.toLowerCase().includes(q))
      );
    });
  }, [chambers, search, occupancyFilter]);

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
    const ok = await confirm({
      title: 'Delete Room',
      message: `Delete "${editing.room_number}"? Assigned doctors and staff will have their room cleared.`,
      confirmText: 'Delete Room',
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
            <h1>Rooms</h1>
            <p>Manage rooms, short descriptions, and doctor &amp; staff room occupancy.</p>
          </div>
          <div className="heading-actions">
            <button type="button" className="button button-primary" onClick={openNew}>
              <Icon id="ic-plus" /> Add Room
            </button>
          </div>
        </div>

        <div className="excel-sheet-panel">
          <div className="excel-sheet-header-bar">
            <div className="activity-filter-toolbar">
              <div className="staff-live-search-wrap" style={{ flex: '1 1 260px', maxWidth: 420 }}>
                <Icon id="ic-search" className="icon search-ic" />
                <input
                  type="text"
                  className="field-control"
                  placeholder="Type to search room no, description, or doctor name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
                {search && (
                  <button
                    type="button"
                    className="staff-live-search-clear"
                    title="Clear search"
                    onClick={() => setSearch('')}
                  >
                    ✕
                  </button>
                )}
              </div>

              <select
                className="field-control activity-select"
                aria-label="Filter rooms by occupancy"
                value={occupancyFilter}
                onChange={(e) =>
                  setOccupancyFilter(e.target.value as 'all' | 'occupied' | 'empty')
                }
              >
                <option value="all">All Rooms</option>
                <option value="occupied">Assigned Only</option>
                <option value="empty">Unassigned Only</option>
              </select>

              <div className="sheet-indicator" style={{ marginLeft: 'auto' }}>
                <span className="live-dot-pulse" />
                <span>
                  Showing <strong>{filtered.length}</strong> of <strong>{chambers.length}</strong>{' '}
                  rooms
                </span>
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingScreen />
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '36px 24px' }}>
              <h3>No rooms matched</h3>
              <p className="muted">Try another keyword or add a new room.</p>
            </div>
          ) : (
            <div className="excel-table-wrap">
              <table className="excel-grid-table">
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '27%' }} />
                  <col style={{ width: '29%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '9%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Room No / Name</th>
                    <th>Description</th>
                    <th>Assigned Doctors &amp; Schedule</th>
                    <th>Staff</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, idx) => (
                    <tr key={c.id}>
                      <td className="muted">{idx + 1}</td>
                      <td>
                        <span className="room-chip role-pill-badge">{c.room_number}</span>
                      </td>
                      <td>{c.description || <span className="muted">—</span>}</td>
                      <td>
                        {c.doctors && c.doctors.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {c.doctors.map((d) => (
                              <div key={d.id} style={{ fontSize: '12px' }}>
                                <strong>{d.name}</strong>
                                {d.schedules && d.schedules.length > 0 ? (
                                  <span className="muted">
                                    {' '}
                                    ·{' '}
                                    {d.schedules
                                      .map(
                                        (s) =>
                                          `${s.weekday_short} (${s.start_time_12h}–${s.end_time_12h})`
                                      )
                                      .join(', ')}
                                  </span>
                                ) : d.assigned_days_text ? (
                                  <span className="muted"> · {d.assigned_days_text}</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">Unassigned</span>
                        )}
                      </td>
                      <td>
                        {c.staff_users && c.staff_users.length > 0 ? (
                          <div style={{ fontSize: '12px' }}>
                            {c.staff_users.map((su) => `${su.name} (${su.role_display})`).join(', ')}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-small button-outline"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
              <button
                type="button"
                className="button button-small button-outline"
                onClick={() => setModalOpen(false)}
              >
                ✕ Close
              </button>
            </div>

            <div className="sm-modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="rm-num">Room No / Name *</label>
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
                    placeholder="e.g. Building 1, 2nd Floor, General OPD Suite"
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
                  {deleting ? 'Deleting...' : 'Delete'}
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
