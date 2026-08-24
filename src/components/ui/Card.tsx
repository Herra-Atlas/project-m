import { HTMLAttributes } from 'react';
import { cn } from '../cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
}

export function Card({ interactive, selected, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-neutral-800 bg-neutral-900 p-4 text-neutral-100',
        interactive &&
          'cursor-pointer transition-colors hover:bg-neutral-900 hover:border-neutral-700',
        selected && 'border-neutral-500 ring-1 ring-neutral-500/40 bg-neutral-900',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-[13px] font-medium tracking-tight text-neutral-100', className)}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('mt-1 text-xs leading-relaxed text-neutral-400', className)}
      {...rest}
    />
  );
}
