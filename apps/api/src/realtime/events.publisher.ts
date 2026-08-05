import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BatchOfferedEvent,
  BatchStatusEvent,
  ConfigUpdatedEvent,
  NewOrderEvent,
  OrderStatusEvent,
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
}

@Injectable()
export class EventsPublisher {
  constructor(private readonly gateway: RealtimeGateway) {}

  private base() {
    return { eventId: randomUUID(), at: new Date().toISOString() };
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
    this.gateway.server.to(SocketRooms.admin).emit('batch:status', payload);
  }

  @OnEvent('config.updated')
  onConfigUpdated(e: { keys: string[] }) {
    const payload: ConfigUpdatedEvent = { ...this.base(), keys: e.keys };
    this.gateway.server.emit('config:updated', payload);
  }
}
