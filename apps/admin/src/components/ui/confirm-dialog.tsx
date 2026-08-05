'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@superapp/api-client';
import { Button } from './button';
import { Dialog } from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  body?: ReactNode;
  /** إجراء موثق: السبب إلزامي ويُسجل في سجل التدقيق (الملف §7). */
  requireReason?: boolean;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  requireReason = false,
  confirmLabel,
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (requireReason && trimmed.length < 2) {
      setError('السبب مطلوب — حرفان على الأقل');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed.length > 0 ? trimmed : undefined);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.message ?? 'تعذر تنفيذ الإجراء')
          : 'تعذر تنفيذ الإجراء — حاول مجدداً',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={title}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            إلغاء
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={submitting}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel ?? 'تأكيد'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {body && <div className="text-sm text-zinc-600">{body}</div>}
        {requireReason && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">السبب</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="اكتب السبب — يُسجَّل في سجل التدقيق"
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Dialog>
  );
}
