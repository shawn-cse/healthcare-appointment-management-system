import { createContext, useCallback, useContext, useState } from 'react';
import { Icon } from '../components/Icons.tsx';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  dismissing?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', durationMs = 3000) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev, { id, message, type }]);
      if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs);
      }
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div id="toast-container" className="toast-container" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => {
          const iconId =
            t.type === 'success' ? 'ic-check' : t.type === 'info' ? 'ic-help' : 'ic-alert';
          const title =
            t.type === 'error'
              ? 'Error'
              : t.type === 'success'
                ? 'Success'
                : t.type === 'warning'
                  ? 'Attention'
                  : 'Information';
          return (
            <div
              key={t.id}
              className={`toast-card toast-${t.type} ${t.dismissing ? 'toast-dismissing' : ''}`}
              role="alert"
            >
              <div className="toast-icon-wrap">
                <Icon id={iconId} />
              </div>
              <div className="toast-body">
                <span className="toast-badge-title">{title}</span>
                <p className="toast-msg-text">{t.message}</p>
              </div>
              <button
                type="button"
                className="toast-dismiss-btn"
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
              >
                ✕
              </button>
              <div className="toast-progress-track">
                <div className="toast-progress-bar" />
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
