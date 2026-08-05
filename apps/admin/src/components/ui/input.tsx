'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-zinc-700">
          {label}
        </label>
      )}
      <input
        id={inputId}
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-11 rounded-xl border bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:ring-2',
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
            : 'border-zinc-300 focus:border-brand-500 focus:ring-brand-100',
          className,
        )}
        {...rest}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
});
