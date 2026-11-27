import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { Icon } from '../components/Icons.tsx';
import { ManagementTable } from '../components/ManagementTable.tsx';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Department } from '../types/index.ts';

export default function DepartmentsPage() {
  const { showToast } = useToast();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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

        {loading ? <LoadingScreen /> : <ManagementTable rows={departments} rowKey={(d) => d.id} showSortSelect={false} paginate={false} columns={[
            { heading: 'Department name', value: (d) => `${d.name} ${d.description}`, cell: (d) => d.name },
            { heading: 'Total doctors', value: (d) => d.doctor_count || 0 },
            { heading: 'Actions', value: () => '', cell: (d) => <div className="consultation-times">
              <button className="button button-small button-outline" type="button" onClick={() => openEdit(d)}>Edit</button>
            </div> },
          ]} />}
      </div>

      {modalOpen && createPortal(
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
        </div>,
        document.body
      )}
    </AppLayout>
  );
}
