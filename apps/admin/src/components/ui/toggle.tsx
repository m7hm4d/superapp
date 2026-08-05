'use client';

import { cn } from '@/lib/cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex min-h-touch select-none items-center gap-2 text-sm text-zinc-700',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span
        className={cn(
          'relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-zinc-300',
        )}
      >
        <span
          className={cn(
            // في RTL: start = يمين؛ التفعيل يحرّك القرص نحو اليسار (inline-end)
            'absolute start-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked && '-translate-x-5',
          )}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}
