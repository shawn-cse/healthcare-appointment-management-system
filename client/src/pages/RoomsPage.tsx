import { useCallback, useEffect, useState } from 'react';
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
  const [q, setQ] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Chamber | null>(null);
  const [roomNumber, setRoomNumber] = useState('');
  const [building, setBuilding] = useState('Building 1');
  const [floor, setFloor] = useState('1st Floor');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRooms = useCallback(
    (search = q) => {
      setLoading(true);
      api
        .get<{ chambers: Chamber[] }>(`/catalog/chambers?q=${encodeURIComponent(search)}`)
        .then((res) => setChambers(res.data.chambers || []))
        .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load rooms.'), 'error'))
        .finally(() => setLoading(false));
    },
    [q, showToast]
  );

  useEffect(() => {
    loadRooms('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setEditing(null);
    setRoomNumber('');
    setBuilding('Building 1');
    setFloor('1st Floor');
    setDescription('');
    setModalOpen(true);
  };

  const openEdit = (c: Chamber) => {
    setEditing(c);
    setRoomNumber(c.room_number);
    setBuilding(c.building);
    setFloor(c.floor);
    setDescription(c.description);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        room_number: roomNumber.trim(),
        building: building.trim(),
        floor: floor.trim(),
        description: description.trim(),
      };
      const res = editing
        ? await api.put<{ message: string }>(`/catalog/chambers/${editing.id}`, payload)
        : await api.post<{ message: string }>('/catalog/chambers', payload);
      showToast(res.data.message, 'success');
      setModalOpen(false);
      loadRooms(q);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not save room.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Chamber) => {
    const ok = await confirm({
      title: 'Delete Consultation Room',
      message: `Delete "${c.room_number}"? Assigned doctors will have their room assignment cleared.`,
      confirmText: 'Delete Room',
      type: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.delete<{ message: string }>(`/catalog/chambers/${c.id}`);
      showToast(res.data.message, 'success');
      loadRooms(q);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not delete room.'), 'error');
    }
  };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">HOSPITAL INFRASTRUCTURE</p>
          <h1>Consultation Rooms</h1>
          <p>Manage OPD consultation chambers, building wings, and doctor room occupancy.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button button-primary" onClick={openNew}>
            <Icon id="ic-plus" /> Add Consultation Room
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadRooms(q);
          }}
          style={{ display: 'flex', gap: 10 }}
        >
          <input
            type="search"
            className="field-control"
            placeholder="Search room number, building, or description..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="button button-primary button-small">
            <Icon id="ic-search" /> Filter
          </button>
        </form>
      </div>

      {loading ? (
        <LoadingScreen />
      ) : chambers.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 48 }}>
          <h3>No consultation rooms found</h3>
        </div>
      ) : (
        <div className="doctors-grid">
          {chambers.map((c) => (
            <div key={c.id} className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="role-pill-badge">{c.building}</span>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>{c.floor}</span>
                </div>
                <h2 style={{ margin: '0 0 6px' }}>{c.room_number}</h2>
                {c.description && (
                  <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>
                    {c.description}
                  </p>
                )}

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
                    Assigned Specialists ({c.doctors_count ?? (c.doctors?.length || 0)})
                  </strong>
                  {c.doctors && c.doctors.length > 0 ? (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.88rem' }}>
                      {c.doctors.map((d) => (
                        <li key={d.id}>
                          <strong>{d.name}</strong>
                          {d.assigned_days_text ? ` — ${d.assigned_days_text}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.86rem' }}>
                      Currently unassigned
                    </p>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  className="button button-small button-outline"
                  style={{ flex: 1 }}
                  onClick={() => openEdit(c)}
                >
                  Edit Room
                </button>
                <button
                  type="button"
                  className="button button-small button-outline"
                  style={{ color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}
                  onClick={() => handleDelete(c)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className="panel" style={{ width: '100%', maxWidth: 480, padding: 24 }}>
            <h2 style={{ marginTop: 0 }}>
              {editing ? `Edit Room ${editing.room_number}` : 'Add Consultation Room'}
            </h2>
            <form onSubmit={handleSave} className="form-grid two-col">
              <div className="form-group full">
                <label htmlFor="rm-num">Room Number / Code</label>
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

              {!editing && (
                <>
                  <div className="form-group">
                    <label htmlFor="rm-bld">Building</label>
                    <input
                      id="rm-bld"
                      type="text"
                      className="field-control"
                      value={building}
                      onChange={(e) => setBuilding(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="rm-flr">Floor</label>
                    <input
                      id="rm-flr"
                      type="text"
                      className="field-control"
                      value={floor}
                      onChange={(e) => setFloor(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="form-group full">
                <label htmlFor="rm-desc">Description / Equipment Notes</label>
                <textarea
                  id="rm-desc"
                  rows={2}
                  className="field-control"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. General OPD Suite, ECG Equipped"
                />
              </div>

              <div className="form-group full" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
