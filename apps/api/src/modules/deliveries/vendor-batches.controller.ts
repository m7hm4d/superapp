import { Controller, Get } from '@nestjs/common';
import { Role } from '@superapp/shared';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { DriversService } from './drivers.service';
import type { VendorActiveBatchView } from './drivers.service';

/** دفعات المخبز الحية: رمز تسليم الدفعة للسائق + اسمه + أكواد الطلبات */
@Controller('vendor/batches')
@Roles(Role.VENDOR)
export class VendorBatchesController {
  constructor(private readonly driversService: DriversService) {}

  @Get('active')
  listActive(@CurrentUser() user: RequestUser): Promise<VendorActiveBatchView[]> {
    return this.driversService.listActiveBatchesForVendor(user.id);
  }
}
