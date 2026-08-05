import { Module } from '@nestjs/common';
import { DriverLedgerController } from './driver-ledger.controller';
import { LedgerService } from './ledger.service';
import { SettlementsService } from './settlements.service';
import { VendorLedgerController } from './vendor-ledger.controller';

/**
 * المال (M2): دفتر append-only + تسويات سائق↔مخبز.
 * LedgerService مُصدَّر لتكتب وحدة التوصيل قيود التسليم في نفس معاملتها،
 * وSettlementsService مُصدَّر لحسم الاعتراضات من وحدة الإدارة.
 */
@Module({
  controllers: [DriverLedgerController, VendorLedgerController],
  providers: [LedgerService, SettlementsService],
  exports: [LedgerService, SettlementsService],
})
export class LedgerModule {}
