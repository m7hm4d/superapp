'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: string;
  loading?: boolean;
}

function defaultCell<T>(row: T, key: string): ReactNode {
  const value = (row as unknown as Record<string, unknown>)[key];
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  loading = false,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-card border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-surface-muted/60">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-4 py-3 text-start font-semibold text-zinc-600',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-zinc-100 last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-zinc-100 last:border-0',
                    onRowClick && 'cursor-pointer transition hover:bg-brand-50/50',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3 text-start text-zinc-800',
                        col.className,
                      )}
                    >
                      {col.render ? col.render(row) : defaultCell(row, col.key)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && (
        <EmptyState title={empty ?? 'لا توجد بيانات لعرضها بعد'} />
      )}
    </div>
  );
}
