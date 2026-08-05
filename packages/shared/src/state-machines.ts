import { BatchStatus, OrderStatus, Role, SettlementStatus } from './enums';

/**
 * آلات الحالة الثلاث — المصدر الوحيد للحقيقة (الملف §8).
 * الباكند يفرضها داخل transition() والواجهات تعرض الأزرار بناءً عليها.
 */

export interface Transition<S extends string> {
  to: S;
  /** الأدوار المخولة بهذا الانتقال. 'system' يعني مؤقتات/مهام الخادم. */
  actors: (Role | 'system')[];
}

export type TransitionMap<S extends string> = Record<S, Transition<S>[]>;

/** آلة 1 — الطلب. EXPIRED ليست حالة: انتهاء المهلة = CANCELLED بواسطة system. */
export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  [OrderStatus.PENDING_BAKERY]: [
    { to: OrderStatus.PREPARING, actors: [Role.VENDOR] },
    { to: OrderStatus.CANCELLED, actors: [Role.CUSTOMER, Role.VENDOR, Role.ADMIN, 'system'] },
  ],
  [OrderStatus.PREPARING]: [
    { to: OrderStatus.READY, actors: [Role.VENDOR] },
    { to: OrderStatus.CANCELLED, actors: [Role.ADMIN] },
  ],
  [OrderStatus.READY]: [
    // تحقق الاستلام: يتم عبر آلة الدفعة (CONFIRM_PICKUP) وليس مباشرة من السائق
    { to: OrderStatus.IN_DELIVERY, actors: ['system'] },
    { to: OrderStatus.CANCELLED, actors: [Role.VENDOR, Role.ADMIN] },
  ],
  [OrderStatus.IN_DELIVERY]: [
    { to: OrderStatus.DELIVERED, actors: [Role.DRIVER, Role.ADMIN] },
    { to: OrderStatus.CANCELLED, actors: [Role.ADMIN] },
  ],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

/** آلة 2 — دفعة التوصيل. الخادم ينشئها من 1–3 طلبات READY من المخبز نفسه. */
export const BATCH_TRANSITIONS: TransitionMap<BatchStatus> = {
  [BatchStatus.PROPOSED]: [
    { to: BatchStatus.OFFERED, actors: ['system'] },
    { to: BatchStatus.CANCELLED, actors: [Role.ADMIN, 'system'] },
  ],
  [BatchStatus.OFFERED]: [
    { to: BatchStatus.CLAIMED, actors: [Role.DRIVER] },
    { to: BatchStatus.EXPIRED, actors: ['system'] },
    { to: BatchStatus.CANCELLED, actors: [Role.ADMIN, 'system'] },
  ],
  [BatchStatus.CLAIMED]: [
    { to: BatchStatus.PICKUP_CONFIRMED, actors: [Role.DRIVER] },
    { to: BatchStatus.CANCELLED, actors: [Role.ADMIN] },
  ],
  [BatchStatus.PICKUP_CONFIRMED]: [{ to: BatchStatus.ACTIVE, actors: ['system'] }],
  [BatchStatus.ACTIVE]: [
    { to: BatchStatus.COMPLETED, actors: ['system'] },
    { to: BatchStatus.CANCELLED, actors: [Role.ADMIN] },
  ],
  [BatchStatus.COMPLETED]: [],
  [BatchStatus.EXPIRED]: [],
  [BatchStatus.CANCELLED]: [],
};

/** آلة 3 — التسوية المالية بائع↔سائق. */
export const SETTLEMENT_TRANSITIONS: TransitionMap<SettlementStatus> = {
  [SettlementStatus.UNSETTLED]: [
    { to: SettlementStatus.AWAITING_CONFIRMATION, actors: [Role.DRIVER] },
  ],
  [SettlementStatus.AWAITING_CONFIRMATION]: [
    { to: SettlementStatus.SETTLED, actors: [Role.VENDOR] },
    { to: SettlementStatus.DISPUTED, actors: [Role.VENDOR, Role.DRIVER] },
  ],
  [SettlementStatus.DISPUTED]: [{ to: SettlementStatus.SETTLED, actors: [Role.ADMIN] }],
  [SettlementStatus.SETTLED]: [],
};

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
  actor: Role | 'system',
): boolean {
  return map[from].some((t) => t.to === to && t.actors.includes(actor));
}

export function allowedTargets<S extends string>(
  map: TransitionMap<S>,
  from: S,
  actor: Role | 'system',
): S[] {
  return map[from].filter((t) => t.actors.includes(actor)).map((t) => t.to);
}

/** الحالات النهائية لكل آلة */
export const ORDER_TERMINAL: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];
export const BATCH_TERMINAL: readonly BatchStatus[] = [
  BatchStatus.COMPLETED,
  BatchStatus.EXPIRED,
  BatchStatus.CANCELLED,
];
export const BATCH_ACTIVE_STATUSES: readonly BatchStatus[] = [
  BatchStatus.CLAIMED,
  BatchStatus.PICKUP_CONFIRMED,
  BatchStatus.ACTIVE,
];
