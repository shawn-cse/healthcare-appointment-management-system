import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (accepted: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (accepted: boolean) => {
      if (pending) {
        pending.resolve(accepted);
        setPending(null);
      }
    },
    [pending]
  );

  useEffect(() => {
    if (!pending) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, close]);

  const type = pending?.type || 'warning';

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          id="gh-confirm-modal"
          className="is-open"
          style={{ display: 'flex' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="gh-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div className="gh-confirm-card">
            <div className={`gh-confirm-icon-wrap type-${type}`} id="gh-confirm-icon">
              {type === 'danger' ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : type === 'warning' ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              )}
            </div>
            <h3 className="gh-confirm-title" id="gh-confirm-title">
              {pending.title || (type === 'danger' ? 'Delete Confirmation' : 'Please Confirm')}
            </h3>
            <p className="gh-confirm-message" id="gh-confirm-message">
              {pending.message}
            </p>
            <div className="gh-confirm-actions">
              <button
                type="button"
                className="gh-confirm-btn gh-confirm-btn-cancel"
                id="gh-confirm-cancel"
                onClick={() => close(false)}
              >
                {pending.cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                className={`gh-confirm-btn gh-confirm-btn-confirm type-${type}`}
                id="gh-confirm-ok"
                autoFocus
                onClick={() => close(true)}
              >
                {pending.confirmText || (type === 'danger' ? 'Yes, Delete' : 'Yes, Proceed')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
