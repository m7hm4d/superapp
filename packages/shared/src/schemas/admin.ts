import { z } from 'zod';
import { ApprovalStatus, Role } from '../enums';
import { zPagination, zUuid } from './common';

export const zApprovalsQuery = z
  .object({
    type: z.enum([Role.VENDOR, Role.DRIVER]),
    status: z.nativeEnum(ApprovalStatus).default(ApprovalStatus.PENDING),
  })
  .merge(zPagination);

export const zApprovalDecision = z.object({
  reason: z.string().max(500).optional(),
});

export const zRejectDecision = z.object({
  reason: z.string().min(2).max(500),
});

export const zAdminOrdersQuery = z
  .object({
    status: z.string().optional(),
    vendorId: zUuid.optional(),
    driverId: zUuid.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .merge(zPagination);

export const zForceTransition = z.object({
  to: z.string(),
  reason: z.string().min(2).max(500),
});

export const zResolveException = z.object({
  decision: z.enum(['retry_delivery', 'cancel_order', 'mark_delivered', 'noted']),
  reason: z.string().min(2).max(500),
});

export const zUpdateFlag = z.object({
  enabled: z.boolean().optional(),
  value: z.unknown().optional(),
});

export const zUpdateCity = z.object({
  nameAr: z.string().min(2).max(100).optional(),
  serviceRadiusKm: z.number().min(0.5).max(50).optional(),
  visibilityRadiusKm: z.number().min(0.5).max(30).optional(),
  deliveryFeeIqd: z.number().int().nonnegative().optional(),
  vendorAcceptTimeoutMin: z.number().int().min(1).max(60).optional(),
  batchWindowSec: z.number().int().min(0).max(600).optional(),
  batchOfferTtlSec: z.number().int().min(15).max(600).optional(),
});
