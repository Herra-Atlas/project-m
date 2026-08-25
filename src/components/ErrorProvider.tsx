import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type ToastKind = 'error' | 'info' | 'success';

interface ToastState {
  message: string;
  title?: string;
  kind: ToastKind;
}

interface ToastContextValue {
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  success: (message: string, title?: string) => void;
  /** Backwards-compatible alias used throughout the codebase. */
  showError: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_META: Record<ToastKind, { icon: typeof Info; tone: string; ring: string; bg: string; label: string }> = {
  error: {
    icon: AlertTriangle,
    tone: 'text-red-400',
    ring: 'border-red-500/30 ring-red-500/10',
    bg: 'bg-red-500/10 ring-red-500/30',
    label: 'Error',
  },
  info: {
    icon: Info,
    tone: 'text-blue-400',
    ring: 'border-blue-500/30 ring-blue-500/10',
    bg: 'bg-blue-500/10 ring-blue-500/30',
    label: 'Notice',
  },
  success: {
    icon: CheckCircle2,
    tone: 'text-green-400',
    ring: 'border-green-500/30 ring-green-500/10',
    bg: 'bg-green-500/10 ring-green-500/30',
    label: 'Done',
  },
};

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((kind: ToastKind, message: string, title?: string) => {
    setToast({ message, title, kind });
  }, []);

  const error = useCallback((message: string, title?: string) => show('error', message, title), [show]);
  const info = useCallback((message: string, title?: string) => show('info', message, title), [show]);
  const success = useCallback((message: string, title?: string) => show('success', message, title), [show]);

  const close = useCallback(() => setToast(null), []);

  const value: ToastContextValue = { error, info, success, showError: error };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={`w-full max-w-md overflow-hidden rounded-xl border bg-neutral-900 shadow-2xl shadow-black/60 ring-1 ${
              KIND_META[toast.kind].ring
            }`}
          >
            <div className="flex items-start gap-3 border-b border-white/5 px-5 py-4">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${
                  KIND_META[toast.kind].bg
                }`}
              >
                {(() => {
                  const Icon = KIND_META[toast.kind].icon;
                  return <Icon size={18} className={KIND_META[toast.kind].tone} />;
                })()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold tracking-tight text-neutral-100">
                  {toast.title || KIND_META[toast.kind].label}
                </h3>
                <p className="mt-1 text-sm text-neutral-400">
                  {toast.kind === 'error' ? 'Something went wrong.' : 'Heads-up.'}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="shrink-0 rounded p-1 text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-neutral-300">
                {toast.message}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/5 bg-neutral-950/40 px-5 py-3">
              <button
                type="button"
                onClick={close}
                className="h-8 px-3 rounded-md border border-neutral-700 bg-neutral-800 text-sm font-medium text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useError(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return ctx;
}

/** Alias for code that wants to express success/error/info explicitly. */
export function useToast(): ToastContextValue {
  return useError();
}