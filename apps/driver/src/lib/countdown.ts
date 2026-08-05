import { useEffect, useState } from 'react';

function remainingSeconds(expiresAt?: string | null): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/** عدّاد تنازلي بالثواني حتى offerExpiresAt — يتوقف عند الصفر */
export function useCountdown(expiresAt?: string | null): number {
  const [remaining, setRemaining] = useState(() => remainingSeconds(expiresAt));

  useEffect(() => {
    setRemaining(remainingSeconds(expiresAt));
    if (!expiresAt) return;
    const id = setInterval(() => {
      const next = remainingSeconds(expiresAt);
      setRemaining(next);
      if (next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}

/** 03:25 — أرقام لاتينية كما في مبالغ الدينار */
export function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
