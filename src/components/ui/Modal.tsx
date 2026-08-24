import { HTMLAttributes, ReactNode, useEffect } from 'react';
import { cn } from '../cn';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  hideCloseButton?: boolean;
}

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-5xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  closeOnEscape = true,
  closeOnBackdrop = true,
  hideCloseButton = false,
  className,
  children,
  ...rest
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  const hasHeader =
    title !== undefined || description !== undefined || !hideCloseButton;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-md border border-white/10 bg-neutral-900 shadow-2xl shadow-black/60 ring-1 ring-white/5',
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {hasHeader && (
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
            <div className="min-w-0 flex-1">
              {title !== undefined && (
                <h3 className="text-base font-semibold tracking-tight text-neutral-100">
                  {title}
                </h3>
              )}
              {description !== undefined && (
                <p className="mt-1 text-sm leading-relaxed text-neutral-400">
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded p-1 text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path
                    d="M2 2L12 12M12 2L2 12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/5 bg-neutral-950/40 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
