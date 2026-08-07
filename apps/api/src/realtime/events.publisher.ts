import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BatchOfferedEvent,
  BatchStatusEvent,
  ConfigUpdatedEvent,
  NewOrderEvent,
  OrderStatusEvent,
  SettlementUpdatedEvent,
  SocketRooms,
} from '@superapp/shared';
import { randomUUID } from 'node:crypto';
import { RealtimeGateway } from './realtime.gateway';

/**
 * الوحدات لا تلمس الـ sockets مباشرة: تُصدر أحداث EventEmitter2 داخلية
 * وهذا الناشر يحوّلها لبث Socket.io بالغرف الصحيحة.
 */

export interface OrderCreatedDomainEvent {
  orderId: string;
  code: string;
  vendorProfileId: string;
  customerId: string;
  itemsCount: number;
  totalIqd: number;
}

export interface OrderStatusDomainEvent {
  orderId: string;
  code: string;
  status: string;
  customerId: string;
  vendorProfileId: string;
  cancelledReason?: string;
}

export interface BatchOfferedDomainEvent {
  batchId: string;
  cityId: string;
  vendorName: string;
  vendorLat: number;
  vendorLng: number;
  ordersCount: number;
  totalFeeIqd: number;
  offerExpiresAt: string;
}

export interface BatchStatusDomainEvent {
  batchId: string;
  cityId: string;
  status: string;
  driverUserId?: string;
  /** لغرفة البائع — ليرى رمز تسليم الدفعة فور قبول السائق */
  vendorProfileId?: string;
}

export interface SettlementUpdatedDomainEvent {
  settlementId: string;
  status: string;
  amountIqd: number;
  vendorProfileId: string;
  driverUserId: string;
}

@Injectable()
export class EventsPublisher {
  constructor(private readonly gateway: RealtimeGateway) {}

  private base() {
    return { eventId: randomUUID(), at: new Date().toISOString() };
  }

  // ───────────────────── إسقاط ما لم يعد مأذوناً ─────────────────────

  @OnEvent('session.revoked')
  onSessionRevoked(e: SessionRevokedDomainEvent) {
    this.gateway.disconnectFamily(e.userId, e.familyId, 'session revoked');
  }

  @OnEvent('user.blocked')
  onUserBlocked(e: UserBlockedDomainEvent) {
    this.gateway.disconnectUser(e.userId, 'user blocked');
  }

  @OnEvent('approval.decided')
  onApprovalDecided(e: ApprovalDecidedDomainEvent) {
    // القطع على كل قرار لا على الرفض وحده: الترقية إلى «موافَق» تحتاج
    // مصافحة جديدة كي ينضم إلى غرف العمل.
    this.gateway.disconnectUser(e.userId, 'approval decided');
  }

  @OnEvent('driver.availability')
  onDriverAvailability(e: DriverAvailabilityDomainEvent) {
    void this.gateway.syncDriverAvailability(e.userId, e.cityId, e.isAvailable);
  }

  @OnEvent('order.created')
  onOrderCreated(e: OrderCreatedDomainEvent) {
    const payload: NewOrderEvent = {
      ...this.base(),
      orderId: e.orderId,
      code: e.code,
      itemsCount: e.itemsCount,
      totalIqd: e.totalIqd,
    };
    this.gateway.server.to(SocketRooms.vendor(e.vendorProfileId)).emit('order:new', payload);
    this.gateway.server.to(SocketRooms.admin).emit('order:new', payload);
  }

  @OnEvent('order.status')
  onOrderStatus(e: OrderStatusDomainEvent) {
    const payload: OrderStatusEvent = {
      ...this.base(),
      orderId: e.orderId,
      code: e.code,
      status: e.status as OrderStatusEvent['status'],
      cancelledReason: e.cancelledReason,
    };
    this.gateway.server.to(SocketRooms.user(e.customerId)).emit('order:status', payload);
    this.gateway.server.to(SocketRooms.vendor(e.vendorProfileId)).emit('order:status', payload);
    this.gateway.server.to(SocketRooms.admin).emit('order:status', payload);
  }

  @OnEvent('batch.offered')
  onBatchOffered(e: BatchOfferedDomainEvent) {
    const payload: BatchOfferedEvent = {
      ...this.base(),
      batchId: e.batchId,
      vendorName: e.vendorName,
      vendorLat: e.vendorLat,
      vendorLng: e.vendorLng,
      ordersCount: e.ordersCount,
      totalFeeIqd: e.totalFeeIqd,
      offerExpiresAt: e.offerExpiresAt,
    };
    this.gateway.server.to(SocketRooms.drivers(e.cityId)).emit('batch:offered', payload);
  }

  @OnEvent('batch.status')
  onBatchStatus(e: BatchStatusDomainEvent) {
    const payload: BatchStatusEvent = {
      ...this.base(),
      batchId: e.batchId,
      status: e.status as BatchStatusEvent['status'],
    };
    this.gateway.server.to(SocketRooms.drivers(e.cityId)).emit('batch:status', payload);
    if (e.driverUserId) {
      this.gateway.server.to(SocketRooms.user(e.driverUserId)).emit('batch:status', payload);
    }
    if (e.vendorProfileId) {
      this.gateway.server.to(SocketRooms.vendor(e.vendorProfileId)).emit('batch:status', payload);
    }
    this.gateway.server.to(SocketRooms.admin).emit('batch:status', payload);
  }

  @OnEvent('settlement.updated')
  onSettlementUpdated(e: SettlementUpdatedDomainEvent) {
    const payload: SettlementUpdatedEvent = {
      ...this.base(),
      settlementId: e.settlementId,
      status: e.status,
      amountIqd: e.amountIqd,
    };
    this.gateway.server.to(SocketRooms.vendor(e.vendorProfileId)).emit('settlement:updated', payload);
    this.gateway.server.to(SocketRooms.user(e.driverUserId)).emit('settlement:updated', payload);
    this.gateway.server.to(SocketRooms.admin).emit('settlement:updated', payload);
  }

  @OnEvent('config.updated')
  onConfigUpdated(e: { keys: string[] }) {
    const payload: ConfigUpdatedEvent = { ...this.base(), keys: e.keys };
    this.gateway.server.emit('config:updated', payload);
  }
}

// ─────────────────────── إسقاط الاتصالات القائمة ───────────────────────

/**
 * المصافحة تفحص الحالة **مرة واحدة**، فكل تغيّر بعدها لا يبلغ الاتصال
 * القائم ما لم يُقطع. والقطع كافٍ: العميل يعيد الاتصال بتوكن حيّ فيُعاد
 * تقييمه بحالته الجديدة — أو يُرفض إن لم يعد مأذوناً.
 */

export interface SessionRevokedDomainEvent {
  userId: string;
  familyId: string;
}

export interface UserBlockedDomainEvent {
  userId: string;
}

export interface ApprovalDecidedDomainEvent {
  userId: string;
}

export interface DriverAvailabilityDomainEvent {
  userId: string;
  cityId: string;
  isAvailable: boolean;
}

