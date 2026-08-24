import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-green-500 text-neutral-900 hover:bg-green-400 active:bg-green-600 border border-transparent',
  secondary:
    'bg-neutral-800 text-neutral-100 border border-white/10 hover:bg-neutral-700 active:bg-neutral-900',
  ghost:
    'bg-transparent text-neutral-200 hover:bg-white/5 active:bg-white/10 border border-transparent',
  danger:
    'bg-red-600 text-white hover:bg-red-500 active:bg-red-700 border border-transparent',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
