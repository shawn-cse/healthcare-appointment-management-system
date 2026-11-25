import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen, StatusPill } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Department } from '../types/index.ts';

export default function DepartmentsPage() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('heart-pulse');
  const [saving, setSaving] = useState(false);

  const loadDepts = useCallback(() => {
    setLoading(true);
    api
      .get<{ departments: Department[] }>('/catalog/departments?all=1')
      .then((res) => setDepartments(res.data.departments || []))
      .catch((err) => showToast(getApiErrorMessage(err, 'Failed to load departments.'), 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    loadDepts();
  }, [loadDepts]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setIcon('heart-pulse');
    setModalOpen(true);
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setName(d.name);
    setDescription(d.description);
    setIcon(d.icon || 'heart-pulse');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        icon: icon.trim(),
      };
      const res = editing
        ? await api.put<{ message: string }>(`/catalog/departments/${editing.id}`, payload)
        : await api.post<{ message: string }>('/catalog/departments', payload);
      showToast(res.data.message, 'success');
      setModalOpen(false);
      loadDepts();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not save department.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (d: Department) => {
    const ok = await confirm({
      title: d.is_active ? 'Deactivate Department' : 'Activate Department',
      message: d.is_active
        ? `Hide "${d.name}" from public patient booking? Active appointments must be completed or cancelled first.`
        : `Re-activate "${d.name}" so specialists are visible to patients?`,
      confirmText: d.is_active ? 'Deactivate' : 'Activate',
      type: d.is_active ? 'warning' : 'info',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ message: string }>(`/catalog/departments/${d.id}/toggle`);
      showToast(res.data.message, 'success');
      loadDepts();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not change department state.'), 'error');
    }
  };

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLINICAL SPECIALTIES</p>
          <h1>Manage Departments</h1>
          <p>
            Configure medical departments displayed across Green Hospital and control public
            booking visibility.
          </p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button button-primary" onClick={openCreate}>
            <Icon id="ic-plus" /> Add Department
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingScreen />
      ) : (
        <div className="doctors-grid">
          {departments.map((d) => (
            <div
              key={d.id}
              className="panel"
              style={{
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 14,
                opacity: d.is_active ? 1 : 0.72,
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <StatusPill
                    status={d.is_active ? 'confirmed' : 'cancelled'}
                    label={d.is_active ? 'Active' : 'Inactive'}
                  />
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {d.doctor_count ?? 0} doctor(s)
                  </span>
                </div>
                <h2 style={{ margin: '0 0 6px' }}>{d.name}</h2>
                <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                  {d.description || 'Specialist clinical department'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  className="button button-small button-outline"
                  style={{ flex: 1 }}
                  onClick={() => openEdit(d)}
                >
                  Edit Details
                </button>
                <button
                  type="button"
                  className="button button-small button-outline"
                  style={{
                    color: d.is_active ? 'var(--red)' : 'var(--forest)',
                    borderColor: d.is_active ? 'rgba(220,38,38,0.3)' : 'rgba(13,92,70,0.3)',
                  }}
                  onClick={() => handleToggle(d)}
                >
                  {d.is_active ? 'Deactivate' : 'Activate'}
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
              {editing ? `Edit ${editing.name}` : 'Create Department'}
            </h2>
            <form onSubmit={handleSave} className="form-grid">
              <div className="form-group">
                <label htmlFor="dp-name">Department Name</label>
                <input
                  id="dp-name"
                  type="text"
                  className="field-control"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Cardiology"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="dp-desc">Description</label>
                <textarea
                  id="dp-desc"
                  rows={3}
                  className="field-control"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Clinical overview shown to patients..."
                />
              </div>

              {!editing && (
                <div className="form-group">
                  <label htmlFor="dp-icon">Icon Key</label>
                  <input
                    id="dp-icon"
                    type="text"
                    className="field-control"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
