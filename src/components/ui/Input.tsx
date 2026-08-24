import { InputHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../cn';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md';
}

const SIZE: Record<'sm' | 'md', string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, size = 'md', className, id, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={!!error}
        className={cn(
          'w-full rounded-md border border-white/10 bg-neutral-900 text-neutral-100 outline-none transition-shadow',
          'placeholder:text-neutral-500',
          'focus:border-green-500 focus:ring-2 focus:ring-green-500/30',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/30',
          SIZE[size],
          className,
        )}
        {...rest}
      />
      {(error || hint) && (
        <p
          className={cn(
            'text-xs',
            error ? 'text-red-400' : 'text-neutral-500',
          )}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
});
