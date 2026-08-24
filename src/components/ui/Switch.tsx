import { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
  ...rest
}: SwitchProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-3 text-sm text-neutral-200 select-none',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 outline-none',
          'focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950',
          checked ? 'bg-green-500' : 'bg-neutral-700',
        )}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150',
            checked && 'translate-x-4',
          )}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
