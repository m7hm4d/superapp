import type { BatchStatus, OrderStatus } from './enums';

/**
 * أحداث Socket.io (الملف §10): كل إشعار يحمل معرّف كيان ويُفتح به؛
 * dedup في العميل بواسطة eventId. الـ socket تلميح — الحقيقة عبر REST.
 */

export interface BaseEvent {
  eventId: string;
  at: string; // ISO timestamp
}

export interface OrderStatusEvent extends BaseEvent {
  orderId: string;
  code: string;
  status: OrderStatus;
  cancelledReason?: string;
}

export interface NewOrderEvent extends BaseEvent {
  orderId: string;
  code: string;
  itemsCount: number;
  totalIqd: number;
}

export interface BatchOfferedEvent extends BaseEvent {
  batchId: string;
  vendorName: string;
  vendorLat: number;
  vendorLng: number;
  ordersCount: number;
  totalFeeIqd: number;
  distanceHintM?: number;
  offerExpiresAt: string;
}

export interface BatchStatusEvent extends BaseEvent {
  batchId: string;
  status: BatchStatus;
}

export interface ConfigUpdatedEvent extends BaseEvent {
  keys: string[];
}

export interface ServerToClientEvents {
  'order:new': (e: NewOrderEvent) => void;
  'order:status': (e: OrderStatusEvent) => void;
  'batch:offered': (e: BatchOfferedEvent) => void;
  'batch:status': (e: BatchStatusEvent) => void;
  'config:updated': (e: ConfigUpdatedEvent) => void;
}

export interface ClientToServerEvents {
  // القراءة والأفعال كلها REST؛ لا أوامر عبر socket في الطيار.
}

export const SocketRooms = {
  user: (userId: string) => `user:${userId}`,
  vendor: (vendorProfileId: string) => `vendor:${vendorProfileId}`,
  drivers: (cityId: string) => `drivers:${cityId}`,
  admin: 'admin',
} as const;
