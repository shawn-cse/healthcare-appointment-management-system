import api, { getApiErrorMessage } from '../api/api.ts';
import { useToast } from '../context/ToastContext.tsx';

export function AttachmentLink({ path, filename }: { path: string; filename: string }) {
  const { showToast } = useToast();
  async function download() {
    try {
      const response = await api.get<Blob>(path, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { showToast(getApiErrorMessage(err, 'Could not download the attachment.'), 'error'); }
  }
  return <button type="button" className="button button-small button-outline" onClick={() => void download()}>{filename}</button>;
}
