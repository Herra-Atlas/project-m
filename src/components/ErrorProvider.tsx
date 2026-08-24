import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ErrorState {
  message: string;
  title?: string;
}

interface ErrorContextValue {
  showError: (message: string, title?: string) => void;
}

const ErrorContext = createContext<ErrorContextValue | null>(null);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ErrorState | null>(null);

  const showError = useCallback((message: string, title?: string) => {
    setError({ message, title });
  }, []);

  const close = useCallback(() => setError(null), []);

  return (
    <ErrorContext.Provider value={{ showError }}>
      {children}
      {error && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-red-500/30 bg-neutral-900 shadow-2xl shadow-black/60 ring-1 ring-red-500/10">
            <div className="flex items-start gap-3 border-b border-white/5 px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 ring-1 ring-red-500/30">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold tracking-tight text-neutral-100">
                  {error.title || 'Error'}
                </h3>
                <p className="mt-1 text-sm text-neutral-400">
                  Something went wrong.
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
                {error.message}
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
    </ErrorContext.Provider>
  );
}

export function useError(): ErrorContextValue {
  const ctx = useContext(ErrorContext);
  if (!ctx) {
    throw new Error('useError must be used within ErrorProvider');
  }
  return ctx;
}