import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useConfirm } from '../context/ConfirmContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Department } from '../types/index.ts';

export default function DepartmentsPage() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return departments.filter((d) => {
      if (statusFilter === 'active' && !d.is_active) return false;
      if (statusFilter === 'inactive' && d.is_active) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q)
      );
    });
  }, [departments, search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setModalOpen(true);
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setName(d.name);
    setDescription(d.description);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
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
        ? `Deactivate "${d.name}"? Doctors in deactivated departments are hidden from public patient booking.`
        : `Re-activate "${d.name}" so specialists are visible to patients?`,
      confirmText: d.is_active ? 'Deactivate' : 'Activate',
      type: d.is_active ? 'warning' : 'info',
    });
    if (!ok) return;
    setTogglingId(d.id);
    try {
      const res = await api.post<{ message: string }>(`/catalog/departments/${d.id}/toggle`);
      showToast(res.data.message, 'success');
      loadDepts();
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Could not change department state.'), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <AppLayout>
      <div className="staff-directory-page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">CLINICAL SPECIALTIES</p>
            <h1>Manage Departments</h1>
            <p>
              Organize clinical specialties, descriptions, assigned specialist counts, and booking
              visibility.
            </p>
          </div>
          <div className="heading-actions">
            <button type="button" className="button button-primary" onClick={openCreate}>
              <Icon id="ic-plus" /> Add Department
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
                  placeholder="Type to search department name or description..."
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
                aria-label="Filter by department status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>

              <div className="sheet-indicator" style={{ marginLeft: 'auto' }}>
                <span className="live-dot-pulse" />
                <span>
                  Showing <strong>{filtered.length}</strong> of <strong>{departments.length}</strong>{' '}
                  departments
                </span>
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingScreen />
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '36px 24px' }}>
              <h3>No departments matched</h3>
              <p className="muted">Try another search keyword or add a new department.</p>
            </div>
          ) : (
            <div className="excel-table-wrap">
              <table className="excel-grid-table">
                <colgroup>
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '37%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Department Name</th>
                    <th>Description</th>
                    <th>Doctors</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d, idx) => (
                    <tr key={d.id}>
                      <td className="muted">{idx + 1}</td>
                      <td>
                        <div className="person-name">{d.name}</div>
                        <div className="muted" style={{ fontSize: '0.76rem' }}>
                          {d.slug}
                        </div>
                      </td>
                      <td>{d.description || <span className="muted">—</span>}</td>
                      <td>
                        <span className="role-pill-badge">{d.doctor_count ?? 0} doctor(s)</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`sm-status-toggle ${d.is_active ? 'active' : 'inactive'}`}
                          disabled={togglingId === d.id}
                          title={d.is_active ? 'Click to deactivate' : 'Click to activate'}
                          onClick={() => handleToggle(d)}
                        >
                          <span>{d.is_active ? '●' : '○'}</span>
                          <span>{d.is_active ? 'Active' : 'Inactive'}</span>
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-small button-outline"
                          onClick={() => openEdit(d)}
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
          <form
            className="sm-modal-panel"
            style={{ maxWidth: 480 }}
            onSubmit={handleSave}
          >
            <div className="sm-modal-header">
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>
                  DEPARTMENT DETAILS
                </p>
                <h2 style={{ margin: 0 }}>
                  {editing ? `Edit ${editing.name}` : 'Add Department'}
                </h2>
              </div>
            </div>

            <div className="sm-modal-body">
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-group">
                  <label htmlFor="dp-name">Department Name *</label>
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

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="dp-desc">Description (Optional)</label>
                  <textarea
                    id="dp-desc"
                    rows={3}
                    className="field-control"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Clinical overview shown to patients..."
                  />
                </div>
              </div>
            </div>

            <div className="sm-modal-footer">
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
      )}
    </AppLayout>
  );
}
