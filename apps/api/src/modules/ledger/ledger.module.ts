import { Module } from '@nestjs/common';
import { DriverDirectoryModule } from '../deliveries/driver-directory.module';
import { VendorsModule } from '../vendors/vendors.module';
import { PinGuardService } from '../../common/pin-guard.service';
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
  imports: [DriverDirectoryModule, VendorsModule],
  controllers: [DriverLedgerController, VendorLedgerController],
  providers: [LedgerService, SettlementsService, PinGuardService],
  exports: [LedgerService, SettlementsService],
})
export class LedgerModule {}
