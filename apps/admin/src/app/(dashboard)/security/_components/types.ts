export interface AuthEventRow {
  id: string;
  userId: string | null;
  fullName: string | null;
  role: string | null;
  method: string;
  outcome: string;
  sessionFamilyId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface SessionRow {
  familyId: string;
  /** جلسة الطالب نفسه — تُميَّز كي لا يقطعها ظنّاً أنها لغيره */
  isCurrent?: boolean;
  userId: string;
  fullName: string;
  role: string;
  phone: string;
  startedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const ROLE_AR: Record<string, string> = {
  customer: 'زبون',
  vendor: 'متجر',
  driver: 'سائق',
  admin: 'إدارة',
};

/** تصفية السجل: حالة واحدة يتقاسمها زرّ الإخفاقات وأسماء الجداول والرقائق. */
export interface LogFilters {
  outcome: string;
  userId: string;
  /** اسم يُعرض على الرقاقة — المعرّف وحده لا يقول لمن هو */
  userLabel: string | null;
  offset: number;
  setOutcome: (value: string) => void;
  setUser: (id: string, label: string | null) => void;
  clearUser: () => void;
  clearAll: () => void;
  setOffset: (value: number) => void;
}
