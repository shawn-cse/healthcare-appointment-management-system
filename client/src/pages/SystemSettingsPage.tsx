import { useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';

const fields = {
  defaultNoticeHours: 'Default minimum notice for legacy schedules (hours)',
  defaultAdvanceDays: 'Default materialization horizon (days)',
  defaultPaymentHours: 'Default payment cutoff (hours)',
  defaultCancelMode: 'Default cancellation rule',
  defaultCancelValue: 'Default cancellation value',
  defaultHospitalMode: 'Default commission rule',
  defaultHospitalValue: 'Default commission value',
};

type Settings = Record<keyof typeof fields, string | number>;

export default function SystemSettingsPage() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get<{ settings: Settings }>('/system/settings').then(({ data }) => setSettings(data.settings)).catch((err) => setError(getApiErrorMessage(err, 'Could not load system settings.'))); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try { await api.put('/system/settings', settings); setError(''); showToast('System settings saved.', 'success'); }
    catch (err) { setError(getApiErrorMessage(err, 'Could not save system settings.')); }
    finally { setSaving(false); }
  }
  return <AppLayout><div className="page-heading"><h1>System Settings</h1></div>
    {error && <p role="alert">{error}</p>}
    {settings ? <form className="panel padded-panel form-grid" onSubmit={submit}>
      {(Object.keys(fields) as (keyof Settings)[]).map((key) => <label className="form-group" key={key}>{fields[key]}
        {key.endsWith('Mode') ? <select className="field-control" value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}>
          <option value="percent">Percentage</option><option value="fixed">Fixed BDT</option>
        </select> : <input className="field-control" type="number" min={0} step={key.endsWith('Value') ? '.01' : '1'} required value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} />}
      </label>)}
      <button className="button button-primary" disabled={saving}>Save settings</button>
    </form> : !error && <LoadingScreen />}
  </AppLayout>;
}
