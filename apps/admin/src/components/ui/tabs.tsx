'use client';

import { cn } from '@/lib/cn';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-zinc-200">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              '-mb-px flex min-h-touch items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition',
              isActive
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-zinc-500 hover:text-zinc-800',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                  isActive
                    ? 'bg-brand-100 text-brand-800'
                    : 'bg-zinc-100 text-zinc-600',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
