import type { BatchStopView, BatchView, SettlementView } from '@superapp/shared';

/** توقف الدفعة كما يعيده الخادم للسائق (BatchStopView + وقت التسليم) */
export interface DriverBatchStop extends BatchStopView {
  deliveredAt: string | null;
}

/** الدفعة كما يعيدها GET driver/batches/* */
export interface DriverBatchView extends BatchView {
  stops: DriverBatchStop[];
}

export interface DriverOwedRow {
  vendorId: string;
  storeNameAr: string;
  amountIqd: number;
  orderIds: string[];
}

/** GET driver/ledger */
export interface DriverLedgerView {
  todayDeliveredCount: number;
  todayFeesIqd: number;
  cashOnHandIqd: number;
  owed: DriverOwedRow[];
  settlements: SettlementView[];
}

/** ملف السائق كما يعيده GET auth/me */
export interface DriverProfile {
  id: string;
  userId: string;
  cityId: string;
  vehicleType: string;
  isAvailable: boolean;
  approvalStatus: string;
  rejectionReason?: string | null;
  createdAt?: string;
}

export interface BatchSummary {
  deliveredCount: number;
  failedCount: number;
  cashCollectedIqd: number;
  feesEarnedIqd: number;
}
