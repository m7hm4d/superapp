'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './button';

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-red-100 bg-red-50/50 px-6 py-10 text-center">
      <AlertCircle size={32} className="text-red-400" aria-hidden />
      <p className="text-sm font-medium text-red-700">
        {message ?? 'حدث خطأ أثناء جلب البيانات'}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden />
          إعادة المحاولة
        </Button>
      )}
    </div>
  );
}
